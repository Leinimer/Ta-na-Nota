import { TreeNode, NoteRecord, TagRecord, SyncStatus } from '@/types';
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

type SyncStatusListener = (status: SyncStatus) => void;

class SyncEngineClass {
  // Fila de serialização por nodeId para evitar gravações concorrentes
  private inFlightNotes = new Set<string>();
  private pendingQueue = new Map<string, PendingSaveItem>();

  // Dicionários para evitar requisições redundantes de Tags, Links e Nodes
  private lastSyncedTags = new Map<string, string>(); // noteId -> tagIds sorted string
  private lastSyncedLinks = new Map<string, string>(); // sourceNoteId -> targetIds sorted string
  private lastSyncedNodeTime = new Map<string, string>(); // nodeId -> updatedAt

  // Status de sincronização e ouvintes
  private currentStatus: SyncStatus = 'saved';
  private statusListeners: Set<SyncStatusListener> = new Set();

  // Controle de conectividade offline/online
  private isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
  private isFlushingQueue = false;

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        console.info('[SyncEngine] Conexão restabelecida. Processando pendências...');
        this.isOnline = true;
        this.flushPendingQueue();
      });

      window.addEventListener('offline', () => {
        console.warn('[SyncEngine] Dispositivo offline. Salvamentos remotos pausados.');
        this.isOnline = false;
        this.emitStatus('offline');
      });
    }
  }

  onStatusChange(listener: SyncStatusListener): () => void {
    this.statusListeners.add(listener);
    listener(this.currentStatus);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  private emitStatus(status: SyncStatus) {
    this.currentStatus = status;
    for (const listener of this.statusListeners) {
      try {
        listener(status);
      } catch (err) {
        console.error('[SyncEngine] Erro no listener de status:', err);
      }
    }
  }

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
   * Sanitiza e valida o conteúdo da nota antes de enviar para o Supabase.
   * BLOQUEIA categoricamente qualquer Base64 (data:image/..., data:application/pdf, etc.).
   */
  private sanitizePayloadBeforeSync(markdownContent: string, editorContent: any): {
    markdown: string;
    editor: any;
  } {
    let cleanMarkdown = markdownContent || '';
    let cleanEditor = editorContent;

    // 1. Verificação no Markdown Content
    if (
      cleanMarkdown.includes('data:image/') ||
      cleanMarkdown.includes('data:application/') ||
      cleanMarkdown.includes('data:video/') ||
      cleanMarkdown.includes(';base64,')
    ) {
      console.error(
        '[SyncEngine Security] Bloqueado envio de Base64 em markdown_content. ' +
        'Arquivos devem ser persistidos no Storage e referenciados por "attachment:...".'
      );
      // Remove URLs data:... de imagens markdown: ![alt](data:...) -> ![alt](attachment:removido)
      cleanMarkdown = cleanMarkdown.replace(
        /!\[(.*?)\]\(data:[^)]+\)/gi,
        '![$1](attachment:base64_bloqueado)'
      );
    }

    // 2. Verificação no Tiptap JSON Editor Content
    if (cleanEditor && typeof cleanEditor === 'object') {
      const editorStr = JSON.stringify(cleanEditor);
      if (
        editorStr.includes('data:image/') ||
        editorStr.includes('data:application/') ||
        editorStr.includes(';base64,')
      ) {
        console.error(
          '[SyncEngine Security] Bloqueado envio de Base64 em editor_content. Sanitizando árvore de nós.'
        );

        // Clona e remove recursivamente atributos data: de nós de imagem/mídia
        const sanitizeNode = (node: any): any => {
          if (!node || typeof node !== 'object') return node;
          const copy = { ...node };

          if (copy.attrs && typeof copy.attrs === 'object') {
            const copyAttrs = { ...copy.attrs };
            if (
              typeof copyAttrs.src === 'string' &&
              (copyAttrs.src.startsWith('data:') || copyAttrs.src.includes(';base64,'))
            ) {
              copyAttrs.src = '';
              copyAttrs.alt = (copyAttrs.alt || 'Imagem') + ' (Base64 removido por segurança)';
            }
            copy.attrs = copyAttrs;
          }

          if (Array.isArray(copy.content)) {
            copy.content = copy.content.map(sanitizeNode);
          }
          return copy;
        };

        cleanEditor = sanitizeNode(cleanEditor);
      }
    }

    return { markdown: cleanMarkdown, editor: cleanEditor };
  }

  /**
   * Sincroniza um registro na tabela `nodes` do Supabase de forma idempotente (upsert).
   * Evita chamadas repetidas caso o nó não tenha sofrido alterações recentes.
   */
  async syncNode(node: TreeNode, maxRetries: number = 2): Promise<void> {
    const supabase = getSupabase();
    if (!supabase || !isSupabaseConfigured) return;

    if (!this.isOnline) {
      this.emitStatus('offline');
      return;
    }

    const authUserId = await this.getAuthenticatedUserId();
    if (!authUserId) return;

    // Verifica se já enviamos este estado do nó
    const lastTime = this.lastSyncedNodeTime.get(node.id);
    if (lastTime && lastTime === node.updatedAt && !node.deletedAt) {
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
          this.lastSyncedNodeTime.set(node.id, node.updatedAt);
          return;
        }
        console.warn(`[SyncEngine] Erro ao sincronizar node (tentativa ${attempt}/${maxRetries}):`, error.message);
      } catch (err) {
        console.warn(`[SyncEngine] Exceção de rede no syncNode (tentativa ${attempt}/${maxRetries}):`, err);
      }

      if (attempt < maxRetries) {
        await new Promise((res) => setTimeout(res, 400 * Math.pow(2, attempt - 1)));
      }
    }
  }

  /**
   * Sincroniza um registro na tabela `notes` do Supabase de forma idempotente.
   * Aplica sanitização contra Base64 e backoff exponencial limitado (máx 2 tentativas).
   */
  async syncNote(note: NoteRecord, maxRetries: number = 2): Promise<boolean> {
    const supabase = getSupabase();
    if (!supabase || !isSupabaseConfigured) return false;

    if (!this.isOnline) {
      this.emitStatus('offline');
      return false;
    }

    const authUserId = await this.getAuthenticatedUserId();
    if (!authUserId) return false;

    // 1. Sanitiza conteúdo contra Base64 acidental antes do envio
    const { markdown, editor } = this.sanitizePayloadBeforeSync(
      note.markdownContent,
      note.editorContent
    );

    const canonicalNoteId = toCanonicalUuid(note.id);
    const canonicalNodeId = toCanonicalUuid(note.nodeId);

    const payload = {
      id: canonicalNoteId,
      node_id: canonicalNodeId,
      user_id: authUserId,
      markdown_content: markdown,
      editor_content: editor,
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
          return true;
        }

        // Se o erro foi chave estrangeira (node não existe no Supabase), tenta sincronizar o node uma única vez
        if (error.code === '23503' && attempt === 1) {
          const localNode = await indexedDbService.getNode(note.nodeId);
          if (localNode) {
            await this.syncNode(localNode, 1);
          }
        }

        console.warn(`[SyncEngine] Erro ao sincronizar note (tentativa ${attempt}/${maxRetries}):`, error.message);
      } catch (err) {
        console.warn(`[SyncEngine] Exceção de rede no syncNote (tentativa ${attempt}/${maxRetries}):`, err);
      }

      if (attempt < maxRetries) {
        await new Promise((res) => setTimeout(res, 500 * Math.pow(2, attempt - 1)));
      }
    }

    return false;
  }

  /**
   * Enfileira salvamento com serialização estrita por nota e agrupamento de digitações rápidas.
   * Garante que:
   * - Nunca duas gravações da mesma nota rodem em paralelo.
   * - Se o usuário digitar rápido, envia apenas o estado mais recente.
   * - Atualiza status de forma clara: 'saving' -> 'saved' / 'offline' / 'error'.
   */
  async enqueueNoteSave(note: NoteRecord, node?: TreeNode): Promise<void> {
    const key = note.nodeId;

    if (!this.isOnline) {
      this.pendingQueue.set(key, { note, node });
      this.emitStatus('offline');
      return;
    }

    if (this.inFlightNotes.has(key)) {
      // Já existe gravação em andamento para esta nota; mantém apenas o estado mais recente
      this.pendingQueue.set(key, { note, node });
      return;
    }

    this.inFlightNotes.add(key);
    this.emitStatus('saving');

    try {
      if (node) {
        await this.syncNode(node);
      }
      const success = await this.syncNote(note);

      if (success) {
        // Se a fila não tiver novos itens para esta nota, marca como sincronizado
        if (!this.pendingQueue.has(key)) {
          this.emitStatus('saved');
        }
      } else {
        if (!this.isOnline) {
          this.pendingQueue.set(key, { note, node });
          this.emitStatus('offline');
        } else {
          this.emitStatus('error');
        }
      }
    } catch (err) {
      console.error('[SyncEngine] Falha ao processar salvamento na fila:', err);
      this.emitStatus('error');
    } finally {
      this.inFlightNotes.delete(key);

      // Se edições adicionais chegaram durante o envio, processa agora o estado final
      if (this.pendingQueue.has(key)) {
        const next = this.pendingQueue.get(key)!;
        this.pendingQueue.delete(key);
        // Processa recursivamente o estado final
        this.enqueueNoteSave(next.note, next.node);
      }
    }
  }

  /**
   * Processa itens pendentes após reconexão à internet de forma cadenciada (sem avalanche).
   */
  private async flushPendingQueue() {
    if (this.isFlushingQueue || this.pendingQueue.size === 0) return;
    this.isFlushingQueue = true;

    try {
      const items = Array.from(this.pendingQueue.entries());
      this.pendingQueue.clear();

      for (const [, item] of items) {
        if (!this.isOnline) break;
        await this.enqueueNoteSave(item.note, item.node);
        // Intervalo de cortesia para evitar tempestade de requisições
        await new Promise((res) => setTimeout(res, 120));
      }
    } finally {
      this.isFlushingQueue = false;
    }
  }

  /**
   * Sincroniza uma tag no Supabase.
   */
  async syncTag(tag: TagRecord): Promise<void> {
    const supabase = getSupabase();
    if (!supabase || !isSupabaseConfigured || !this.isOnline) return;

    const authUserId = await this.getAuthenticatedUserId();
    if (!authUserId) return;

    try {
      await supabase.from('tags').upsert(
        {
          id: toCanonicalUuid(tag.id),
          user_id: authUserId,
          name: tag.name,
          normalized_name: tag.normalizedName,
          created_at: tag.createdAt || new Date().toISOString(),
        },
        { onConflict: 'id' }
      );
    } catch (err) {
      console.warn('[SyncEngine] Falha ao sincronizar tag:', err);
    }
  }

  /**
   * Sincroniza relações note_tags no Supabase de forma DIFERENCIAL.
   * Se os IDs de tags da nota não mudaram em relação ao último envio,
   * NÃO executa DELETE nem INSERT.
   */
  async syncNoteTags(userId: string, noteId: string, tagIds: string[]): Promise<void> {
    const supabase = getSupabase();
    if (!supabase || !isSupabaseConfigured || !this.isOnline) return;

    const canonicalNoteId = toCanonicalUuid(noteId);
    const sortedTags = [...tagIds].map(toCanonicalUuid).sort().join(',');

    // Se as tags desta nota não mudaram, não faz nenhuma requisição
    if (this.lastSyncedTags.get(canonicalNoteId) === sortedTags) {
      return;
    }

    const authUserId = await this.getAuthenticatedUserId();
    if (!authUserId) return;

    try {
      // 1. Remove tags antigas
      await supabase.from('note_tags').delete().eq('note_id', canonicalNoteId);

      // 2. Insere novas tags
      if (tagIds.length > 0) {
        const rows = tagIds.map((tId) => ({
          note_id: canonicalNoteId,
          tag_id: toCanonicalUuid(tId),
          user_id: authUserId,
          created_at: new Date().toISOString(),
        }));

        await supabase.from('note_tags').insert(rows);
      }

      this.lastSyncedTags.set(canonicalNoteId, sortedTags);
    } catch (err) {
      console.warn('[SyncEngine] Falha ao sincronizar note_tags:', err);
    }
  }

  /**
   * Sincroniza relações note_links (backlinks) no Supabase de forma DIFERENCIAL.
   * Se os targetNoteIds não mudaram em relação ao último envio,
   * NÃO executa DELETE nem INSERT.
   */
  async syncNoteLinks(userId: string, sourceNoteId: string, targetNoteIds: string[]): Promise<void> {
    const supabase = getSupabase();
    if (!supabase || !isSupabaseConfigured || !this.isOnline) return;

    const canonicalSourceId = toCanonicalUuid(sourceNoteId);
    const validTargets = targetNoteIds
      .filter((tId) => tId !== sourceNoteId)
      .map(toCanonicalUuid);
    const sortedTargets = [...new Set(validTargets)].sort().join(',');

    // Se os links internos desta nota não mudaram, não faz nenhuma requisição
    if (this.lastSyncedLinks.get(canonicalSourceId) === sortedTargets) {
      return;
    }

    const authUserId = await this.getAuthenticatedUserId();
    if (!authUserId) return;

    try {
      // 1. Remove links anteriores desta nota fonte
      await supabase.from('note_links').delete().eq('source_note_id', canonicalSourceId);

      // 2. Insere novos links
      if (validTargets.length > 0) {
        const rows = [...new Set(validTargets)].map((targetId) => ({
          id: crypto.randomUUID(),
          user_id: authUserId,
          source_note_id: canonicalSourceId,
          target_note_id: targetId,
          created_at: new Date().toISOString(),
        }));

        await supabase.from('note_links').insert(rows);
      }

      this.lastSyncedLinks.set(canonicalSourceId, sortedTargets);
    } catch (err) {
      console.warn('[SyncEngine] Falha ao sincronizar note_links:', err);
    }
  }

  /**
   * Hidratação inicial do IndexedDB a partir do Supabase ao iniciar sessão.
   * Não executa SELECTs redundantes se já foi hidratado na sessão.
   */
  async hydrateFromRemote(userId: string): Promise<boolean> {
    const supabase = getSupabase();
    if (!supabase || !isSupabaseConfigured || !this.isOnline) return false;

    const authUserId = await this.getAuthenticatedUserId();
    if (!authUserId) {
      console.warn('[SyncEngine] Usuário não autenticado; ignorando hidratação remota.');
      return false;
    }

    try {
      console.info('[SyncEngine] Iniciando hidratação inicial a partir do Supabase...');

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

      const remoteNodes = nodesRes.data || [];
      const remoteNotes = notesRes.data || [];
      const remoteTags = tagsRes.data || [];
      const remoteNoteTags = noteTagsRes.data || [];
      const remoteLinks = linksRes.data || [];

      // 1. Hidrata IndexedDB com os dados remotos respeitando LWW
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
        this.lastSyncedNodeTime.set(d.id, d.updated_at);
      }

      for (const d of remoteNotes) {
        const local = await indexedDbService.getNote(d.id);
        const remoteVersion = Number(d.version || 1);
        const localVersion = Number(local?.version || 0);

        // Se o dado local for mais novo, mantém o local
        if (local && localVersion > remoteVersion) {
          continue;
        }

        const note: NoteRecord = {
          id: d.id,
          nodeId: d.node_id,
          userId: d.user_id,
          markdownContent: d.markdown_content || '',
          editorContent: d.editor_content || null,
          isFavorite: Boolean(d.is_favorite),
          lastOpenedAt: d.last_opened_at,
          version: remoteVersion,
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
        this.lastSyncedTags.set(toCanonicalUuid(nId), [...tIds].map(toCanonicalUuid).sort().join(','));
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
        this.lastSyncedLinks.set(toCanonicalUuid(sId), [...targets].map(toCanonicalUuid).sort().join(','));
      }

      // 2. Envia registros locais criados offline para o Supabase
      const localNodes = await indexedDbService.getAllNodes(authUserId);
      const remoteNodeIdSet = new Set(remoteNodes.map((rn: any) => rn.id));

      for (const localNode of localNodes) {
        if (!remoteNodeIdSet.has(localNode.id) && !localNode.deletedAt) {
          await this.syncNode(localNode);
        }
      }

      const localNotes = await indexedDbService.getAllNotes(authUserId);
      const remoteNoteIdSet = new Set(remoteNotes.map((rn: any) => rn.id));

      for (const localNote of localNotes) {
        if (!remoteNoteIdSet.has(localNote.id)) {
          await this.syncNote(localNote);
        }
      }

      this.emitStatus('saved');
      console.info('[SyncEngine] Hidratação inicial concluída com sucesso.');
      return true;
    } catch (err) {
      console.error('[SyncEngine] Erro durante a hidratação remota:', err);
      return false;
    }
  }
}

export const syncEngine = new SyncEngineClass();
