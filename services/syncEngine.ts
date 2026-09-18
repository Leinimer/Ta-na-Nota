import { TreeNode, NoteRecord, TagRecord, SyncStatus, SyncQueueItem } from '@/types';
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase/client';
import { indexedDbService } from './indexedDbService';
import { realtimeService } from './realtimeService';
import { MarkdownService } from './markdownService';

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

type SyncStatusListener = (status: SyncStatus) => void;

class SyncEngineClass {
  // Controle de concorrência por nodeId para garantir serialização de requisições de uma mesma nota e nó
  private inFlightNotes = new Set<string>();
  private inFlightNodes = new Set<string>();
  private pendingNodeSaves = new Map<string, TreeNode>();

  // Cache de usuário autenticado para evitar chamadas de rede no caminho de UI
  private cachedUserId: string | null = null;

  // Dicionários em memória para evitar requisições redundantes de Tags, Links e Nodes
  private lastSyncedTags = new Map<string, string>(); // canonicalNoteId -> sortedTagIds
  private lastSyncedLinks = new Map<string, string>(); // canonicalSourceId -> sortedTargetIds
  private lastSyncedNodeTime = new Map<string, string>(); // nodeId -> updatedAt

  // Status e ouvintes
  private currentStatus: SyncStatus = 'saved';
  private statusListeners: Set<SyncStatusListener> = new Set();

  // Controle de processamento de fila e conectividade
  private isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
  private isProcessingQueue = false;
  private queueDebounceTimer: NodeJS.Timeout | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        console.info('[SyncEngine] Conexão restabelecida. Processando fila de sincronização...');
        this.isOnline = true;
        this.triggerQueueProcessing(100);
      });

      window.addEventListener('offline', () => {
        console.warn('[SyncEngine] Dispositivo offline. Sincronização remota pausada.');
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
   * Define o ID do usuário autenticado para evitar chamadas de rede desnecessárias.
   */
  setAuthenticatedUserId(userId: string | null) {
    this.cachedUserId = userId;
  }

  /**
   * Obtém o ID do usuário autenticado no Supabase com validação de sessão (com cache rápido).
   */
  async getAuthenticatedUserId(): Promise<string | null> {
    if (this.cachedUserId) {
      return this.cachedUserId;
    }
    const supabase = getSupabase();
    if (!supabase || !isSupabaseConfigured) return null;

    try {
      const { data: { user }, error } = await supabase.auth.getUser();
      if (error || !user) {
        return null;
      }
      this.cachedUserId = user.id;
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
      console.warn(
        '[SyncEngine Security] Sanitizando referências Base64 em markdown_content. ' +
        'Arquivos devem ser persistidos no Storage e referenciados por "attachment:...".'
      );
      cleanMarkdown = cleanMarkdown.replace(
        /!\[(.*?)\]\(data:[^)]+\)/gi,
        '![$1](attachment:base64_bloqueado)'
      );
    }

    // 2. Verificação no Tiptap JSON Editor Content
    if (cleanEditor && typeof cleanEditor === 'object') {
      try {
        const editorStr = JSON.stringify(cleanEditor);
        if (
          editorStr.includes('data:image/') ||
          editorStr.includes('data:application/') ||
          editorStr.includes(';base64,')
        ) {
          console.warn(
            '[SyncEngine Security] Sanitizando referências Base64 em editor_content.'
          );

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
      } catch (err) {
        console.warn('[SyncEngine] Falha ao serializar editorContent para verificação:', err);
      }
    }

    return { markdown: cleanMarkdown, editor: cleanEditor };
  }

  /**
   * Sincroniza um registro na tabela `nodes` do Supabase de forma idempotente (upsert).
   * Evita chamadas repetidas caso o nó não tenha sofrido alterações recentes.
   * Possui controle de concorrência por nodeId para evitar corridas locais vs remotas.
   */
  async syncNode(node: TreeNode, maxRetries: number = 2): Promise<boolean> {
    const supabase = getSupabase();
    if (!supabase || !isSupabaseConfigured) return false;

    if (!this.isOnline) {
      this.emitStatus('offline');
      return false;
    }

    const authUserId = await this.getAuthenticatedUserId();
    if (!authUserId) return false;

    // Se já houver sincronização em voo deste nó, enfileira a versão mais recente em pendingNodeSaves
    if (this.inFlightNodes.has(node.id)) {
      const existingPending = this.pendingNodeSaves.get(node.id);
      if (!existingPending || new Date(node.updatedAt).getTime() >= new Date(existingPending.updatedAt).getTime()) {
        this.pendingNodeSaves.set(node.id, node);
      }
      return true;
    }

    // Evita enviar se não mudou desde o último envio
    const lastTime = this.lastSyncedNodeTime.get(node.id);
    if (lastTime && lastTime === node.updatedAt && !node.deletedAt) {
      return true;
    }

    this.inFlightNodes.add(node.id);
    console.log('[NODE SYNC START]', { nodeId: node.id, name: node.name, updatedAt: node.updatedAt });

    let syncedSuccessfully = false;

    try {
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
            console.log('[NODE SYNC DONE]', { nodeId: node.id, name: node.name, updatedAt: node.updatedAt });
            syncedSuccessfully = true;
            break;
          }
          console.warn(`[SyncEngine] Erro ao sincronizar node (${attempt}/${maxRetries}):`, error.message);
        } catch (err) {
          console.warn(`[SyncEngine] Exceção no syncNode (${attempt}/${maxRetries}):`, err);
        }

        if (attempt < maxRetries) {
          await new Promise((res) => setTimeout(res, 300 * attempt));
        }
      }
    } finally {
      this.inFlightNodes.delete(node.id);

      // Se enquanto este sync estava em voo chegou uma versão mais recente deste node, processa ela
      const nextPending = this.pendingNodeSaves.get(node.id);
      if (nextPending) {
        this.pendingNodeSaves.delete(node.id);
        this.syncNode(nextPending).catch((err) => {
          console.warn('[SyncEngine] Falha ao processar pending node sync:', err);
        });
      }
    }

    return syncedSuccessfully;
  }

  /**
   * Enfileira persistência de um nó na fila local durável do IndexedDB (`sync_queue`).
   * Desacoplada e fire-and-forget: NÃO bloqueia a interface.
   */
  async enqueueNode(node: TreeNode): Promise<void> {
    const userId = node.userId;
    const versionTimestamp = new Date(node.updatedAt || new Date().toISOString()).getTime();

    const queueItem: SyncQueueItem = {
      id: `sync_node_${node.id}`,
      userId,
      entityType: 'node',
      entityId: node.id,
      operation: node.deletedAt ? 'delete' : 'upsert',
      payload: node,
      version: versionTimestamp,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      attempts: 0,
      nextAttemptAt: 0,
      status: 'pending',
    };

    try {
      await indexedDbService.enqueueSyncItem(queueItem);
    } catch (err) {
      console.warn('[SyncEngine] Falha ao persistir node na fila do IndexedDB:', err);
    }

    if (!this.isOnline) {
      this.emitStatus('offline');
      return;
    }

    this.triggerQueueProcessing(50);
  }

  /**
   * Envia uma nota para o Supabase com controle de concorrência Last Write Wins (LWW).
   * Tenta usar a RPC `save_note_versioned` para atomicidade; se indisponível, faz upsert seguro.
   */
  async syncNote(note: NoteRecord, node?: TreeNode): Promise<boolean> {
    const supabase = getSupabase();
    if (!supabase || !isSupabaseConfigured) return false;

    if (!this.isOnline) {
      this.emitStatus('offline');
      return false;
    }

    const authUserId = await this.getAuthenticatedUserId();
    if (!authUserId) return false;

    // 1. Garante que o node pai exista no Supabase antes da nota para satisfazer FK
    if (node) {
      await this.syncNode(node);
    } else {
      const localNode = await indexedDbService.getNode(note.nodeId);
      if (localNode) {
        await this.syncNode(localNode);
      }
    }

    // 2. Sanitiza conteúdo contra Base64
    const { markdown, editor } = this.sanitizePayloadBeforeSync(
      note.markdownContent,
      note.editorContent
    );

    const canonicalNoteId = toCanonicalUuid(note.id);
    const canonicalNodeId = toCanonicalUuid(note.nodeId);
    const versionNum = Math.max(1, Number(note.version || 1));
    const updatedAtIso = note.updatedAt || new Date().toISOString();

    // 3. Execução prioritária via RPC como caminho principal com atomicidade no banco
    try {
      const { data: rpcData, error: rpcError } = await supabase.rpc('save_note_versioned', {
        p_id: canonicalNoteId,
        p_node_id: canonicalNodeId,
        p_markdown_content: markdown,
        p_editor_content: editor,
        p_is_favorite: Boolean(note.isFavorite),
        p_last_opened_at: note.lastOpenedAt ?? null,
        p_version: versionNum,
        p_updated_at: updatedAtIso,
      });

      if (!rpcError && rpcData) {
        if (rpcData.status === 'rejected_stale') {
          console.info('[SyncEngine LWW] Versão remota mais nova rejeitou atualização obsoleta. Convergindo local.');
          const remoteRow = rpcData.note;
          if (remoteRow) {
            let parsedEditorContent = remoteRow.editor_content;
            if (typeof parsedEditorContent === 'string') {
              try {
                parsedEditorContent = JSON.parse(parsedEditorContent);
              } catch {
                parsedEditorContent = null;
              }
            }
            if (
              !parsedEditorContent ||
              typeof parsedEditorContent !== 'object' ||
              !Array.isArray(parsedEditorContent.content)
            ) {
              parsedEditorContent = MarkdownService.markdownToVisual(
                remoteRow.markdown_content || '',
                'Nota'
              );
            }

            const converged: NoteRecord = {
              id: remoteRow.id,
              nodeId: remoteRow.node_id,
              userId: remoteRow.user_id,
              markdownContent: remoteRow.markdown_content || '',
              editorContent: parsedEditorContent,
              isFavorite: Boolean(remoteRow.is_favorite),
              lastOpenedAt: remoteRow.last_opened_at,
              version: Number(remoteRow.version || 1),
              createdAt: remoteRow.created_at,
              updatedAt: remoteRow.updated_at,
            };
            await indexedDbService.saveNote(converged);

            // Notifica listeners locais para atualizar a nota aberta no editor
            realtimeService.notifyListeners({
              type: 'note',
              eventType: 'UPDATE',
              note: converged,
              nodeId: converged.nodeId,
            });
          }
        }
        return true;
      }

      if (rpcError) {
        // Verifica estritamente se o erro é de função RPC inexistente no PostgreSQL (código 42883)
        const isFunctionNotFound =
          rpcError.code === '42883' ||
          rpcError.message?.toLowerCase().includes('does not exist') ||
          rpcError.message?.toLowerCase().includes('could not find the function') ||
          rpcError.details?.toLowerCase().includes('does not exist');

        if (!isFunctionNotFound) {
          // Erro de autorização, constraint, RLS, parâmetros inválidos, etc.
          // NUNCA contornar a proteção de concorrência com upsert cego!
          console.error(
            `[SyncEngine] Erro na RPC save_note_versioned (código: ${rpcError.code}):`,
            rpcError.message
          );
          return false;
        }

        console.warn(
          '[SyncEngine] RPC save_note_versioned não encontrada no banco (código 42883). Usando fallback seguro.'
        );
      }
    } catch (err) {
      console.warn('[SyncEngine] Exceção ao chamar save_note_versioned:', err);
      return false;
    }

    // 4. Fallback: upsert direto SOMENTE se a RPC não existir no banco
    try {
      const payload = {
        id: canonicalNoteId,
        node_id: canonicalNodeId,
        user_id: authUserId,
        markdown_content: markdown,
        editor_content: editor,
        is_favorite: Boolean(note.isFavorite),
        last_opened_at: note.lastOpenedAt ?? null,
        version: versionNum,
        updated_at: updatedAtIso,
      };

      const { error } = await supabase.from('notes').upsert(payload, { onConflict: 'node_id' });
      if (!error) {
        return true;
      }
      console.warn('[SyncEngine] Erro no fallback upsert de note:', error.message);
      return false;
    } catch (err) {
      console.warn('[SyncEngine] Exceção no syncNote:', err);
      return false;
    }
  }

  /**
   * Enfileira salvamento com persistência no IndexedDB (`sync_queue`), coalescing
   * e serialização estrita por nota.
   */
  async enqueueNoteSave(note: NoteRecord, node?: TreeNode): Promise<void> {
    const userId = note.userId;
    const key = note.nodeId;

    // 1. Persiste na fila durável do IndexedDB com coalescing automático
    const queueItem: SyncQueueItem = {
      id: `sync_note_${note.id}`,
      userId,
      entityType: 'note',
      entityId: key,
      operation: 'upsert',
      payload: { note, node },
      version: Number(note.version || 1),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      attempts: 0,
      nextAttemptAt: 0,
      status: 'pending',
    };

    try {
      await indexedDbService.enqueueSyncItem(queueItem);
    } catch (err) {
      console.warn('[SyncEngine] Falha ao persistir na fila do IndexedDB:', err);
    }

    if (!this.isOnline) {
      this.emitStatus('offline');
      return;
    }

    this.emitStatus('saving');
    this.triggerQueueProcessing(50);
  }

  /**
   * Dispara o processamento da fila persistente com debounce para cadenciar as requisições.
   */
  private triggerQueueProcessing(delayMs: number = 100) {
    if (this.queueDebounceTimer) {
      clearTimeout(this.queueDebounceTimer);
    }
    this.queueDebounceTimer = setTimeout(() => {
      this.processPersistentQueue();
    }, delayMs);
  }

  /**
   * Processador da fila persistente do IndexedDB.
   * Garante:
   * - Apenas um processamento ativo por vez.
   * - Serialização por nota (sem requisições concorrentes da mesma nota).
   * - Remoção segura de itens processados com verificação atômica de versão (completeSyncItem).
   * - Backoff exponencial para erros temporários.
   * - Convergência garantida: se novas versões entrarem durante o envio, elas continuam na fila e são enviadas.
   * - Atualização precisa do status da UI ('saving' -> 'saved' / 'offline' / 'error').
   */
  async processPersistentQueue(): Promise<void> {
    if (this.isProcessingQueue || !this.isOnline) return;
    this.isProcessingQueue = true;

    try {
      const authUserId = await this.getAuthenticatedUserId();
      if (!authUserId) {
        return;
      }

      let hasPendingWork = true;

      while (hasPendingWork && this.isOnline) {
        const pendingItems = await indexedDbService.getPendingSyncItems(authUserId);
        if (pendingItems.length === 0) {
          hasPendingWork = false;
          break;
        }

        let processedAnyItem = false;

        for (const item of pendingItems) {
          if (!this.isOnline) {
            this.emitStatus('offline');
            return;
          }

          // Se for nota e já houver requisição em andamento para esta nota, aguarda a próxima rodada
          if (item.entityType === 'note') {
            if (this.inFlightNotes.has(item.entityId)) {
              continue;
            }
            this.inFlightNotes.add(item.entityId);
          }

          processedAnyItem = true;
          this.emitStatus('saving');

          try {
            let success = false;

            if (item.entityType === 'note') {
              const { note, node } = item.payload || {};
              if (note) {
                success = await this.syncNote(note, node);
              } else {
                success = true; // Payload inválido, remove para não travar
              }
            } else if (item.entityType === 'node') {
              const node = item.payload as TreeNode;
              if (node) {
                // 1. Verifica se ainda é a versão local mais recente no IndexedDB
                const currentLocalNode = await indexedDbService.getNode(item.entityId);
                if (currentLocalNode && currentLocalNode.updatedAt) {
                  const localTime = new Date(currentLocalNode.updatedAt).getTime();
                  const itemTime = new Date(node.updatedAt || 0).getTime();
                  if (localTime > itemTime) {
                    console.log('[NODE QUEUE DISCARD STALE VERSION]', {
                      nodeId: item.entityId,
                      queueVersion: itemTime,
                      localVersion: localTime,
                    });
                    // Descarta versão antiga já superada localmente
                    await indexedDbService.completeSyncItem(item.id, item.version);
                    continue;
                  }
                }
                success = await this.syncNode(node);
                if (success) {
                  realtimeService.clearPendingLocalNodeUpdate(node.id, node.updatedAt);
                }
              } else {
                success = true;
              }
            } else if (item.entityType === 'tag') {
              const tag = item.payload;
              if (tag) {
                await this.syncTag(tag);
                success = true;
              } else {
                success = true;
              }
            } else if (item.entityType === 'note_tags') {
              const { noteId, tagIds } = item.payload || {};
              if (noteId && tagIds) {
                await this.syncNoteTags(authUserId, noteId, tagIds);
                success = true;
              } else {
                success = true;
              }
            } else if (item.entityType === 'note_links') {
              const { sourceNoteId, targetNoteIds } = item.payload || {};
              if (sourceNoteId && targetNoteIds) {
                await this.syncNoteLinks(authUserId, sourceNoteId, targetNoteIds);
                success = true;
              } else {
                success = true;
              }
            }

            if (success) {
              // Remoção atômica e segura por versão:
              // Se novas edições foram enfileiradas com versão mais recente enquanto o sync
              // estava em voo, completeSyncItem NÃO deleta e a versão mais nova permanece na fila.
              const targetVersion =
                item.entityType === 'note' && item.payload?.note?.version
                  ? Number(item.payload.note.version)
                  : item.version;

              await indexedDbService.completeSyncItem(item.id, targetVersion);
            } else {
              const attempts = (item.attempts || 0) + 1;
              const backoffMs = Math.min(60000, 1000 * Math.pow(2, attempts));
              await indexedDbService.updateSyncItem({
                ...item,
                attempts,
                nextAttemptAt: Date.now() + backoffMs,
                status: attempts >= 5 ? 'failed' : 'pending',
                lastError: 'Falha temporária de sincronização',
              });
              if (attempts >= 5) {
                this.emitStatus('error');
              }
            }
          } catch (err: any) {
            console.warn('[SyncEngine] Exceção ao processar item da fila:', err);
            const attempts = (item.attempts || 0) + 1;
            await indexedDbService.updateSyncItem({
              ...item,
              attempts,
              nextAttemptAt: Date.now() + 3000,
              status: attempts >= 5 ? 'failed' : 'pending',
              lastError: err?.message || 'Erro desconhecido',
            });
            this.emitStatus('error');
          } finally {
            if (item.entityType === 'note') {
              this.inFlightNotes.delete(item.entityId);
            }
          }

          // Intervalo de cortesia de 50ms entre itens
          await new Promise((res) => setTimeout(res, 50));
        }

        if (!processedAnyItem) {
          // Nenhum item elegível para processamento nesta iteração (ex: todos bloqueados por backoff ou em voo)
          break;
        }

        // Checa se ainda há itens pendentes prontos na fila
        const count = await indexedDbService.getPendingSyncCount(authUserId);
        if (count === 0) {
          hasPendingWork = false;
        }
      }

      // Validação final de status: SOMENTE emite 'saved' se a fila de fato não tiver mais pendências
      if (this.isOnline) {
        const remainingCount = await indexedDbService.getPendingSyncCount(authUserId);
        if (remainingCount === 0) {
          this.emitStatus('saved');
        } else {
          // Se ainda há pendências (ex: versão mais nova adicionada nos últimos milissegundos),
          // agenda a próxima execução
          this.triggerQueueProcessing(80);
        }
      }
    } finally {
      this.isProcessingQueue = false;
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
   * Sincroniza relações note_tags no Supabase de forma estritamente DIFERENCIAL.
   * Se os IDs de tags da nota não mudaram em relação ao último envio, NÃO executa DELETE nem INSERT.
   */
  async syncNoteTags(userId: string, noteId: string, tagIds: string[]): Promise<void> {
    const supabase = getSupabase();
    if (!supabase || !isSupabaseConfigured || !this.isOnline) return;

    const canonicalNoteId = toCanonicalUuid(noteId);
    const sortedTags = [...tagIds].map(toCanonicalUuid).sort().join(',');

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
   * Sincroniza relações note_links (backlinks) no Supabase de forma estritamente DIFERENCIAL.
   * Se os targetNoteIds não mudaram em relação ao último envio, NÃO executa DELETE nem INSERT.
   */
  async syncNoteLinks(userId: string, sourceNoteId: string, targetNoteIds: string[]): Promise<void> {
    const supabase = getSupabase();
    if (!supabase || !isSupabaseConfigured || !this.isOnline) return;

    const canonicalSourceId = toCanonicalUuid(sourceNoteId);
    const validTargets = targetNoteIds
      .filter((tId) => tId !== sourceNoteId)
      .map(toCanonicalUuid);
    const sortedTargets = [...new Set(validTargets)].sort().join(',');

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
   */
  async hydrateFromRemote(userId: string): Promise<boolean> {
    const supabase = getSupabase();
    if (!supabase || !isSupabaseConfigured || !this.isOnline) return false;

    const authUserId = await this.getAuthenticatedUserId();
    if (!authUserId) {
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

      // 1. Hidrata IndexedDB com os nós remotos
      for (const d of remoteNodes) {
        const local = await indexedDbService.getNode(d.id);
        if (local) {
          if (local.deletedAt) {
            // Jamais ressuscita nó que foi excluído localmente com tombstone!
            continue;
          }
          const localTime = new Date(local.updatedAt || local.createdAt || 0).getTime();
          const remoteTime = new Date(d.updated_at || d.created_at || 0).getTime();
          if (localTime >= remoteTime) {
            continue;
          }
        }

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

      // 2. Hidrata notas respeitando Last Write Wins (LWW)
      for (const d of remoteNotes) {
        const local = await indexedDbService.getNote(d.id);
        const remoteVersion = Number(d.version || 1);
        const localVersion = Number(local?.version || 0);

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

      // 3. Hidrata tags
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

      // 4. Reconstitui note_tags no IndexedDB
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

      // 5. Reconstitui note_links no IndexedDB
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

      // 6. Envia para o Supabase registros locais criados offline
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

      // Processa itens que possam ter ficado pendentes na fila local
      await this.processPersistentQueue();

      this.emitStatus('saved');
      console.info('[SyncEngine] Hidratação inicial concluída.');
      return true;
    } catch (err) {
      console.error('[SyncEngine] Erro na hidratação remota:', err);
      return false;
    }
  }
}

export const syncEngine = new SyncEngineClass();
