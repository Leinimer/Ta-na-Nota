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
   * - Realiza verificação estrita de erros e confirmação de resposta antes do sucesso.
   * - Resolve conflitos comparando timestamps (Last Write Wins).
   * - Possui controle de concorrência por nodeId para evitar corridas locais vs remotas.
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

    // Se já houver sincronização em voo deste nó, retorna false para mantê-lo pendente na fila
    if (this.inFlightNodes.has(node.id)) {
      return false;
    }

    this.inFlightNodes.add(node.id);
    const localUpdatedAt = node.updatedAt || new Date().toISOString();
    console.log('[SYNC START]', {
      entityType: 'node',
      entityId: node.id,
      name: node.name,
      updatedAt: localUpdatedAt,
      isDeleted: Boolean(node.deletedAt),
    });

    let syncedSuccessfully = false;

    try {
      const canonicalId = toCanonicalUuid(node.id);
      const canonicalParentId = node.parentId ? toCanonicalUuid(node.parentId) : null;
      const localTime = new Date(localUpdatedAt).getTime();

      // 1. Verificação prévia de conflito comparando timestamps com o nó remoto existente
      try {
        const { data: remoteNode, error: checkError } = await supabase
          .from('nodes')
          .select('id, updated_at, deleted_at, name, position, parent_id, type')
          .eq('id', canonicalId)
          .maybeSingle();

        if (!checkError && remoteNode && remoteNode.updated_at) {
          const remoteTime = new Date(remoteNode.updated_at).getTime();

          if (remoteTime > localTime) {
            // Conflito detectado: o registro remoto é mais recente que a versão local
            console.log('[SYNC CONFLICT]', {
              entityType: 'node',
              entityId: node.id,
              localTime,
              remoteTime,
              winner: 'remote',
              reason: 'Remote node timestamp is strictly newer',
            });

            // Converge o estado local para o remoto soberano
            const convergedNode: TreeNode = {
              id: node.id,
              userId: authUserId,
              parentId: remoteNode.parent_id,
              type: remoteNode.type || node.type,
              name: remoteNode.name || node.name,
              position: Number(remoteNode.position ?? node.position),
              createdAt: node.createdAt,
              updatedAt: remoteNode.updated_at,
              deletedAt: remoteNode.deleted_at || undefined,
            };

            await indexedDbService.saveNode(convergedNode);
            this.lastSyncedNodeTime.set(node.id, remoteNode.updated_at);
            realtimeService.registerLocalNodeUpdate(node.id, remoteNode.updated_at, true);
            realtimeService.notifyListeners({
              type: 'node',
              eventType: remoteNode.deleted_at ? 'DELETE' : 'UPDATE',
              node: convergedNode,
              nodeId: node.id,
            });

            console.log('[SYNC SUCCESS]', {
              entityType: 'node',
              entityId: node.id,
              status: 'converged_to_remote_winner',
            });
            return true;
          } else if (remoteTime < localTime) {
            console.log('[SYNC CONFLICT]', {
              entityType: 'node',
              entityId: node.id,
              localTime,
              remoteTime,
              winner: 'local',
              reason: 'Local node timestamp is newer or equal',
            });
          }
        }
      } catch (conflictCheckErr) {
        console.warn('[SyncEngine] Falha não bloqueante na checagem de conflito do node:', conflictCheckErr);
      }

      const payload = {
        id: canonicalId,
        user_id: authUserId,
        parent_id: canonicalParentId,
        type: node.type,
        name: node.name || (node.type === 'folder' ? 'Nova pasta' : 'Sem título'),
        position: Number(node.position || 1000),
        updated_at: localUpdatedAt,
        deleted_at: node.deletedAt || null,
      };

      let attempt = 0;
      while (attempt < maxRetries) {
        attempt++;
        try {
          const { data, error } = await supabase
            .from('nodes')
            .upsert(payload, { onConflict: 'id' })
            .select('id, updated_at, deleted_at')
            .single();

          // Verificação estrita de resultado: erro nulo e retorno de ID correspondente
          if (!error && data && data.id === canonicalId) {
            this.lastSyncedNodeTime.set(node.id, data.updated_at || localUpdatedAt);
            console.log('[SYNC SUCCESS]', {
              entityType: 'node',
              entityId: node.id,
              updatedAt: data.updated_at,
            });
            syncedSuccessfully = true;
            break;
          }

          console.error('[SYNC FAILED]', {
            entityType: 'node',
            entityId: node.id,
            attempt,
            maxRetries,
            error: error || 'Database returned empty response on node upsert',
          });
        } catch (err: any) {
          console.error('[SYNC FAILED]', {
            entityType: 'node',
            entityId: node.id,
            attempt,
            maxRetries,
            error: err?.message || err,
          });
        }

        if (attempt < maxRetries) {
          await new Promise((res) => setTimeout(res, 300 * attempt));
        }
      }
    } finally {
      this.inFlightNodes.delete(node.id);
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
   * Envia uma nota para o Supabase com controle estrito de concorrência e comparação de timestamps.
   * Tenta usar a RPC `save_note_versioned` para atomicidade; se indisponível, faz upsert com
   * verificação estrita de resposta e resolução de conflito por timestamp.
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

    console.log('[SYNC START]', {
      entityType: 'note',
      entityId: note.id,
      nodeId: note.nodeId,
      version: note.version,
      updatedAt: note.updatedAt,
    });

    // 1. Garante que o node pai exista no Supabase antes da nota para satisfazer a chave estrangeira (FK)
    if (node) {
      const nodeSynced = await this.syncNode(node);
      if (!nodeSynced && !node.deletedAt) {
        console.warn('[SyncEngine] Node pai não pôde ser sincronizado antes da nota. Tentando prosseguir.');
      }
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
    const localTime = new Date(updatedAtIso).getTime();

    // 3. Execução prioritária via RPC como caminho principal com atomicidade no PostgreSQL
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
        // Status OK: operação atômica confirmada no banco
        if (rpcData.status === 'ok') {
          console.log('[SYNC SUCCESS]', {
            entityType: 'note',
            entityId: note.id,
            version: versionNum,
            method: 'rpc',
          });
          return true;
        }

        // Status rejected_stale: conflito de versão detectado. Resolve comparando timestamps.
        if (rpcData.status === 'rejected_stale') {
          const remoteRow = rpcData.note;
          if (remoteRow) {
            const remoteTime = new Date(remoteRow.updated_at || remoteRow.created_at || 0).getTime();

            if (remoteTime > localTime) {
              // Remote é mais novo por timestamp: Remote vence
              console.log('[SYNC CONFLICT]', {
                entityType: 'note',
                entityId: note.id,
                localTime,
                remoteTime,
                winner: 'remote',
                reason: 'Remote note timestamp is strictly newer',
                method: 'rpc',
              });

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

              // Notifica listeners locais para atualizar o editor e lista
              realtimeService.notifyListeners({
                type: 'note',
                eventType: 'UPDATE',
                note: converged,
                nodeId: converged.nodeId,
              });

              console.log('[SYNC SUCCESS]', {
                entityType: 'note',
                entityId: note.id,
                status: 'converged_to_remote_winner',
              });
              return true;
            } else {
              // Local é mais novo ou igual por timestamp: Local é SOBERANO!
              console.log('[SYNC CONFLICT]', {
                entityType: 'note',
                entityId: note.id,
                localTime,
                remoteTime,
                winner: 'local',
                reason: 'Local note timestamp is newer or equal; bumping version to supersede remote',
                method: 'rpc',
              });

              const bumpedVersion = Math.max(Number(remoteRow.version || 0), versionNum) + 1;
              const bumpedNote: NoteRecord = {
                ...note,
                version: bumpedVersion,
                updatedAt: new Date().toISOString(),
              };
              await indexedDbService.saveNote(bumpedNote);

              // Re-executa com versão incrementada para vencer a corrida no banco
              return await this.syncNote(bumpedNote, node);
            }
          }

          console.log('[SYNC SUCCESS]', {
            entityType: 'note',
            entityId: note.id,
            status: 'rejected_stale_without_remote_row',
          });
          return true;
        }

        console.error('[SYNC FAILED]', {
          entityType: 'note',
          entityId: note.id,
          error: `RPC returned unhandled status: ${rpcData.status}`,
        });
        return false;
      }

      if (rpcError) {
        // Verifica estritamente se o erro é de função RPC inexistente no PostgreSQL (código 42883)
        const isFunctionNotFound =
          rpcError.code === '42883' ||
          rpcError.message?.toLowerCase().includes('does not exist') ||
          rpcError.message?.toLowerCase().includes('could not find the function') ||
          rpcError.details?.toLowerCase().includes('does not exist');

        if (!isFunctionNotFound) {
          console.error('[SYNC FAILED]', {
            entityType: 'note',
            entityId: note.id,
            error: rpcError,
            method: 'rpc',
          });
          return false;
        }

        console.warn(
          '[SyncEngine] RPC save_note_versioned não encontrada no banco (código 42883). Usando fallback seguro com verificação estrita.'
        );
      }
    } catch (err: any) {
      console.error('[SYNC FAILED]', {
        entityType: 'note',
        entityId: note.id,
        error: err?.message || err,
        method: 'rpc',
      });
      return false;
    }

    // 4. Fallback com verificação estrita e resolução de conflito por timestamp
    try {
      // 4.1 Consulta nota remota existente para detectar conflito por timestamp
      const { data: existingRemote, error: fetchErr } = await supabase
        .from('notes')
        .select('id, node_id, user_id, markdown_content, editor_content, is_favorite, last_opened_at, version, created_at, updated_at')
        .eq('node_id', canonicalNodeId)
        .maybeSingle();

      if (fetchErr) {
        console.error('[SYNC FAILED]', {
          entityType: 'note',
          entityId: note.id,
          error: fetchErr,
          method: 'fallback_fetch',
        });
        return false;
      }

      let finalVersion = versionNum;

      if (existingRemote && existingRemote.updated_at) {
        const remoteTime = new Date(existingRemote.updated_at).getTime();

        if (remoteTime > localTime) {
          console.log('[SYNC CONFLICT]', {
            entityType: 'note',
            entityId: note.id,
            localTime,
            remoteTime,
            winner: 'remote',
            reason: 'Remote note timestamp is strictly newer',
            method: 'fallback',
          });

          let parsedEditorContent = existingRemote.editor_content;
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
              existingRemote.markdown_content || '',
              'Nota'
            );
          }

          const converged: NoteRecord = {
            id: existingRemote.id,
            nodeId: existingRemote.node_id,
            userId: existingRemote.user_id,
            markdownContent: existingRemote.markdown_content || '',
            editorContent: parsedEditorContent,
            isFavorite: Boolean(existingRemote.is_favorite),
            lastOpenedAt: existingRemote.last_opened_at,
            version: Number(existingRemote.version || 1),
            createdAt: existingRemote.created_at,
            updatedAt: existingRemote.updated_at,
          };
          await indexedDbService.saveNote(converged);
          realtimeService.notifyListeners({
            type: 'note',
            eventType: 'UPDATE',
            note: converged,
            nodeId: converged.nodeId,
          });

          console.log('[SYNC SUCCESS]', {
            entityType: 'note',
            entityId: note.id,
            status: 'converged_to_remote_winner',
            method: 'fallback',
          });
          return true;
        } else {
          console.log('[SYNC CONFLICT]', {
            entityType: 'note',
            entityId: note.id,
            localTime,
            remoteTime,
            winner: 'local',
            reason: 'Local note timestamp is newer or equal',
            method: 'fallback',
          });
          finalVersion = Math.max(Number(existingRemote.version || 0) + 1, versionNum);
        }
      }

      const payload = {
        id: canonicalNoteId,
        node_id: canonicalNodeId,
        user_id: authUserId,
        markdown_content: markdown,
        editor_content: editor,
        is_favorite: Boolean(note.isFavorite),
        last_opened_at: note.lastOpenedAt ?? null,
        version: finalVersion,
        updated_at: updatedAtIso,
      };

      const { data: upsertData, error: upsertErr } = await supabase
        .from('notes')
        .upsert(payload, { onConflict: 'node_id' })
        .select('id, node_id, version, updated_at')
        .single();

      // Verificação estrita dos dados retornados
      if (!upsertErr && upsertData && upsertData.node_id === canonicalNodeId) {
        console.log('[SYNC SUCCESS]', {
          entityType: 'note',
          entityId: note.id,
          version: upsertData.version,
          method: 'fallback_upsert',
        });
        return true;
      }

      console.error('[SYNC FAILED]', {
        entityType: 'note',
        entityId: note.id,
        error: upsertErr || 'Database returned empty response on note fallback upsert',
        method: 'fallback_upsert',
      });
      return false;
    } catch (err: any) {
      console.error('[SYNC FAILED]', {
        entityType: 'note',
        entityId: note.id,
        error: err?.message || err,
        method: 'fallback_exception',
      });
      return false;
    }
  }

  /**
   * Enfileira salvamento com persistência no IndexedDB (`sync_queue`), coalescing
   * e serialização estrita por nota.
   */
  async enqueueNoteSave(note: NoteRecord, node?: TreeNode): Promise<void> {
    const userId = note.userId;

    // 1. Persiste na fila durável do IndexedDB com coalescing automático
    const queueItem: SyncQueueItem = {
      id: `sync_note_${note.id}`,
      userId,
      entityType: 'note',
      entityId: note.id,
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
   * Processador robusto da fila persistente do IndexedDB.
   * Garante:
   * - Apenas um processamento ativo por vez.
   * - A versão mais recente no IndexedDB é tratada como SOBERANA (nunca envia dados obsoletos se edições mais novas existirem).
   * - Todas as operações no banco são estritamente verificadas ANTES de remover qualquer item da fila.
   * - Remoção segura de itens processados com verificação atômica de versão (completeSyncItem).
   * - Backoff exponencial para erros temporários.
   * - Convergência garantida: novas edições durante o envio permanecem na fila e são enviadas na próxima rodada.
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

        console.log('[QUEUE PROCESSING]', {
          userId: authUserId,
          pendingCount: pendingItems.length,
        });

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
            let targetVersionToClear = item.version;

            if (item.entityType === 'note') {
              // 1. Respeita a versão mais recente como soberana: busca o estado atual no IndexedDB
              const sovereignNote = await indexedDbService.getNote(item.entityId);
              let noteToSync = item.payload?.note as NoteRecord | undefined;
              const parentNode = item.payload?.node as TreeNode | undefined;

              if (sovereignNote) {
                const sovereignVersion = Number(sovereignNote.version || 1);
                const queueVersion = Number(noteToSync?.version || 1);
                const sovereignTime = new Date(sovereignNote.updatedAt || 0).getTime();
                const queueTime = new Date(noteToSync?.updatedAt || 0).getTime();

                if (sovereignVersion > queueVersion || (sovereignVersion === queueVersion && sovereignTime > queueTime)) {
                  console.log('[QUEUE SOVEREIGN REFRESH]', {
                    entityType: 'note',
                    entityId: item.entityId,
                    queueVersion,
                    sovereignVersion,
                    queueTime,
                    sovereignTime,
                    action: 'Promoting latest local IndexedDB note to sovereign sync target',
                  });
                  noteToSync = sovereignNote;
                  targetVersionToClear = sovereignVersion;
                } else if (noteToSync) {
                  targetVersionToClear = queueVersion;
                }
              }

              if (noteToSync) {
                success = await this.syncNote(noteToSync, parentNode);
              } else {
                console.warn('[QUEUE DISCARD INVALID]', { entityType: 'note', itemId: item.id });
                success = true; // Payload vazio ou inválido, limpa da fila
              }
            } else if (item.entityType === 'node') {
              // 1. Respeita a versão mais recente do node como soberana
              const sovereignNode = await indexedDbService.getNode(item.entityId);
              let nodeToSync = item.payload as TreeNode | undefined;

              if (sovereignNode && sovereignNode.updatedAt) {
                const sovereignTime = new Date(sovereignNode.updatedAt).getTime();
                const queueTime = new Date(nodeToSync?.updatedAt || 0).getTime();

                if (sovereignTime > queueTime) {
                  console.log('[QUEUE SOVEREIGN REFRESH]', {
                    entityType: 'node',
                    entityId: item.entityId,
                    queueTime,
                    sovereignTime,
                    action: 'Promoting latest local IndexedDB node to sovereign sync target',
                  });
                  nodeToSync = sovereignNode;
                  targetVersionToClear = sovereignTime;
                } else if (nodeToSync) {
                  targetVersionToClear = queueTime;
                }
              }

              if (nodeToSync) {
                success = await this.syncNode(nodeToSync);
                if (success) {
                  realtimeService.clearPendingLocalNodeUpdate(nodeToSync.id, nodeToSync.updatedAt);
                }
              } else {
                console.warn('[QUEUE DISCARD INVALID]', { entityType: 'node', itemId: item.id });
                success = true;
              }
            } else if (item.entityType === 'tag') {
              const tag = item.payload;
              if (tag) {
                success = await this.syncTag(tag);
              } else {
                success = true;
              }
            } else if (item.entityType === 'note_tags') {
              const { noteId, tagIds } = item.payload || {};
              if (noteId && tagIds) {
                success = await this.syncNoteTags(authUserId, noteId, tagIds);
              } else {
                success = true;
              }
            } else if (item.entityType === 'note_links') {
              const { sourceNoteId, targetNoteIds } = item.payload || {};
              if (sourceNoteId && targetNoteIds) {
                success = await this.syncNoteLinks(authUserId, sourceNoteId, targetNoteIds);
              } else {
                success = true;
              }
            }

            // CRÍTICO: SOMENTE limpa da fila se a operação foi VERIFICADA com sucesso no Supabase!
            if (success) {
              const { removed, currentVersion } = await indexedDbService.completeSyncItem(
                item.id,
                targetVersionToClear
              );

              if (removed) {
                console.log('[QUEUE ITEM COMPLETE]', {
                  itemId: item.id,
                  entityType: item.entityType,
                  entityId: item.entityId,
                  version: targetVersionToClear,
                });
              } else {
                console.log('[QUEUE ITEM RETAINED]', {
                  itemId: item.id,
                  entityType: item.entityType,
                  entityId: item.entityId,
                  processedVersion: targetVersionToClear,
                  sovereignQueueVersion: currentVersion,
                  reason: 'Newer sovereign version arrived in queue during sync operation',
                });
              }
            } else {
              // Se a operação falhou na verificação do banco, NÃO remove da fila!
              const attempts = (item.attempts || 0) + 1;
              const backoffMs = Math.min(60000, 1000 * Math.pow(2, attempts));
              const errorMsg = 'Falha de verificação na operação com Supabase';

              console.warn('[QUEUE ITEM RETRY]', {
                itemId: item.id,
                entityType: item.entityType,
                entityId: item.entityId,
                attempt: attempts,
                backoffMs,
                error: errorMsg,
              });

              await indexedDbService.updateSyncItem({
                ...item,
                attempts,
                nextAttemptAt: Date.now() + backoffMs,
                status: attempts >= 5 ? 'failed' : 'pending',
                lastError: errorMsg,
              });

              if (attempts >= 5) {
                this.emitStatus('error');
              }
            }
          } catch (err: any) {
            console.error('[QUEUE ITEM EXCEPTION]', {
              itemId: item.id,
              entityType: item.entityType,
              entityId: item.entityId,
              error: err?.message || err,
            });

            const attempts = (item.attempts || 0) + 1;
            const backoffMs = Math.min(60000, 1000 * Math.pow(2, attempts));
            await indexedDbService.updateSyncItem({
              ...item,
              attempts,
              nextAttemptAt: Date.now() + backoffMs,
              status: attempts >= 5 ? 'failed' : 'pending',
              lastError: err?.message || 'Erro de execução na sincronização',
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
          this.triggerQueueProcessing(150);
        }
      }
    } finally {
      this.isProcessingQueue = false;
    }
  }

  /**
   * Sincroniza uma tag no Supabase com verificação estrita de resposta.
   */
  async syncTag(tag: TagRecord): Promise<boolean> {
    const supabase = getSupabase();
    if (!supabase || !isSupabaseConfigured || !this.isOnline) return false;

    const authUserId = await this.getAuthenticatedUserId();
    if (!authUserId) return false;

    const canonicalTagId = toCanonicalUuid(tag.id);

    try {
      const { data, error } = await supabase
        .from('tags')
        .upsert(
          {
            id: canonicalTagId,
            user_id: authUserId,
            name: tag.name,
            normalized_name: tag.normalizedName,
            created_at: tag.createdAt || new Date().toISOString(),
          },
          { onConflict: 'id' }
        )
        .select('id, name')
        .single();

      if (!error && data && data.id === canonicalTagId) {
        console.log('[SYNC SUCCESS]', { entityType: 'tag', entityId: tag.id });
        return true;
      }

      console.error('[SYNC FAILED]', {
        entityType: 'tag',
        entityId: tag.id,
        error: error || 'Verification failed: tag upsert returned empty response',
      });
      return false;
    } catch (err: any) {
      console.error('[SYNC FAILED]', {
        entityType: 'tag',
        entityId: tag.id,
        error: err?.message || err,
      });
      return false;
    }
  }

  /**
   * Sincroniza relações note_tags no Supabase de forma estritamente DIFERENCIAL.
   * Se os IDs de tags da nota não mudaram em relação ao último envio, NÃO executa DELETE nem INSERT.
   * Verifica estritamente que as operações no banco foram concluídas com sucesso.
   */
  async syncNoteTags(userId: string, noteId: string, tagIds: string[]): Promise<boolean> {
    const supabase = getSupabase();
    if (!supabase || !isSupabaseConfigured || !this.isOnline) return false;

    const canonicalNoteId = toCanonicalUuid(noteId);
    const sortedTags = [...tagIds].map(toCanonicalUuid).sort().join(',');

    if (this.lastSyncedTags.get(canonicalNoteId) === sortedTags) {
      return true;
    }

    const authUserId = await this.getAuthenticatedUserId();
    if (!authUserId) return false;

    try {
      // 1. Remove tags antigas com verificação estrita de erro
      const { error: delError } = await supabase
        .from('note_tags')
        .delete()
        .eq('note_id', canonicalNoteId);

      if (delError) {
        console.error('[SYNC FAILED]', {
          entityType: 'note_tags',
          entityId: noteId,
          operation: 'delete',
          error: delError,
        });
        return false;
      }

      // 2. Insere novas tags com verificação estrita de resposta
      if (tagIds.length > 0) {
        const rows = tagIds.map((tId) => ({
          note_id: canonicalNoteId,
          tag_id: toCanonicalUuid(tId),
          user_id: authUserId,
          created_at: new Date().toISOString(),
        }));

        const { data: insData, error: insError } = await supabase
          .from('note_tags')
          .insert(rows)
          .select('note_id, tag_id');

        if (insError || !insData || insData.length !== rows.length) {
          console.error('[SYNC FAILED]', {
            entityType: 'note_tags',
            entityId: noteId,
            operation: 'insert',
            error: insError || 'Verification failed: inserted count mismatch',
          });
          return false;
        }
      }

      this.lastSyncedTags.set(canonicalNoteId, sortedTags);
      console.log('[SYNC SUCCESS]', {
        entityType: 'note_tags',
        entityId: noteId,
        count: tagIds.length,
      });
      return true;
    } catch (err: any) {
      console.error('[SYNC FAILED]', {
        entityType: 'note_tags',
        entityId: noteId,
        error: err?.message || err,
      });
      return false;
    }
  }

  /**
   * Sincroniza relações note_links (backlinks) no Supabase de forma estritamente DIFERENCIAL.
   * Se os targetNoteIds não mudaram em relação ao último envio, NÃO executa DELETE nem INSERT.
   * Verifica estritamente que as operações no banco foram concluídas com sucesso.
   */
  async syncNoteLinks(userId: string, sourceNoteId: string, targetNoteIds: string[]): Promise<boolean> {
    const supabase = getSupabase();
    if (!supabase || !isSupabaseConfigured || !this.isOnline) return false;

    const canonicalSourceId = toCanonicalUuid(sourceNoteId);
    const validTargets = targetNoteIds
      .filter((tId) => tId !== sourceNoteId)
      .map(toCanonicalUuid);
    const sortedTargets = [...new Set(validTargets)].sort().join(',');

    if (this.lastSyncedLinks.get(canonicalSourceId) === sortedTargets) {
      return true;
    }

    const authUserId = await this.getAuthenticatedUserId();
    if (!authUserId) return false;

    try {
      // 1. Remove links anteriores desta nota fonte com verificação estrita
      const { error: delError } = await supabase
        .from('note_links')
        .delete()
        .eq('source_note_id', canonicalSourceId);

      if (delError) {
        console.error('[SYNC FAILED]', {
          entityType: 'note_links',
          entityId: sourceNoteId,
          operation: 'delete',
          error: delError,
        });
        return false;
      }

      // 2. Insere novos links com verificação de resultado
      if (validTargets.length > 0) {
        const uniqueTargets = [...new Set(validTargets)];
        const rows = uniqueTargets.map((targetId) => ({
          id: crypto.randomUUID(),
          user_id: authUserId,
          source_note_id: canonicalSourceId,
          target_note_id: targetId,
          created_at: new Date().toISOString(),
        }));

        const { data: insData, error: insError } = await supabase
          .from('note_links')
          .insert(rows)
          .select('id');

        if (insError || !insData || insData.length !== rows.length) {
          console.error('[SYNC FAILED]', {
            entityType: 'note_links',
            entityId: sourceNoteId,
            operation: 'insert',
            error: insError || 'Verification failed: inserted link count mismatch',
          });
          return false;
        }
      }

      this.lastSyncedLinks.set(canonicalSourceId, sortedTargets);
      console.log('[SYNC SUCCESS]', {
        entityType: 'note_links',
        entityId: sourceNoteId,
        count: validTargets.length,
      });
      return true;
    } catch (err: any) {
      console.error('[SYNC FAILED]', {
        entityType: 'note_links',
        entityId: sourceNoteId,
        error: err?.message || err,
      });
      return false;
    }
  }

  async debugRemoteSnapshot(userId: string): Promise<void> {
    const supabase = getSupabase();
    if (!supabase || !isSupabaseConfigured) return;
    try {
      const [{ count: nodeCount }, { count: noteCount }] = await Promise.all([
        supabase.from('nodes').select('*', { count: 'exact', head: true }).eq('user_id', userId).is('deleted_at', null),
        supabase.from('notes').select('*', { count: 'exact', head: true }).eq('user_id', userId),
      ]);
      console.log('[REMOTE SNAPSHOT]', {
        userId,
        remoteActiveNodes: nodeCount ?? 0,
        remoteNotes: noteCount ?? 0,
      });
    } catch (err) {
      console.warn('[SyncEngine] Erro no debugRemoteSnapshot:', err);
    }
  }

  async debugLocalSnapshot(userId: string): Promise<void> {
    try {
      const [localNodes, localNotes, pendingCount] = await Promise.all([
        indexedDbService.getAllNodes(userId),
        indexedDbService.getAllNotes(userId),
        indexedDbService.getPendingSyncCount(userId),
      ]);
      console.log('[LOCAL SNAPSHOT]', {
        userId,
        localActiveNodes: localNodes.length,
        localNotes: localNotes.length,
        pendingQueueItems: pendingCount,
      });
    } catch (err) {
      console.warn('[SyncEngine] Erro no debugLocalSnapshot:', err);
    }
  }

  /**
   * Hidratação inicial do IndexedDB a partir do Supabase ao iniciar sessão.
   * Respeita LWW com comparação estrita de timestamps e preserva tombstones.
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

      if (nodesRes.error) throw nodesRes.error;
      if (notesRes.error) throw notesRes.error;
      if (tagsRes.error) throw tagsRes.error;
      if (noteTagsRes.error) throw noteTagsRes.error;
      if (linksRes.error) throw linksRes.error;

      const remoteNodes = nodesRes.data || [];
      const remoteNotes = notesRes.data || [];
      const remoteTags = tagsRes.data || [];
      const remoteNoteTags = noteTagsRes.data || [];
      const remoteLinks = linksRes.data || [];

      // 1. Hidrata IndexedDB com os nós remotos (incluindo tombstones)
      for (const d of remoteNodes) {
        const local = await indexedDbService.getNode(d.id);
        const remoteTime = new Date(d.updated_at || d.created_at || 0).getTime();

        if (d.deleted_at) {
          if (local) {
            const localTime = new Date(local.updatedAt || local.createdAt || 0).getTime();
            if (!local.deletedAt && localTime > remoteTime) {
              continue; // Local reativou ou modificou depois da exclusão remota
            }
            local.deletedAt = d.deleted_at;
            local.updatedAt = d.updated_at || d.deleted_at;
            await indexedDbService.saveNode(local);
            realtimeService.registerLocalNodeUpdate(local.id, local.updatedAt, true);
          } else {
            const tombstone: TreeNode = {
              id: d.id,
              userId: d.user_id,
              parentId: d.parent_id,
              type: d.type,
              name: d.name,
              position: Number(d.position),
              createdAt: d.created_at,
              updatedAt: d.updated_at || d.deleted_at,
              deletedAt: d.deleted_at,
            };
            await indexedDbService.saveNode(tombstone);
            realtimeService.registerLocalNodeUpdate(d.id, tombstone.updatedAt, true);
          }
          continue;
        }

        // Registro remoto ativo
        if (local) {
          if (local.deletedAt) {
            const localDeletedTime = new Date(local.deletedAt).getTime();
            if (localDeletedTime >= remoteTime) {
              continue; // Preserva tombstone local
            }
          } else {
            const localTime = new Date(local.updatedAt || local.createdAt || 0).getTime();
            if (localTime >= remoteTime) {
              continue; // Local é igual ou mais novo
            }
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

      // 2. Hidrata notas respeitando Last Write Wins (LWW) e comparação de timestamps
      for (const d of remoteNotes) {
        const local = await indexedDbService.getNote(d.id);
        const remoteVersion = Number(d.version || 1);
        const remoteTime = new Date(d.updated_at || d.created_at || 0).getTime();

        if (local) {
          const localVersion = Number(local.version || 1);
          const localTime = new Date(local.updatedAt || local.createdAt || 0).getTime();

          if (localVersion > remoteVersion) {
            continue;
          }
          if (localVersion === remoteVersion && localTime >= remoteTime) {
            continue;
          }
        }

        let parsedEditorContent = d.editor_content;
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
            d.markdown_content || '',
            'Nota'
          );
        }

        const note: NoteRecord = {
          id: d.id,
          nodeId: d.node_id,
          userId: d.user_id,
          markdownContent: d.markdown_content || '',
          editorContent: parsedEditorContent,
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

      // 6. Envia para o Supabase registros locais criados offline (sem existência no remoto)
      const allLocalNodes = await indexedDbService.getAllNodesRaw(authUserId);
      const remoteNodeIdSet = new Set(remoteNodes.map((rn: any) => rn.id));
      for (const localNode of allLocalNodes) {
        if (!remoteNodeIdSet.has(localNode.id) && !localNode.deletedAt) {
          await this.syncNode(localNode);
        }
      }

      const allLocalNotes = await indexedDbService.getAllNotes(authUserId);
      const remoteNoteIdSet = new Set(remoteNotes.map((rn: any) => rn.id));
      for (const localNote of allLocalNotes) {
        if (!remoteNoteIdSet.has(localNote.id)) {
          await this.syncNote(localNote);
        }
      }

      // Processa itens que possam ter ficado pendentes na fila local
      await this.processPersistentQueue();

      await this.debugRemoteSnapshot(authUserId);
      await this.debugLocalSnapshot(authUserId);

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
