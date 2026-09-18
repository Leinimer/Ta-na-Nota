import { TreeNode, NoteRecord, TagRecord, NoteLinkRecord } from '@/types';
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase/client';
import { indexedDbService } from './indexedDbService';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Converte qualquer ID para um UUID canônico válido exigido pelo PostgreSQL.
 * Remove prefixos legados (node_, folder_, note_, tag_) caso existam.
 */
export function toCanonicalUuid(id: string | null | undefined): string {
  if (!id) return crypto.randomUUID();
  const stripped = id.replace(/^(folder_|node_|note_|tag_)/i, '');
  if (UUID_REGEX.test(stripped)) {
    return stripped.toLowerCase();
  }
  return crypto.randomUUID();
}

interface PendingSaveItem {
  note: NoteRecord;
  node?: TreeNode;
}

class SyncEngineClass {
  // Fila de serialização por nodeId para evitar gravações concorrentes
  private inFlightNotes = new Set<string>();
  private pendingQueue = new Map<string, PendingSaveItem>();

  /**
   * Obtém o ID do usuário autenticado no Supabase com validação de sessão.
   */
  async getAuthenticatedUserId(): Promise<string | null> {
    const supabase = getSupabase();
    if (!supabase || !isSupabaseConfigured) return null;

    try {
      const { data: { user }, error } = await supabase.auth.getUser();
      if (error || !user) {
        return null;
      }
      return user.id;
    } catch (err) {
      console.error('[SyncEngine] Falha ao verificar sessão do Supabase:', err);
      return null;
    }
  }

  /**
   * Sincroniza um registro na tabela `nodes` do Supabase de forma idempotente (upsert).
   */
  async syncNode(node: TreeNode, maxRetries: number = 3): Promise<void> {
    const supabase = getSupabase();
    if (!supabase || !isSupabaseConfigured) return;

    const authUserId = await this.getAuthenticatedUserId();
    if (!authUserId) {
      console.warn('[SyncEngine] Usuário não autenticado no Supabase. O nó permanecerá apenas local.');
      return;
    }

    const canonicalId = toCanonicalUuid(node.id);
    const canonicalParentId = node.parentId ? toCanonicalUuid(node.parentId) : null;

    const payload = {
      id: canonicalId,
      user_id: authUserId,
      parent_id: canonicalParentId,
      type: node.type,
      name: node.name || (node.type === 'folder' ? 'Nova pasta' : 'Sem título'),
      position: Number(node.position || 1000),
      updated_at: node.updatedAt || new Date().toISOString(),
      deleted_at: node.deletedAt || null,
    };

    let attempt = 0;
    while (attempt < maxRetries) {
      attempt++;
      try {
        const { error } = await supabase.from('nodes').upsert(payload, { onConflict: 'id' });
        if (!error) {
          return;
        }
        console.error(
          `[SyncEngine] Erro ao sincronizar node (id: ${node.id}) no Supabase [Tentativa ${attempt}/${maxRetries}]:`,
          error.message,
          error.details,
          error.code
        );
      } catch (err) {
        console.error(`[SyncEngine] Exceção de rede no syncNode (tentativa ${attempt}/${maxRetries}):`, err);
      }

      if (attempt < maxRetries) {
        await new Promise((res) => setTimeout(res, 500 * Math.pow(2, attempt - 1)));
      }
    }
  }

  /**
   * Sincroniza um registro na tabela `notes` do Supabase de forma idempotente (upsert com onConflict: 'node_id').
   */
  async syncNote(note: NoteRecord, maxRetries: number = 3): Promise<void> {
    const supabase = getSupabase();
    if (!supabase || !isSupabaseConfigured) return;

    const authUserId = await this.getAuthenticatedUserId();
    if (!authUserId) {
      console.warn('[SyncEngine] Usuário não autenticado no Supabase. A nota permanecerá apenas local.');
      return;
    }

    const canonicalNoteId = toCanonicalUuid(note.id);
    const canonicalNodeId = toCanonicalUuid(note.nodeId);

    // Garante que o node existe no Supabase antes de inserir a note (evita chave estrangeira inválida)
    const localNode = await indexedDbService.getNode(note.nodeId);
    if (localNode) {
      await this.syncNode(localNode, 2);
    }

    const payload = {
      id: canonicalNoteId,
      node_id: canonicalNodeId,
      user_id: authUserId,
      markdown_content: note.markdownContent ?? '',
      editor_content: note.editorContent ?? null,
      is_favorite: Boolean(note.isFavorite),
      last_opened_at: note.lastOpenedAt ?? null,
      version: Number(note.version || 1),
      updated_at: note.updatedAt || new Date().toISOString(),
    };

    let attempt = 0;
    while (attempt < maxRetries) {
      attempt++;
      try {
        const { error } = await supabase.from('notes').upsert(payload, { onConflict: 'node_id' });
        if (!error) {
          return;
        }
        console.error(
          `[SyncEngine] Erro ao sincronizar note (nodeId: ${note.nodeId}) no Supabase [Tentativa ${attempt}/${maxRetries}]:`,
          error.message,
          error.details,
          error.code
        );
      } catch (err) {
        console.error(`[SyncEngine] Exceção de rede no syncNote (tentativa ${attempt}/${maxRetries}):`, err);
      }

      if (attempt < maxRetries) {
        await new Promise((res) => setTimeout(res, 500 * Math.pow(2, attempt - 1)));
      }
    }
  }

  /**
   * Enfileira salvamento com serialização por nota e mescla de digitações rápidas.
   * Se o usuário digitar "abc", "abcd", "abcde":
   * Apenas o estado final "abcde" é enviado sem concorrência ou duplicação.
   */
  async enqueueNoteSave(note: NoteRecord, node?: TreeNode): Promise<void> {
    const key = note.nodeId;

    if (this.inFlightNotes.has(key)) {
      // Já existe um salvamento em andamento para esta nota. Guarda o estado mais recente.
      this.pendingQueue.set(key, { note, node });
      return;
    }

    this.inFlightNotes.add(key);

    try {
      if (node) {
        await this.syncNode(node);
      }
      await this.syncNote(note);
    } catch (err) {
      console.error('[SyncEngine] Falha ao processar salvamento na fila:', err);
    } finally {
      this.inFlightNotes.delete(key);

      // Se novas edições chegaram enquanto o envio anterior estava em trânsito, processa a mais recente
      if (this.pendingQueue.has(key)) {
        const next = this.pendingQueue.get(key)!;
        this.pendingQueue.delete(key);
        // Chama recursivamente com a versão mais recente
        this.enqueueNoteSave(next.note, next.node);
      }
    }
  }

  /**
   * Sincroniza uma tag no Supabase.
   */
  async syncTag(tag: TagRecord): Promise<void> {
    const supabase = getSupabase();
    if (!supabase || !isSupabaseConfigured) return;

    const authUserId = await this.getAuthenticatedUserId();
    if (!authUserId) return;

    try {
      const { error } = await supabase.from('tags').upsert({
        id: toCanonicalUuid(tag.id),
        user_id: authUserId,
        name: tag.name,
        normalized_name: tag.normalizedName,
        created_at: tag.createdAt || new Date().toISOString(),
      }, { onConflict: 'id' });

      if (error) {
        console.error('[SyncEngine] Erro ao sincronizar tag no Supabase:', error.message);
      }
    } catch (err) {
      console.error('[SyncEngine] Falha ao sincronizar tag:', err);
    }
  }

  /**
   * Sincroniza relações note_tags no Supabase.
   */
  async syncNoteTags(userId: string, noteId: string, tagIds: string[]): Promise<void> {
    const supabase = getSupabase();
    if (!supabase || !isSupabaseConfigured) return;

    const authUserId = await this.getAuthenticatedUserId();
    if (!authUserId) return;

    const canonicalNoteId = toCanonicalUuid(noteId);

    try {
      // 1. Remove tags antigas da nota no Supabase
      const { error: delErr } = await supabase
        .from('note_tags')
        .delete()
        .eq('note_id', canonicalNoteId);

      if (delErr) {
        console.error('[SyncEngine] Erro ao limpar note_tags anteriores:', delErr.message);
      }

      // 2. Insere as novas tags
      if (tagIds.length > 0) {
        const rows = tagIds.map((tId) => ({
          note_id: canonicalNoteId,
          tag_id: toCanonicalUuid(tId),
          user_id: authUserId,
          created_at: new Date().toISOString(),
        }));

        const { error: insErr } = await supabase.from('note_tags').insert(rows);
        if (insErr) {
          console.error('[SyncEngine] Erro ao inserir note_tags:', insErr.message);
        }
      }
    } catch (err) {
      console.error('[SyncEngine] Falha ao sincronizar note_tags:', err);
    }
  }

  /**
   * Sincroniza relações note_links (backlinks) no Supabase.
   */
  async syncNoteLinks(userId: string, sourceNoteId: string, targetNoteIds: string[]): Promise<void> {
    const supabase = getSupabase();
    if (!supabase || !isSupabaseConfigured) return;

    const authUserId = await this.getAuthenticatedUserId();
    if (!authUserId) return;

    const canonicalSourceId = toCanonicalUuid(sourceNoteId);

    try {
      // 1. Remove links anteriores desta nota fonte
      await supabase.from('note_links').delete().eq('source_note_id', canonicalSourceId);

      // 2. Insere novos links
      const rows = targetNoteIds
        .filter((tId) => tId !== sourceNoteId)
        .map((tId) => ({
          id: crypto.randomUUID(),
          user_id: authUserId,
          source_note_id: canonicalSourceId,
          target_note_id: toCanonicalUuid(tId),
          created_at: new Date().toISOString(),
        }));

      if (rows.length > 0) {
        const { error } = await supabase.from('note_links').insert(rows);
        if (error) {
          console.error('[SyncEngine] Erro ao sincronizar note_links:', error.message);
        }
      }
    } catch (err) {
      console.error('[SyncEngine] Falha ao sincronizar note_links:', err);
    }
  }

  /**
   * Hidratação completa do IndexedDB a partir do Supabase ao iniciar sessão (Requirement 6)
   * e upload idempotente de notas locais ainda não sincronizadas (Requirement 7).
   */
  async hydrateFromRemote(userId: string): Promise<boolean> {
    const supabase = getSupabase();
    if (!supabase || !isSupabaseConfigured) return false;

    const authUserId = await this.getAuthenticatedUserId();
    if (!authUserId) {
      console.warn('[SyncEngine] Usuário não autenticado; ignorando hidratação remota.');
      return false;
    }

    try {
      console.info('[SyncEngine] Iniciando hidratação a partir do Supabase para o usuário:', authUserId);

      // 1. Busca paralela de todos os dados remotos
      const [nodesRes, notesRes, tagsRes, noteTagsRes, linksRes] = await Promise.all([
        supabase
          .from('nodes')
          .select('id, user_id, parent_id, type, name, position, created_at, updated_at, deleted_at')
          .eq('user_id', authUserId)
          .is('deleted_at', null)
          .order('position', { ascending: true }),
        supabase
          .from('notes')
          .select('*')
          .eq('user_id', authUserId),
        supabase
          .from('tags')
          .select('*')
          .eq('user_id', authUserId),
        supabase
          .from('note_tags')
          .select('*')
          .eq('user_id', authUserId),
        supabase
          .from('note_links')
          .select('*')
          .eq('user_id', authUserId),
      ]);

      if (nodesRes.error) {
        console.error('[SyncEngine] Erro ao consultar nodes no Supabase:', nodesRes.error.message);
      }
      if (notesRes.error) {
        console.error('[SyncEngine] Erro ao consultar notes no Supabase:', notesRes.error.message);
      }

      const remoteNodes = nodesRes.data || [];
      const remoteNotes = notesRes.data || [];
      const remoteTags = tagsRes.data || [];
      const remoteNoteTags = noteTagsRes.data || [];
      const remoteLinks = linksRes.data || [];

      // 2. Salva todos os registros remotos no IndexedDB local
      for (const d of remoteNodes) {
        const node: TreeNode = {
          id: d.id,
          userId: d.user_id,
          parentId: d.parent_id,
          type: d.type,
          name: d.name,
          position: Number(d.position),
          createdAt: d.created_at,
          updatedAt: d.updated_at,
          deletedAt: d.deleted_at,
        };
        await indexedDbService.saveNode(node);
      }

      for (const d of remoteNotes) {
        const note: NoteRecord = {
          id: d.id,
          nodeId: d.node_id,
          userId: d.user_id,
          markdownContent: d.markdown_content || '',
          editorContent: d.editor_content || null,
          isFavorite: Boolean(d.is_favorite),
          lastOpenedAt: d.last_opened_at,
          version: Number(d.version || 1),
          createdAt: d.created_at,
          updatedAt: d.updated_at,
        };
        await indexedDbService.saveNote(note);
      }

      for (const t of remoteTags) {
        const tag: TagRecord = {
          id: t.id,
          userId: t.user_id,
          name: t.name,
          normalizedName: t.normalized_name,
          createdAt: t.created_at,
        };
        await indexedDbService.saveTag(tag);
      }

      // Reconstitui note_tags no IndexedDB
      const tagMapByNote = new Map<string, string[]>();
      for (const nt of remoteNoteTags) {
        const list = tagMapByNote.get(nt.note_id) || [];
        list.push(nt.tag_id);
        tagMapByNote.set(nt.note_id, list);
      }
      for (const [nId, tIds] of tagMapByNote.entries()) {
        await indexedDbService.setNoteTags(authUserId, nId, tIds);
      }

      // Reconstitui note_links no IndexedDB
      const linkMapBySource = new Map<string, string[]>();
      for (const l of remoteLinks) {
        const list = linkMapBySource.get(l.source_note_id) || [];
        list.push(l.target_note_id);
        linkMapBySource.set(l.source_note_id, list);
      }
      for (const [sId, targets] of linkMapBySource.entries()) {
        await indexedDbService.setNoteLinks(authUserId, sId, targets);
      }

      // 3. Sincronização inversa (Requirement 7: Dados Locais Existentes):
      // Se houver notas ou pastas salvas localmente no IndexedDB que ainda não existam no Supabase, envia-os agora.
      const localNodes = await indexedDbService.getAllNodes(authUserId);
      const remoteNodeIdSet = new Set(remoteNodes.map((rn: any) => rn.id));

      for (const localNode of localNodes) {
        if (!remoteNodeIdSet.has(localNode.id) && !localNode.deletedAt) {
          console.info(`[SyncEngine] Enviando nó local não presente no Supabase: ${localNode.name} (${localNode.id})`);
          await this.syncNode(localNode);
        }
      }

      const localNotes = await indexedDbService.getAllNotes(authUserId);
      const remoteNoteIdSet = new Set(remoteNotes.map((rn: any) => rn.id));

      for (const localNote of localNotes) {
        if (!remoteNoteIdSet.has(localNote.id)) {
          console.info(`[SyncEngine] Enviando nota local não presente no Supabase: ${localNote.id}`);
          await this.syncNote(localNote);
        }
      }

      console.info('[SyncEngine] Hidratação concluída com sucesso!');
      return true;
    } catch (err) {
      console.error('[SyncEngine] Erro durante a hidratação remota:', err);
      return false;
    }
  }
}

export const syncEngine = new SyncEngineClass();
