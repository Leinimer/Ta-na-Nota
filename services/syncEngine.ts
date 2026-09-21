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

export type SyncErrorType = 'AUTH' | 'RLS' | 'FK' | 'UNIQUE' | 'NETWORK' | 'RPC' | 'VALIDATION' | 'UNKNOWN';

export function isNetworkError(error: any): boolean {
  if (!error) return false;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true;
  const code = String(error?.code || '');
  const msg = String(error?.message || error || '').toLowerCase();
  const details = String(error?.details || '').toLowerCase();
  return (
    code === 'XX000' ||
    msg.includes('failed to fetch') ||
    msg.includes('network') ||
    msg.includes('connection') ||
    msg.includes('timeout') ||
    msg.includes('abort') ||
    msg.includes('offline') ||
    details.includes('failed to fetch') ||
    details.includes('network')
  );
}

export function classifySyncError(error: any): SyncErrorType {
  if (!error) return 'UNKNOWN';
  if (isNetworkError(error)) {
    return 'NETWORK';
  }
  const code = String(error?.code || '');
  const msg = String(error?.message || error || '').toLowerCase();

  if (code === 'P0001' || msg.includes('not authenticated') || msg.includes('jwt') || msg.includes('session missing') || msg.includes('session expired')) {
    return 'AUTH';
  }
  if (code === '42501' || msg.includes('violates row-level security policy') || msg.includes('row-level security')) {
    return 'RLS';
  }
  if (code === '23503' || msg.includes('foreign key') || msg.includes('violates foreign key')) {
    return 'FK';
  }
  if (code === '23505' || msg.includes('unique constraint') || msg.includes('duplicate key')) {
    return 'UNIQUE';
  }
  if (code === '42883' || (msg.includes('function') && (msg.includes('does not exist') || msg.includes('could not find')))) {
    return 'RPC';
  }
  if (msg.includes('mismatch') || msg.includes('invalid payload')) {
    return 'VALIDATION';
  }
  return 'UNKNOWN';
}

type SyncStatusListener = (status: SyncStatus) => void;

class SyncEngineClass {
  // Controle de concorrência por nodeId para garantir serialização de requisições de uma mesma nota e nó
  private inFlightNotes = new Set<string>();
  private inFlightNodes = new Set<string>();

  // Separação estrita entre localUserId e authenticatedSupabaseUserId
  private localUserId: string | null = null;
  private authenticatedSupabaseUserId: string | null = null;
  private cachedSessionValidUntil = 0;

  private get cachedUserId(): string | null {
    return this.authenticatedSupabaseUserId;
  }
  private set cachedUserId(val: string | null) {
    this.authenticatedSupabaseUserId = val;
  }

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

  /**
   * Lida com desconexão de rede ou Supabase inacessível de forma resiliente.
   * Não emite erro nem descarta a fila: o IndexedDB permanece como verdade soberana offline.
   */
  public handleNetworkDisconnection(context: string, details?: any): void {
    const wasOnline = this.isOnline;
    this.isOnline = false;
    this.emitStatus('offline');
    if (wasOnline) {
      console.warn(
        `[PWA OFFLINE] Sincronização pausada por indisponibilidade de rede (${context}). Fila preservada no IndexedDB:`,
        details
      );
    }
  }

  constructor() {
    if (typeof window !== 'undefined') {
      (window as any).debugRemoteNote = (id: string) => this.debugRemoteNote(id);
      (window as any).debugSupabaseConnection = () => this.debugSupabaseConnection();
      (window as any).debugCreateRoundTrip = () => this.debugCreateRoundTrip();

      window.addEventListener('online', async () => {
        this.isOnline = true;
        try {
          const authUserId = this.authenticatedSupabaseUserId || this.localUserId;
          const count = authUserId ? await indexedDbService.getPendingSyncCount(authUserId) : 0;
          console.info(`[OFFLINE QUEUE RESUME] Pendentes: ${count}`);
        } catch {
          console.info('[OFFLINE QUEUE RESUME] Pendentes: 0');
        }
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
    if (!this.isOnline || (typeof navigator !== 'undefined' && !navigator.onLine)) {
      status = 'offline';
    } else if (status === 'saved' && (this.inFlightNotes.size > 0 || this.inFlightNodes.size > 0)) {
      status = 'saving';
    }

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
   * Define a identidade do usuário autenticado no Supabase.
   */
  setAuthenticatedUserId(userId: string | null) {
    this.localUserId = userId;
    this.authenticatedSupabaseUserId = userId;
    this.cachedSessionValidUntil = 0; // Força revalidação real de sessão com Supabase
  }

  /**
   * Valida rigorosamente a sessão remota no Supabase.
   * Retorna authenticated=true somente quando houver cliente configurado,
   * sessão ativa com access_token e session.user.id válido.
   * NUNCA utiliza IndexedDB como substituto de autenticação remota.
   */
  async ensureRemoteSession(): Promise<{
    userId: string;
    authenticated: true;
  } | {
    userId: null;
    authenticated: false;
  }> {
    const supabase = getSupabase();
    if (!supabase || !isSupabaseConfigured) {
      if (!isSupabaseConfigured) {
        console.warn('[SUPABASE NOT CONFIGURED]');
      }
      this.authenticatedSupabaseUserId = null;
      return { userId: null, authenticated: false };
    }

    if (!this.isOnline) {
      return { userId: null, authenticated: false };
    }

    const now = Date.now();
    if (this.authenticatedSupabaseUserId && now < this.cachedSessionValidUntil) {
      return { userId: this.authenticatedSupabaseUserId, authenticated: true };
    }

    try {
      const { data: { session }, error } = await supabase.auth.getSession();
      if (error || !session || !session.user || !session.access_token) {
        this.authenticatedSupabaseUserId = null;
        this.cachedSessionValidUntil = 0;
        console.warn('[SYNC AUTH UNAVAILABLE]', {
          reason: error?.message || 'No valid Supabase session or access token found',
          hasSupabaseClient: true,
          hasSession: false,
        });
        return { userId: null, authenticated: false };
      }

      const activeUid = session.user.id;
      this.authenticatedSupabaseUserId = activeUid;
      this.localUserId = activeUid;
      this.cachedSessionValidUntil = now + 10000;
      return { userId: activeUid, authenticated: true };
    } catch (err: any) {
      this.authenticatedSupabaseUserId = null;
      this.cachedSessionValidUntil = 0;
      console.warn('[SYNC AUTH UNAVAILABLE]', {
        reason: err?.message || String(err),
        hasSupabaseClient: true,
        hasSession: false,
      });
      return { userId: null, authenticated: false };
    }
  }

  /**
   * Obtém o ID do usuário autenticado no Supabase com validação estrita de sessão ativa.
   */
  async getAuthenticatedUserId(): Promise<string | null> {
    const result = await this.ensureRemoteSession();
    if (result.authenticated) {
      return result.userId;
    }
    return null;
  }

  /**
   * Diagnóstico obrigatório de configuração no startup.
   * Não expõe tokens, anon keys ou segredos.
   */
  async runStartupDiagnostic(): Promise<void> {
    const supabase = getSupabase();
    let sessionPresent = false;
    let authUid: string | null = null;

    if (supabase && isSupabaseConfigured) {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        sessionPresent = Boolean(session?.user && session?.access_token);
        authUid = session?.user?.id || null;
      } catch {
        sessionPresent = false;
      }
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';

    console.log('[SUPABASE CONFIG]', {
      configured: isSupabaseConfigured,
      urlPresent: Boolean(url && !url.includes('your-project')),
      anonKeyPresent: Boolean(key && !key.includes('your-anon-key')),
      sessionPresent,
      authenticatedUserId: authUid,
    });

    if (!isSupabaseConfigured) {
      console.warn('[SUPABASE NOT CONFIGURED]');
    }
  }

  /**
   * Teste direto da conexão com Supabase.
   */
  async debugSupabaseConnection(): Promise<{
    session: 'OK' | 'FAIL';
    nodes: 'OK' | 'FAIL';
    notes: 'OK' | 'FAIL';
    userId: string | null;
  }> {
    const supabase = getSupabase();
    if (!supabase || !isSupabaseConfigured) {
      console.log('[SUPABASE CONNECTION TEST]', {
        session: 'FAIL',
        nodes: 'FAIL',
        notes: 'FAIL',
        userId: null,
      });
      return { session: 'FAIL', nodes: 'FAIL', notes: 'FAIL', userId: null };
    }

    let sessionStatus: 'OK' | 'FAIL' = 'FAIL';
    let nodesStatus: 'OK' | 'FAIL' = 'FAIL';
    let notesStatus: 'OK' | 'FAIL' = 'FAIL';
    let activeUid: string | null = null;

    try {
      const { data: { session }, error: sessErr } = await supabase.auth.getSession();
      if (!sessErr && session?.user?.id) {
        sessionStatus = 'OK';
        activeUid = session.user.id;

        const { error: nodeErr } = await supabase
          .from('nodes')
          .select('id')
          .eq('user_id', activeUid)
          .limit(1);
        nodesStatus = !nodeErr ? 'OK' : 'FAIL';

        const { error: noteErr } = await supabase
          .from('notes')
          .select('id')
          .eq('user_id', activeUid)
          .limit(1);
        notesStatus = !noteErr ? 'OK' : 'FAIL';
      }
    } catch {
      sessionStatus = 'FAIL';
    }

    console.log('[SUPABASE CONNECTION TEST]', {
      session: sessionStatus,
      nodes: nodesStatus,
      notes: notesStatus,
    });

    return {
      session: sessionStatus,
      nodes: nodesStatus,
      notes: notesStatus,
      userId: activeUid,
    };
  }

  /**
   * Teste de round trip de gravação direta (client -> Supabase -> select -> delete).
   */
  async debugCreateRoundTrip(): Promise<boolean> {
    const supabase = getSupabase();
    if (!supabase || !isSupabaseConfigured) {
      console.warn('[ROUND TRIP TEST] Supabase não está configurado.');
      return false;
    }

    const authUid = await this.getAuthenticatedUserId();
    if (!authUid) {
      console.warn('[ROUND TRIP TEST] Usuário não autenticado no Supabase.');
      return false;
    }

    const testNodeId = crypto.randomUUID();
    const testNoteId = crypto.randomUUID();
    const now = new Date().toISOString();

    console.log('[ROUND TRIP TEST] Iniciando teste direto client -> Supabase -> select -> delete...');

    try {
      // 1. Inserir nó de teste
      const { error: nodeErr } = await supabase
        .from('nodes')
        .insert({
          id: testNodeId,
          user_id: authUid,
          name: '__test_round_trip__',
          type: 'note',
          position: 999999,
          created_at: now,
          updated_at: now,
        });

      if (nodeErr) {
        console.error('[ROUND TRIP TEST FAILED] Falha ao inserir node:', nodeErr);
        return false;
      }

      // 2. Chamar RPC save_note_versioned para a nota de teste
      const { data: rpcData, error: rpcErr } = await supabase.rpc('save_note_versioned', {
        p_id: testNoteId,
        p_node_id: testNodeId,
        p_markdown_content: '# Teste Round Trip',
        p_editor_content: null,
        p_is_favorite: false,
        p_last_opened_at: null,
        p_version: 1,
        p_updated_at: now,
      });

      if (rpcErr || (rpcData?.status !== 'inserted' && rpcData?.status !== 'updated')) {
        console.error('[ROUND TRIP TEST FAILED] Falha na RPC save_note_versioned:', rpcErr || rpcData);
        await supabase.from('nodes').delete().eq('id', testNodeId).eq('user_id', authUid);
        return false;
      }

      // 3. Confirmar com select
      const { data: selectNote, error: selectErr } = await supabase
        .from('notes')
        .select('id, node_id, version')
        .eq('id', testNoteId)
        .eq('user_id', authUid)
        .maybeSingle();

      if (selectErr || !selectNote) {
        console.error('[ROUND TRIP TEST FAILED] Falha ao selecionar nota gravada:', selectErr);
        await supabase.from('notes').delete().eq('id', testNoteId).eq('user_id', authUid);
        await supabase.from('nodes').delete().eq('id', testNodeId).eq('user_id', authUid);
        return false;
      }

      // 4. Limpar dados de teste
      await supabase.from('notes').delete().eq('id', testNoteId).eq('user_id', authUid);
      await supabase.from('nodes').delete().eq('id', testNodeId).eq('user_id', authUid);

      console.log('[ROUND TRIP TEST SUCCESS] Gravação, RPC, select e limpeza concluídos com sucesso!');
      return true;
    } catch (err) {
      console.error('[ROUND TRIP TEST EXCEPTION]', err);
      return false;
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

    // Problema 11: Se o nó no IndexedDB possui deletedAt mais novo, a versão excluída é SOBERANA!
    // Não permitir que uma versão ativa obsoleta de memória/fila sobrescreva o tombstone local.
    const latestLocalDbNode = await indexedDbService.getNode(node.id);
    let effectiveNode = node;
    if (latestLocalDbNode && latestLocalDbNode.deletedAt && !node.deletedAt) {
      const dbDeletedTime = new Date(latestLocalDbNode.deletedAt).getTime();
      const nodeTime = new Date(node.updatedAt || 0).getTime();
      if (dbDeletedTime >= nodeTime) {
        console.warn('[SYNC SOVEREIGN TOMBSTONE]', {
          nodeId: node.id,
          reason: 'IndexedDB possui tombstone (deletedAt) soberano. Evitando envio de versão ativa obsoleta.',
        });
        effectiveNode = latestLocalDbNode;
      }
    }

    const localUpdatedAt = effectiveNode.updatedAt || new Date().toISOString();
    console.log('[SYNC START]', {
      entityType: 'node',
      entityId: effectiveNode.id,
      name: effectiveNode.name,
      updatedAt: localUpdatedAt,
      isDeleted: Boolean(effectiveNode.deletedAt),
    });

    let syncedSuccessfully = false;

    try {
      const canonicalId = toCanonicalUuid(effectiveNode.id);
      const canonicalParentId = effectiveNode.parentId ? toCanonicalUuid(effectiveNode.parentId) : null;
      const localTime = new Date(localUpdatedAt).getTime();

      // 1. Verificação prévia de conflito comparando timestamps com o nó remoto existente
      try {
        const { data: remoteNode, error: checkError } = await supabase
          .from('nodes')
          .select('id, updated_at, deleted_at, name, position, parent_id, type')
          .eq('id', canonicalId)
          .maybeSingle();

        if (checkError) {
          if (isNetworkError(checkError) || classifySyncError(checkError) === 'NETWORK') {
            this.handleNetworkDisconnection('node_conflict_check', checkError);
            return false;
          }
        }

        if (!checkError && remoteNode && remoteNode.updated_at) {
          const remoteTime = new Date(remoteNode.updated_at).getTime();

          if (remoteTime > localTime) {
            // Conflito detectado: o registro remoto é mais recente que a versão local
            console.log('[SYNC CONFLICT]', {
              entityType: 'node',
              entityId: effectiveNode.id,
              localTime,
              remoteTime,
              winner: 'remote',
              reason: 'Remote node timestamp is strictly newer',
            });

            // Converge o estado local para o remoto soberano
            const convergedNode: TreeNode = {
              id: effectiveNode.id,
              userId: authUserId,
              parentId: remoteNode.parent_id,
              type: remoteNode.type || effectiveNode.type,
              name: remoteNode.name || effectiveNode.name,
              position: Number(remoteNode.position ?? effectiveNode.position),
              createdAt: effectiveNode.createdAt,
              updatedAt: remoteNode.updated_at,
              deletedAt: remoteNode.deleted_at || undefined,
            };

            await indexedDbService.saveNode(convergedNode);
            this.lastSyncedNodeTime.set(effectiveNode.id, remoteNode.updated_at);
            realtimeService.registerLocalNodeUpdate(effectiveNode.id, remoteNode.updated_at, true);
            realtimeService.notifyListeners({
              type: 'node',
              eventType: remoteNode.deleted_at ? 'DELETE' : 'UPDATE',
              node: convergedNode,
              nodeId: effectiveNode.id,
            });

            console.log('[SYNC SUCCESS]', {
              entityType: 'node',
              entityId: effectiveNode.id,
              status: 'converged_to_remote_winner',
            });
            return true;
          } else if (remoteTime < localTime) {
            console.log('[SYNC CONFLICT]', {
              entityType: 'node',
              entityId: effectiveNode.id,
              localTime,
              remoteTime,
              winner: 'local',
              reason: 'Local node timestamp is newer or equal',
            });
          }
        }
      } catch (conflictCheckErr: any) {
        if (isNetworkError(conflictCheckErr) || classifySyncError(conflictCheckErr) === 'NETWORK') {
          this.handleNetworkDisconnection('node_conflict_check_exception', conflictCheckErr);
          return false;
        }
        console.warn('[SyncEngine] Falha não bloqueante na checagem de conflito do node:', conflictCheckErr);
      }

      const payload = {
        id: canonicalId,
        user_id: authUserId,
        parent_id: canonicalParentId,
        type: effectiveNode.type,
        name: effectiveNode.name || (effectiveNode.type === 'folder' ? 'Nova pasta' : 'Sem título'),
        color: effectiveNode.color ?? null,
        position: Number(effectiveNode.position || 1000),
        updated_at: localUpdatedAt,
        deleted_at: effectiveNode.deletedAt || null,
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

          // Verificação estrita de resultado: erro nulo e confirmação de ID, updated_at e deleted_at (Problema 10)
          const isDeletedSuccess =
            effectiveNode.deletedAt ? Boolean(data && data.deleted_at) : Boolean(data && !data.deleted_at);

          if (!error && data && data.id === canonicalId && isDeletedSuccess) {
            this.lastSyncedNodeTime.set(effectiveNode.id, data.updated_at || localUpdatedAt);
            if (effectiveNode.deletedAt) {
              console.log('[REMOTE WRITE SUCCESS] DELETE NODE', {
                id: effectiveNode.id,
                nodeId: effectiveNode.id,
              });
            } else {
              console.log('[REMOTE WRITE SUCCESS] NODE', {
                id: effectiveNode.id,
                name: effectiveNode.name,
                parentId: effectiveNode.parentId,
              });
            }
            console.log('[SYNC SUCCESS]', {
              entityType: 'node',
              entityId: effectiveNode.id,
              updatedAt: data.updated_at,
              deletedAt: data.deleted_at,
            });
            syncedSuccessfully = true;
            break;
          }

          const isAuthOrRlsError =
            Boolean(error &&
            (error.code === '42501' ||
             error.code === 'P0001' ||
             error.message?.toLowerCase().includes('violates row-level security policy') ||
             error.message?.toLowerCase().includes('not authenticated')));

          if (isAuthOrRlsError) {
            console.warn('[SYNC AUTH/RLS BLOCKED]', {
              entityType: 'node',
              entityId: effectiveNode.id,
              error: error?.message || error,
              reason: 'Sessão do Supabase ausente, expirada ou não autorizada para esta operação.',
            });
            this.cachedUserId = null;
            this.cachedSessionValidUntil = 0;
            break;
          }

          if (isNetworkError(error) || classifySyncError(error) === 'NETWORK') {
            this.handleNetworkDisconnection('node_upsert', {
              entityId: effectiveNode.id,
              error: error?.message || error,
            });
            break;
          }

          console.error('[SYNC FAILED]', {
            entityType: 'node',
            entityId: effectiveNode.id,
            attempt,
            maxRetries,
            error: error || 'Database returned empty response or unverified payload on node upsert',
            type: classifySyncError(error),
          });
        } catch (err: any) {
          const errMsg = err?.message || String(err);
          const isAuthOrRlsError =
            err?.code === '42501' ||
            err?.code === 'P0001' ||
            errMsg.toLowerCase().includes('violates row-level security policy') ||
            errMsg.toLowerCase().includes('not authenticated');

          if (isAuthOrRlsError) {
            console.warn('[SYNC AUTH/RLS BLOCKED]', {
              entityType: 'node',
              entityId: effectiveNode.id,
              error: errMsg,
            });
            this.authenticatedSupabaseUserId = null;
            this.cachedSessionValidUntil = 0;
            break;
          }

          if (isNetworkError(err) || classifySyncError(err) === 'NETWORK') {
            this.handleNetworkDisconnection('node_upsert_exception', {
              entityId: effectiveNode.id,
              error: errMsg,
            });
            break;
          }

          console.error('[SYNC FAILED]', {
            entityType: 'node',
            entityId: effectiveNode.id,
            attempt,
            maxRetries,
            error: errMsg,
            type: classifySyncError(err),
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
      console.log('[QUEUE ENQUEUED NODE]', {
        nodeId: node.id,
        name: node.name,
        operation: queueItem.operation,
      });
    } catch (err) {
      console.warn('[SyncEngine] Falha ao persistir node na fila do IndexedDB:', err);
    }

    if (!this.isOnline) {
      this.emitStatus('offline');
      return;
    }

    this.emitStatus('saving');
    this.triggerQueueProcessing(50);
  }

  /**
   * Enfileira persistência de uma tag na fila local durável do IndexedDB (`sync_queue`).
   */
  async enqueueTag(tag: TagRecord, operation: 'upsert' | 'delete' = 'upsert'): Promise<void> {
    const userId = tag.userId;
    const versionTimestamp = new Date(tag.createdAt || new Date().toISOString()).getTime();

    const queueItem: SyncQueueItem = {
      id: `sync_tag_${tag.id}`,
      userId,
      entityType: 'tag',
      entityId: tag.id,
      operation,
      payload: tag,
      version: versionTimestamp,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      attempts: 0,
      nextAttemptAt: 0,
      status: 'pending',
    };

    try {
      await indexedDbService.enqueueSyncItem(queueItem);
      console.log('[QUEUE ENQUEUED TAG]', {
        tagId: tag.id,
        name: tag.name,
        operation,
      });
    } catch (err) {
      console.warn('[SyncEngine] Falha ao persistir tag na fila do IndexedDB:', err);
    }

    if (!this.isOnline) {
      this.emitStatus('offline');
      return;
    }

    this.emitStatus('saving');
    this.triggerQueueProcessing(50);
  }

  /**
   * Enfileira relações note_tags na fila local durável do IndexedDB (`sync_queue`).
   */
  async enqueueNoteTags(userId: string, noteId: string, tagIds: string[]): Promise<void> {
    const versionTimestamp = Date.now();

    const queueItem: SyncQueueItem = {
      id: `sync_notetags_${noteId}`,
      userId,
      entityType: 'note_tags',
      entityId: noteId,
      operation: 'upsert',
      payload: { noteId, tagIds },
      version: versionTimestamp,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      attempts: 0,
      nextAttemptAt: 0,
      status: 'pending',
    };

    try {
      await indexedDbService.enqueueSyncItem(queueItem);
      console.log('[QUEUE ENQUEUED NOTE_TAGS]', {
        noteId,
        count: tagIds.length,
      });
    } catch (err) {
      console.warn('[SyncEngine] Falha ao persistir note_tags na fila do IndexedDB:', err);
    }

    if (!this.isOnline) {
      this.emitStatus('offline');
      return;
    }

    this.emitStatus('saving');
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

    // BUG 10 — DELETE SOBERANO
    // Se o nó já estiver com tombstone (deletedAt), NUNCA enviar a nota como upsert. Sincronizar exclusão.
    const effectiveNode = node || (await indexedDbService.getNode(note.nodeId));
    if (effectiveNode && effectiveNode.deletedAt) {
      console.log('[SyncEngine] Tentativa de syncNote para nó já marcado com deletedAt. Executando delete remoto em vez de upsert.', {
        noteId: note.id,
        nodeId: note.nodeId,
      });
      await this.syncNode(effectiveNode);
      return await this.deleteNoteRemote(note.id, note.nodeId);
    }

    // 1. Garante que o node pai exista no Supabase antes da nota para satisfazer a chave estrangeira (FK)
    if (effectiveNode) {
      const nodeSynced = await this.syncNode(effectiveNode);
      if (!nodeSynced && !effectiveNode.deletedAt) {
        console.warn('[SyncEngine] Node pai não pôde ser sincronizado antes da nota. Abortando envio da nota para evitar erro de FK.');
        return false;
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
        // Log obrigatório do resultado da RPC (BUG 16)
        console.log('[RPC RESULT]', {
          status: rpcData.status,
          noteId: rpcData.note?.id || canonicalNoteId,
          nodeId: rpcData.note?.node_id || canonicalNodeId,
          version: rpcData.note?.version || versionNum,
        });

        // BUG 1 & BUG 2: Aceita tanto 'inserted' quanto 'updated' como sucesso da gravação remota
        if (rpcData.status === 'inserted' || rpcData.status === 'updated') {
          const remoteNote = rpcData.note;

          // BUG 3: Validar o resultado real da RPC
          if (!remoteNote || remoteNote.id !== canonicalNoteId) {
            console.error('[SYNC FAILED]', {
              entityType: 'note',
              entityId: canonicalNoteId,
              error: `RPC returned note ID mismatch or invalid payload. Expected ${canonicalNoteId}, got ${remoteNote?.id}`,
              status: rpcData.status,
            });
            return false;
          }

          if (remoteNote.version && Number(remoteNote.version) !== note.version) {
            note.version = Number(remoteNote.version);
            await indexedDbService.saveNote(note);
          }

          console.log('[REMOTE WRITE SUCCESS] NOTE', {
            id: canonicalNoteId,
            nodeId: canonicalNodeId,
            version: remoteNote.version ?? versionNum,
            status: rpcData.status,
            method: 'rpc',
          });

          console.log('[SYNC SUCCESS]', {
            entityType: 'note',
            entityId: note.id,
            version: remoteNote.version ?? versionNum,
            status: rpcData.status,
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
        if (isNetworkError(rpcError) || classifySyncError(rpcError) === 'NETWORK') {
          this.handleNetworkDisconnection('note_rpc', { entityId: note.id, error: rpcError.message || rpcError });
          return false;
        }

        const isAuthOrRlsError =
          rpcError.code === '42501' ||
          rpcError.code === 'P0001' ||
          rpcError.message?.toLowerCase().includes('violates row-level security policy') ||
          rpcError.message?.toLowerCase().includes('not authenticated');

        if (isAuthOrRlsError) {
          console.warn('[SYNC AUTH/RLS BLOCKED]', {
            entityType: 'note',
            entityId: note.id,
            error: rpcError.message || rpcError,
            reason: 'Sessão do Supabase ausente, expirada ou não autorizada para esta nota.',
          });
          this.cachedUserId = null;
          this.cachedSessionValidUntil = 0;
          return false;
        }

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
      const errMsg = err?.message || String(err);
      if (isNetworkError(err) || classifySyncError(err) === 'NETWORK') {
        this.handleNetworkDisconnection('note_rpc_exception', { entityId: note.id, error: errMsg });
        return false;
      }

      const isAuthOrRlsError =
        err?.code === '42501' ||
        err?.code === 'P0001' ||
        errMsg.toLowerCase().includes('violates row-level security policy') ||
        errMsg.toLowerCase().includes('not authenticated');

      if (isAuthOrRlsError) {
        console.warn('[SYNC AUTH/RLS BLOCKED]', {
          entityType: 'note',
          entityId: note.id,
          error: errMsg,
        });
        this.cachedUserId = null;
        this.cachedSessionValidUntil = 0;
        return false;
      }

      console.error('[SYNC FAILED]', {
        entityType: 'note',
        entityId: note.id,
        error: errMsg,
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
        if (isNetworkError(fetchErr) || classifySyncError(fetchErr) === 'NETWORK') {
          this.handleNetworkDisconnection('note_fallback_fetch', { entityId: note.id, error: fetchErr.message || fetchErr });
          return false;
        }

        const isAuthOrRlsError =
          fetchErr.code === '42501' ||
          fetchErr.code === 'P0001' ||
          fetchErr.message?.toLowerCase().includes('violates row-level security policy') ||
          fetchErr.message?.toLowerCase().includes('not authenticated');

        if (isAuthOrRlsError) {
          console.warn('[SYNC AUTH/RLS BLOCKED]', {
            entityType: 'note',
            entityId: note.id,
            error: fetchErr.message || fetchErr,
          });
          this.cachedUserId = null;
          this.cachedSessionValidUntil = 0;
          return false;
        }

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
        console.log('[REMOTE WRITE SUCCESS] NOTE', {
          id: note.id,
          nodeId: note.nodeId,
          version: upsertData.version,
        });
        console.log('[SYNC SUCCESS]', {
          entityType: 'note',
          entityId: note.id,
          version: upsertData.version,
          method: 'fallback_upsert',
        });
        return true;
      }

      if (upsertErr) {
        if (isNetworkError(upsertErr) || classifySyncError(upsertErr) === 'NETWORK') {
          this.handleNetworkDisconnection('note_fallback_upsert', { entityId: note.id, error: upsertErr.message || upsertErr });
          return false;
        }

        const isAuthOrRlsError =
          upsertErr.code === '42501' ||
          upsertErr.code === 'P0001' ||
          upsertErr.message?.toLowerCase().includes('violates row-level security policy') ||
          upsertErr.message?.toLowerCase().includes('not authenticated');

        if (isAuthOrRlsError) {
          console.warn('[SYNC AUTH/RLS BLOCKED]', {
            entityType: 'note',
            entityId: note.id,
            error: upsertErr.message || upsertErr,
          });
          this.cachedUserId = null;
          this.cachedSessionValidUntil = 0;
          return false;
        }
      }

      console.error('[SYNC FAILED]', {
        entityType: 'note',
        entityId: note.id,
        error: upsertErr || 'Database returned empty response on note fallback upsert',
        method: 'fallback_upsert',
      });
      return false;
    } catch (err: any) {
      const errMsg = err?.message || String(err);
      if (isNetworkError(err) || classifySyncError(err) === 'NETWORK') {
        this.handleNetworkDisconnection('note_fallback_exception', { entityId: note.id, error: errMsg });
        return false;
      }

      const isAuthOrRlsError =
        err?.code === '42501' ||
        err?.code === 'P0001' ||
        errMsg.toLowerCase().includes('violates row-level security policy') ||
        errMsg.toLowerCase().includes('not authenticated');

      if (isAuthOrRlsError) {
        console.warn('[SYNC AUTH/RLS BLOCKED]', {
          entityType: 'note',
          entityId: note.id,
          error: errMsg,
        });
        this.cachedUserId = null;
        this.cachedSessionValidUntil = 0;
        return false;
      }

      console.error('[SYNC FAILED]', {
        entityType: 'note',
        entityId: note.id,
        error: errMsg,
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
      console.log('[QUEUE ENQUEUED NOTE]', {
        noteId: note.id,
        nodeId: note.nodeId,
        operation: 'upsert',
        version: queueItem.version,
      });
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
   * Enfileira a exclusão remota de uma nota na fila persistente do IndexedDB (BUG 9).
   * O ID fixo `sync_note_${noteId}` garante substituição soberana sobre qualquer upsert pendente.
   */
  async enqueueNoteDelete(noteId: string, nodeId: string, userId: string): Promise<void> {
    const queueItem: SyncQueueItem = {
      id: `sync_note_${noteId}`,
      userId,
      entityType: 'note',
      entityId: noteId,
      operation: 'delete',
      payload: { noteId, nodeId },
      version: Date.now(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      attempts: 0,
      nextAttemptAt: 0,
      status: 'pending',
    };

    try {
      await indexedDbService.enqueueSyncItem(queueItem);
      console.log('[QUEUE ENQUEUED NOTE]', {
        noteId,
        nodeId,
        operation: 'delete',
      });
    } catch (err) {
      console.warn('[SyncEngine] Falha ao enfileirar exclusão da nota no IndexedDB:', err);
    }

    if (!this.isOnline) {
      this.emitStatus('offline');
      return;
    }

    this.emitStatus('saving');
    this.triggerQueueProcessing(50);
  }

  /**
   * Remove fisicamente uma nota do Supabase quando o nó correspondente é excluído (BUG 7 & BUG 8).
   * Utiliza validação estrita com id, node_id e user_id para segurança e consistência.
   */
  async deleteNoteRemote(noteId: string, nodeId: string): Promise<boolean> {
    const supabase = getSupabase();
    if (!supabase || !isSupabaseConfigured) return false;

    if (!this.isOnline) {
      this.emitStatus('offline');
      return false;
    }

    const authUserId = await this.getAuthenticatedUserId();
    if (!authUserId) return false;

    const canonicalNoteId = toCanonicalUuid(noteId);
    const canonicalNodeId = toCanonicalUuid(nodeId);

    try {
      const { data, error } = await supabase
        .from('notes')
        .delete()
        .eq('id', canonicalNoteId)
        .eq('node_id', canonicalNodeId)
        .eq('user_id', authUserId)
        .select('id');

      if (error) {
        if (isNetworkError(error) || classifySyncError(error) === 'NETWORK') {
          this.handleNetworkDisconnection('delete_note', {
            noteId: canonicalNoteId,
            nodeId: canonicalNodeId,
            error: error.message || error,
          });
          return false;
        }

        const isAuthOrRlsError =
          error.code === '42501' ||
          error.code === 'P0001' ||
          error.message?.toLowerCase().includes('violates row-level security policy') ||
          error.message?.toLowerCase().includes('not authenticated');

        if (isAuthOrRlsError) {
          console.warn('[SYNC AUTH/RLS BLOCKED]', {
            entityType: 'note',
            entityId: canonicalNoteId,
            error: error.message || error,
          });
          this.cachedUserId = null;
          this.cachedSessionValidUntil = 0;
          return false;
        }

        console.error('[SYNC FAILED] DELETE NOTE', {
          noteId: canonicalNoteId,
          nodeId: canonicalNodeId,
          error: error.message || error,
        });
        return false;
      }

      if (data && Array.isArray(data) && data.length > 0 && data[0].id === canonicalNoteId) {
        console.log('[REMOTE WRITE SUCCESS] DELETE NOTE', {
          noteId: canonicalNoteId,
          nodeId: canonicalNodeId,
        });
        return true;
      }

      // Se a linha já não existia no banco, considera excluído com idempotência
      console.log('[REMOTE DELETE ALREADY ABSENT]', {
        noteId: canonicalNoteId,
        nodeId: canonicalNodeId,
      });
      return true;
    } catch (err: any) {
      if (isNetworkError(err) || classifySyncError(err) === 'NETWORK') {
        this.handleNetworkDisconnection('delete_note_exception', {
          noteId: canonicalNoteId,
          nodeId: canonicalNodeId,
          error: err?.message || err,
        });
        return false;
      }

      console.error('[SYNC FAILED] DELETE NOTE EXCEPTION', {
        noteId: canonicalNoteId,
        nodeId: canonicalNodeId,
        error: err?.message || err,
      });
      return false;
    }
  }

  /**
   * Ferramenta de diagnóstico para inspecionar diretamente o estado da nota no Supabase (BUG 17).
   */
  async debugRemoteNote(noteId: string): Promise<any> {
    const supabase = getSupabase();
    if (!supabase || !isSupabaseConfigured) {
      console.log('[REMOTE NOTE CHECK] Supabase não está configurado.');
      return null;
    }
    const canonicalId = toCanonicalUuid(noteId);
    try {
      const { data, error } = await supabase
        .from('notes')
        .select('*')
        .eq('id', canonicalId)
        .maybeSingle();

      console.log('[REMOTE NOTE CHECK]', {
        noteId: canonicalId,
        data,
        error: error?.message || error,
        exists: Boolean(data),
      });
      return data;
    } catch (err: any) {
      console.error('[REMOTE NOTE CHECK] Falha ao consultar nota no Supabase:', err);
      return null;
    }
  }

  /**
   * Dispara o processamento da fila persistente com debounce para cadenciar as requisições.
   */
  public triggerQueueProcessing(delayMs: number = 100) {
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
              if (item.operation === 'delete') {
                const noteId = item.payload?.noteId || item.entityId;
                const nodeId = item.payload?.nodeId || item.entityId;
                const localNode = await indexedDbService.getNode(nodeId);

                if (localNode && localNode.deletedAt) {
                  const nodeSuccess = await this.syncNode(localNode);
                  if (!nodeSuccess) {
                    console.warn('[QUEUE DEPENDENCY BLOCKED] Falha ao sincronizar tombstone do node antes do delete da note:', {
                      nodeId: localNode.id,
                      noteId,
                    });
                    success = false;
                  } else {
                    const nodeVersionToClear = new Date(localNode.updatedAt || 0).getTime();
                    await indexedDbService.completeSyncItem(`sync_node_${localNode.id}`, nodeVersionToClear);
                    success = await this.deleteNoteRemote(noteId, nodeId);
                  }
                } else {
                  success = await this.deleteNoteRemote(noteId, nodeId);
                }
              } else {
                // 1. Respeita a versão mais recente como soberana: busca o estado atual no IndexedDB
                const sovereignNote =
                  (await indexedDbService.getNote(item.entityId)) ||
                  (await indexedDbService.getNoteByNodeId(item.entityId));
                let noteToSync = item.payload?.note as NoteRecord | undefined;
                const targetNodeId = sovereignNote?.nodeId || noteToSync?.nodeId || item.payload?.node?.id || item.entityId;
                let parentNode = (await indexedDbService.getNode(targetNodeId)) || (item.payload?.node as TreeNode | undefined);

                // BUG 10 — DELETE SOBERANO
                // Se o nó já estiver com tombstone (deletedAt), NUNCA enviar a nota como upsert.
                if (parentNode && parentNode.deletedAt) {
                  console.log('[QUEUE DELETE SOVEREIGN] Node pai marcado com deletedAt. Convertendo upsert pendente em exclusão remota.', {
                    noteId: item.entityId,
                    nodeId: parentNode.id,
                  });
                  const nodeSuccess = await this.syncNode(parentNode);
                  if (nodeSuccess) {
                    const nodeVersionToClear = new Date(parentNode.updatedAt || 0).getTime();
                    await indexedDbService.completeSyncItem(`sync_node_${parentNode.id}`, nodeVersionToClear);
                    success = await this.deleteNoteRemote(item.entityId, parentNode.id);
                  } else {
                    success = false;
                  }
                } else {
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
                    // 2. Garante a dependência NODE -> NOTE antes de persistir a nota no Supabase
                    if (parentNode) {
                      const nodeSuccess = await this.syncNode(parentNode);
                      if (!nodeSuccess && !parentNode.deletedAt) {
                        console.warn('[QUEUE DEPENDENCY BLOCKED]', {
                          entityType: 'note',
                          noteId: item.entityId,
                          nodeId: parentNode.id,
                          reason: 'Node dependency failed to sync. Note will remain pending.',
                        });
                        success = false;
                      } else {
                        // Node sincronizado com sucesso: conclui o item do nó na fila com sua versão processada (Problema 12)
                        const nodeVersionToClear = new Date(parentNode.updatedAt || 0).getTime();
                        await indexedDbService.completeSyncItem(`sync_node_${parentNode.id}`, nodeVersionToClear);
                        success = await this.syncNote(noteToSync, parentNode);
                      }
                    } else {
                      success = await this.syncNote(noteToSync);
                    }
                  } else {
                    console.warn('[QUEUE DISCARD INVALID]', { entityType: 'note', itemId: item.id });
                    success = true; // Payload vazio ou inválido, limpa da fila
                  }
                }
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
                  if (nodeToSync.deletedAt && nodeToSync.type === 'note') {
                    const localNote = await indexedDbService.getNoteByNodeId(nodeToSync.id);
                    const noteId = localNote?.id || nodeToSync.id;
                    await this.deleteNoteRemote(noteId, nodeToSync.id);
                  }
                }
              } else {
                console.warn('[QUEUE DISCARD INVALID]', { entityType: 'node', itemId: item.id });
                success = true;
              }
            } else if (item.entityType === 'tag') {
              if (item.operation === 'delete') {
                success = await this.deleteTagRemote(item.entityId);
              } else {
                const tag = item.payload;
                if (tag) {
                  success = await this.syncTag(tag);
                } else {
                  success = true;
                }
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
            } else if (item.entityType === 'attachment') {
              const supabase = getSupabase();
              if (!supabase || !isSupabaseConfigured) {
                success = false;
              } else if (item.operation === 'delete') {
                const storagePath = item.payload?.storagePath;
                const attachmentId = item.entityId;

                if (storagePath) {
                  try {
                    await supabase.storage.from('attachments').remove([storagePath]);
                  } catch (stErr) {
                    console.warn('[ATTACHMENT REMOTE DELETE WARNING]', stErr);
                  }
                }

                const { error: delErr } = await supabase
                  .from('attachments')
                  .delete()
                  .eq('id', attachmentId)
                  .eq('user_id', authUserId);

                if (delErr && !isNetworkError(delErr)) {
                  console.warn('[ATTACHMENT DB DELETE WARNING]', delErr);
                }

                await indexedDbService.deleteAttachment(attachmentId);
                success = true;
                targetVersionToClear = item.version;
              } else {
                // Operação: upsert (upload físico + persistência no banco)
                const attachmentId = item.entityId;
                const noteId = item.payload?.noteId;

                // 1. Se a nota foi excluída offline, descarta upload de anexo órfão (Requirement 19)
                if (noteId) {
                  const localNote = await indexedDbService.getNote(noteId);
                  const localNode = localNote ? await indexedDbService.getNode(localNote.nodeId) : null;
                  if (!localNote || (localNode && localNode.deletedAt)) {
                    console.log('[ATTACHMENT DISCARD ORPHAN]', { attachmentId, noteId });
                    await indexedDbService.deleteAttachment(attachmentId);
                    success = true;
                    targetVersionToClear = item.version;
                    await indexedDbService.completeSyncItem(item.id, targetVersionToClear);
                    continue;
                  }

                  // 2. Respeita dependência NODE -> NOTE -> ATTACHMENT (Requirement 18)
                  const { data: remoteNote, error: checkNoteErr } = await supabase
                    .from('notes')
                    .select('id')
                    .eq('id', noteId)
                    .maybeSingle();

                  if (checkNoteErr && (isNetworkError(checkNoteErr) || classifySyncError(checkNoteErr) === 'NETWORK')) {
                    this.handleNetworkDisconnection('check_parent_note_offline', { noteId, attachmentId });
                    success = false;
                    break;
                  }

                  if (!remoteNote) {
                    console.log('[ATTACHMENT DEPENDENCY PENDING] Sincronizando nó e nota pai antes do upload do anexo:', { noteId, attachmentId });
                    if (localNode && !localNode.deletedAt) {
                      await this.syncNode(localNode);
                    }
                    const noteSynced = await this.syncNote(localNote, localNode || undefined);
                    if (!noteSynced) {
                      console.warn('[ATTACHMENT DEPENDENCY BLOCKED] Falha ao sincronizar nota pai antes do anexo:', { noteId, attachmentId });
                      success = false;
                      continue;
                    }
                  }
                }

                const localAtt = await indexedDbService.getAttachment(attachmentId);
                if (!localAtt) {
                  console.warn('[ATTACHMENT DISCARD INVALID] Anexo não encontrado no IndexedDB:', attachmentId);
                  success = true;
                  targetVersionToClear = item.version;
                  await indexedDbService.completeSyncItem(item.id, targetVersionToClear);
                  continue;
                }

                if (localAtt.status === 'uploaded') {
                  const { data: remoteAtt } = await supabase
                    .from('attachments')
                    .select('id')
                    .eq('id', attachmentId)
                    .maybeSingle();
                  if (remoteAtt) {
                    success = true;
                    targetVersionToClear = item.version;
                    await indexedDbService.completeSyncItem(item.id, targetVersionToClear);
                    continue;
                  }
                }

                console.log('[ATTACHMENT UPLOAD START]', {
                  attachmentId: localAtt.id,
                  fileName: localAtt.fileName,
                  storagePath: localAtt.storagePath,
                  fileSize: localAtt.fileSize,
                  mimeType: localAtt.mimeType,
                });

                localAtt.status = 'uploading';
                localAtt.updatedAt = new Date().toISOString();
                await indexedDbService.saveAttachment(localAtt);

                const fileToUpload = localAtt.localBlob;
                if (!fileToUpload) {
                  console.warn('[ATTACHMENT UPLOAD FAILED] localBlob ausente para anexo:', attachmentId);
                  localAtt.status = 'failed';
                  await indexedDbService.saveAttachment(localAtt);
                  success = false;
                  continue;
                }

                try {
                  const { error: uploadError } = await supabase.storage
                    .from('attachments')
                    .upload(localAtt.storagePath, fileToUpload, {
                      contentType: localAtt.mimeType,
                      upsert: true,
                    });

                  if (uploadError) {
                    console.error('[ATTACHMENT UPLOAD FAILED]', {
                      attachmentId: localAtt.id,
                      storagePath: localAtt.storagePath,
                      error: uploadError.message,
                    });

                    if (isNetworkError(uploadError)) {
                      this.handleNetworkDisconnection('upload_attachment', { attachmentId: localAtt.id, error: uploadError.message });
                      localAtt.status = 'failed';
                      await indexedDbService.saveAttachment(localAtt);
                      success = false;
                      break;
                    }

                    localAtt.status = 'failed';
                    await indexedDbService.saveAttachment(localAtt);
                    success = false;
                    continue;
                  }

                  console.log('[ATTACHMENT UPLOAD SUCCESS]', {
                    attachmentId: localAtt.id,
                    storagePath: localAtt.storagePath,
                  });

                  // 3. Persiste metadados na tabela public.attachments (NUNCA Base64)
                  const { error: dbError } = await supabase
                    .from('attachments')
                    .upsert({
                      id: localAtt.id,
                      user_id: authUserId,
                      note_id: localAtt.noteId,
                      file_name: localAtt.fileName,
                      storage_path: localAtt.storagePath,
                      mime_type: localAtt.mimeType,
                      file_size: localAtt.fileSize,
                      created_at: localAtt.createdAt,
                      updated_at: new Date().toISOString(),
                    }, { onConflict: 'id' });

                  if (dbError) {
                    console.error('[ATTACHMENT DB INSERT FAILED]', {
                      attachmentId: localAtt.id,
                      error: dbError.message,
                    });

                    if (isNetworkError(dbError)) {
                      this.handleNetworkDisconnection('attachment_db_insert', { attachmentId: localAtt.id, error: dbError.message });
                      localAtt.status = 'failed';
                      await indexedDbService.saveAttachment(localAtt);
                      success = false;
                      break;
                    }

                    localAtt.status = 'failed';
                    await indexedDbService.saveAttachment(localAtt);
                    success = false;
                    continue;
                  }

                  console.log('[ATTACHMENT METADATA SUCCESS]', {
                    attachmentId: localAtt.id,
                    noteId: localAtt.noteId,
                  });

                  localAtt.status = 'uploaded';
                  localAtt.updatedAt = new Date().toISOString();
                  await indexedDbService.saveAttachment(localAtt);

                  success = true;
                  targetVersionToClear = item.version;
                } catch (attCatch: any) {
                  console.error('[ATTACHMENT UPLOAD FAILED]', {
                    attachmentId: localAtt.id,
                    error: attCatch?.message || String(attCatch),
                  });
                  localAtt.status = 'failed';
                  await indexedDbService.saveAttachment(localAtt);
                  success = false;
                }
              }
            }

            // CRÍTICO: SOMENTE limpa da fila se a operação foi VERIFICADA com sucesso no Supabase!
            if (success) {
              const { removed, currentVersion } = await indexedDbService.completeSyncItem(
                item.id,
                targetVersionToClear
              );

              if (removed) {
                console.log('[SYNC SUCCESS]', {
                  itemId: item.id,
                  entityType: item.entityType,
                  entityId: item.entityId,
                });
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
              // Se a operação não obteve confirmação, verifica se a rede caiu
              if (!this.isOnline || (typeof navigator !== 'undefined' && !navigator.onLine)) {
                this.handleNetworkDisconnection('queue_item_offline', {
                  itemId: item.id,
                  entityType: item.entityType,
                  entityId: item.entityId,
                });
                break;
              }

              // Se a operação falhou na verificação do banco, checa se ainda estamos autenticados
              const stillAuthenticated = await this.getAuthenticatedUserId();
              if (!stillAuthenticated) {
                console.warn('[QUEUE PAUSED] Autenticação indisponível no Supabase. Pausando processamento da fila sem descartar itens.');
                break;
              }

              console.error('[SYNC FAILED]', {
                itemId: item.id,
                entityType: item.entityType,
                entityId: item.entityId,
              });

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
            if (isNetworkError(err) || classifySyncError(err) === 'NETWORK') {
              this.handleNetworkDisconnection('queue_item_catch', {
                itemId: item.id,
                entityType: item.entityType,
                entityId: item.entityId,
                error: err?.message || err,
              });
              // Mantém item intacto na queue como pending
              break;
            }

            console.error('[SYNC FAILED]', {
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

      if (isNetworkError(error) || classifySyncError(error) === 'NETWORK') {
        this.handleNetworkDisconnection('sync_tag', { tagId: tag.id, error });
        return false;
      }

      console.error('[SYNC FAILED]', {
        entityType: 'tag',
        entityId: tag.id,
        error: error || 'Verification failed: tag upsert returned empty response',
      });
      return false;
    } catch (err: any) {
      if (isNetworkError(err) || classifySyncError(err) === 'NETWORK') {
        this.handleNetworkDisconnection('sync_tag_exception', { tagId: tag.id, error: err });
        return false;
      }
      console.error('[SYNC FAILED]', {
        entityType: 'tag',
        entityId: tag.id,
        error: err?.message || err,
      });
      return false;
    }
  }

  /**
   * Remove uma tag do Supabase.
   */
  async deleteTagRemote(tagId: string): Promise<boolean> {
    const supabase = getSupabase();
    if (!supabase || !isSupabaseConfigured || !this.isOnline) return false;
    const authUserId = await this.getAuthenticatedUserId();
    if (!authUserId) return false;
    const canonicalTagId = toCanonicalUuid(tagId);

    try {
      const { error } = await supabase
        .from('tags')
        .delete()
        .eq('id', canonicalTagId)
        .eq('user_id', authUserId);

      if (error) {
        if (isNetworkError(error) || classifySyncError(error) === 'NETWORK') {
          this.handleNetworkDisconnection('delete_tag_remote', { tagId, error });
          return false;
        }
        console.error('[SYNC FAILED]', { entityType: 'tag', entityId: tagId, operation: 'delete', error });
        return false;
      }
      console.log('[SYNC SUCCESS]', { entityType: 'tag', entityId: tagId, operation: 'delete' });
      return true;
    } catch (err: any) {
      if (isNetworkError(err) || classifySyncError(err) === 'NETWORK') {
        this.handleNetworkDisconnection('delete_tag_remote_exception', { tagId, error: err });
        return false;
      }
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
        if (isNetworkError(delError) || classifySyncError(delError) === 'NETWORK') {
          this.handleNetworkDisconnection('sync_note_tags_delete', { noteId, error: delError });
          return false;
        }
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
          if (isNetworkError(insError) || classifySyncError(insError) === 'NETWORK') {
            this.handleNetworkDisconnection('sync_note_tags_insert', { noteId, error: insError });
            return false;
          }
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
      if (isNetworkError(err) || classifySyncError(err) === 'NETWORK') {
        this.handleNetworkDisconnection('sync_note_tags_exception', { noteId, error: err });
        return false;
      }
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
        if (isNetworkError(delError) || classifySyncError(delError) === 'NETWORK') {
          this.handleNetworkDisconnection('sync_note_links_delete', { sourceNoteId, error: delError });
          return false;
        }
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
          if (isNetworkError(insError) || classifySyncError(insError) === 'NETWORK') {
            this.handleNetworkDisconnection('sync_note_links_insert', { sourceNoteId, error: insError });
            return false;
          }
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
      if (isNetworkError(err) || classifySyncError(err) === 'NETWORK') {
        this.handleNetworkDisconnection('sync_note_links_exception', { sourceNoteId, error: err });
        return false;
      }
      console.error('[SYNC FAILED]', {
        entityType: 'note_links',
        entityId: sourceNoteId,
        error: err?.message || err,
      });
      return false;
    }
  }

  async debugRemoteSnapshot(userId: string): Promise<void> {
    await this.debugDiagnosticSnapshot(userId);
  }

  async debugLocalSnapshot(userId: string): Promise<void> {
    await this.debugDiagnosticSnapshot(userId);
  }

  /**
   * Diagnóstico completo de integridade e divergência entre Supabase e IndexedDB.
   * Conforme requisitos 36 e 37 do protocolo de sincronização.
   */
  async debugDiagnosticSnapshot(userId: string): Promise<void> {
    const supabase = getSupabase();
    if (!supabase || !isSupabaseConfigured) return;
    try {
      const [nodesRes, notesRes] = await Promise.all([
        supabase.from('nodes').select('id, user_id, deleted_at').eq('user_id', userId),
        supabase.from('notes').select('id, node_id, user_id').eq('user_id', userId),
      ]);

      const remoteNodes = nodesRes.data || [];
      const remoteNotes = notesRes.data || [];
      const activeRemoteNodes = remoteNodes.filter((n) => !n.deleted_at);
      const deletedRemoteNodes = remoteNodes.filter((n) => Boolean(n.deleted_at));

      const remoteNodeIdSet = new Set(remoteNodes.map((n) => n.id));
      const notesWithoutNode = remoteNotes
        .filter((n) => !remoteNodeIdSet.has(n.node_id))
        .map((n) => ({ noteId: n.id, nodeId: n.node_id }));

      console.log('[REMOTE SNAPSHOT]', {
        userId,
        remoteNodesCount: remoteNodes.length,
        remoteActiveNodesCount: activeRemoteNodes.length,
        remoteNotesCount: remoteNotes.length,
        notesWithoutNodeCount: notesWithoutNode.length,
        notesWithoutNode,
        deletedNodesCount: deletedRemoteNodes.length,
      });

      const [localNodes, localNotes, pendingCount, tombstoneIds] = await Promise.all([
        indexedDbService.getAllNodes(userId),
        indexedDbService.getAllNotes(userId),
        indexedDbService.getPendingSyncCount(userId),
        indexedDbService.getTombstoneNodeIds(userId),
      ]);

      console.log('[LOCAL SNAPSHOT]', {
        userId,
        localNodesCount: localNodes.length,
        localNotesCount: localNotes.length,
        pendingQueueCount: pendingCount,
        deletedTombstonesCount: tombstoneIds.length,
      });

      const localNodeIdSet = new Set(localNodes.map((n) => n.id));
      const localNoteIdSet = new Set(localNotes.map((n) => n.id));
      const activeRemoteNodeIdSet = new Set(activeRemoteNodes.map((n) => n.id));
      const remoteNoteIdSet = new Set(remoteNotes.map((n) => n.id));

      const remoteOnlyNodes = activeRemoteNodes
        .filter((n) => !localNodeIdSet.has(n.id))
        .map((n) => n.id);
      const localOnlyNodes = localNodes
        .filter((n) => !activeRemoteNodeIdSet.has(n.id))
        .map((n) => n.id);
      const remoteOnlyNotes = remoteNotes
        .filter((n) => !localNoteIdSet.has(n.id))
        .map((n) => n.id);
      const localOnlyNotes = localNotes
        .filter((n) => !remoteNoteIdSet.has(n.id))
        .map((n) => n.id);

      console.log('[SYNC DIFF]', {
        remoteOnlyNodes,
        localOnlyNodes,
        remoteOnlyNotes,
        localOnlyNotes,
      });
    } catch (err) {
      console.warn('[SyncEngine] Erro ao executar diagnóstico de snapshot:', err);
    }
  }

  /**
   * Hidratação inicial do IndexedDB a partir do Supabase ao iniciar sessão.
   * Respeita LWW com comparação estrita de timestamps, preserva tombstones,
   * trata erros por tabela individualmente e recupera notas órfãs.
   */
  async hydrateFromRemote(userId: string): Promise<boolean> {
    const supabase = getSupabase();
    if (!supabase || !isSupabaseConfigured || !this.isOnline) return false;

    const authUserId = await this.getAuthenticatedUserId();
    if (!authUserId) {
      return false;
    }

    if (userId && userId !== authUserId) {
      console.warn('[SyncEngine] hydrateFromRemote ignorado: userId diverge da sessão ativa do Supabase.');
      return false;
    }

    try {
      console.info('[SyncEngine] Iniciando hidratação inicial a partir do Supabase...');

      const [nodesRes, notesRes, tagsRes, noteTagsRes, linksRes, attachmentsRes] = await Promise.all([
        supabase
          .from('nodes')
          .select('id, user_id, parent_id, type, name, color, position, created_at, updated_at, deleted_at')
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
        supabase
          .from('attachments')
          .select('*')
          .eq('user_id', authUserId),
      ]);

      // Problema 4 e 16: Variáveis explícitas de sucesso e diagnóstico da tabela
      const nodesRemoteQuerySucceeded = !nodesRes.error;
      const notesRemoteQuerySucceeded = !notesRes.error;
      const tagsRemoteQuerySucceeded = !tagsRes.error;
      const noteTagsRemoteQuerySucceeded = !noteTagsRes.error;
      const linksRemoteQuerySucceeded = !linksRes.error;

      // Diagnóstico [HYDRATE TABLE STATUS] (Problema 16)
      console.log('[HYDRATE TABLE STATUS]', {
        nodes: nodesRemoteQuerySucceeded ? 'success' : 'error',
        notes: notesRemoteQuerySucceeded ? 'success' : 'error',
        tags: tagsRemoteQuerySucceeded ? 'success' : 'error',
        note_tags: noteTagsRemoteQuerySucceeded ? 'success' : 'error',
        note_links: linksRemoteQuerySucceeded ? 'success' : 'error',
      });

      // Problema 5: Tratamento individual e isolado de erros por tabela
      if (nodesRes.error) {
        if (isNetworkError(nodesRes.error) || classifySyncError(nodesRes.error) === 'NETWORK') {
          this.handleNetworkDisconnection('hydrate_nodes', nodesRes.error);
          return false;
        }
        console.error('[HYDRATE ERROR] table: nodes error:', nodesRes.error);
      }
      if (notesRes.error) {
        if (isNetworkError(notesRes.error) || classifySyncError(notesRes.error) === 'NETWORK') {
          this.handleNetworkDisconnection('hydrate_notes', notesRes.error);
          return false;
        }
        console.error('[HYDRATE ERROR] table: notes error:', notesRes.error);
      }
      if (tagsRes.error) {
        if (isNetworkError(tagsRes.error) || classifySyncError(tagsRes.error) === 'NETWORK') {
          this.handleNetworkDisconnection('hydrate_tags', tagsRes.error);
          return false;
        }
        console.error('[HYDRATE ERROR] table: tags error:', tagsRes.error);
      }
      if (noteTagsRes.error) {
        if (isNetworkError(noteTagsRes.error) || classifySyncError(noteTagsRes.error) === 'NETWORK') {
          this.handleNetworkDisconnection('hydrate_note_tags', noteTagsRes.error);
          return false;
        }
        console.error('[HYDRATE ERROR] table: note_tags error:', noteTagsRes.error);
      }
      if (linksRes.error) {
        if (isNetworkError(linksRes.error) || classifySyncError(linksRes.error) === 'NETWORK') {
          this.handleNetworkDisconnection('hydrate_links', linksRes.error);
          return false;
        }
        console.error('[HYDRATE ERROR] table: note_links error:', linksRes.error);
      }

      // Se ambas as tabelas primárias falharem, aborta sem corromper estado local (Problema 6)
      if (!nodesRemoteQuerySucceeded && !notesRemoteQuerySucceeded) {
        console.error('[HYDRATE ABORT] Falha de comunicação nas tabelas nodes e notes. Preservando estado local.');
        return false;
      }

      const remoteNodes = nodesRes.data || [];
      const remoteNotes = notesRes.data || [];
      const remoteTags = tagsRes.data || [];
      const remoteNoteTags = noteTagsRes.data || [];
      const remoteLinks = linksRes.data || [];

      // 1. Hidrata IndexedDB com os nós remotos SOMENTE se a consulta de nodes foi bem-sucedida (Problema 6)
      if (nodesRemoteQuerySucceeded) {
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
                color: d.color ?? null,
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
            color: d.color ?? null,
            position: Number(d.position),
            createdAt: d.created_at,
            updatedAt: d.updated_at,
            deletedAt: d.deleted_at,
          };
          await indexedDbService.saveNode(node);
          this.lastSyncedNodeTime.set(d.id, d.updated_at);
        }
      }

      // 2. Hidrata notas se a consulta de notes foi bem-sucedida (Problemas 1, 2, 3, 4, 7, 8, 13, 14, 15)
      if (notesRemoteQuerySucceeded) {
        // REGRA OBRIGATÓRIA (Problema 1 e 4):
        // Só executar a lógica de NOTA ÓRFÃ quando nodesRemoteQuerySucceeded && notesRemoteQuerySucceeded.
        // Se nodesRes.error existir, NÃO executar ORPHAN REPAIR nem ORPHAN RECONSTRUCT!
        if (nodesRemoteQuerySucceeded) {
          const remoteNodeMap = new Map<string, any>();
          for (const rn of remoteNodes) {
            remoteNodeMap.set(rn.id, rn);
          }

          // Problema 7: Verifica a relação NOTE -> NODE
          for (const remoteNote of remoteNotes) {
            const remoteNode = remoteNodeMap.get(remoteNote.node_id);

            if (!remoteNode) {
              // Somente aqui considerar possível órfão (Problema 7)
              console.warn('[ORPHAN NOTE FOUND]', {
                noteId: remoteNote.id,
                nodeId: remoteNote.node_id,
                userId: authUserId,
              });

              // Problema 3 e 14: Procura node no IndexedDB
              const existingLocalNode = await indexedDbService.getNode(remoteNote.node_id);

              if (existingLocalNode) {
                // Se existir tombstone, resolver pelo LWW antes de decidir qualquer coisa (Problema 3)
                if (existingLocalNode.deletedAt) {
                  const localDeletedTime = new Date(existingLocalNode.deletedAt).getTime();
                  const noteRemoteTime = new Date(remoteNote.updated_at || remoteNote.created_at || 0).getTime();

                  if (localDeletedTime >= noteRemoteTime) {
                    console.log('[ORPHAN REPAIR SKIPPED]', {
                      nodeId: remoteNote.node_id,
                      reason: 'Node local possui tombstone recente; respeitando LWW de exclusão local.',
                    });
                    continue;
                  }
                }

                // Se existir e estiver ativo (ou tombstone superado): sincroniza esse node existente
                console.info(`[ORPHAN REPAIR] Node ${remoteNote.node_id} existe localmente. Sincronizando node existente...`);
                if (this.isOnline) {
                  await this.syncNode(existingLocalNode);
                }
                remoteNodeMap.set(existingLocalNode.id, existingLocalNode);
              } else {
                // Problema 2 e 8: Reconstrução de node SOMENTE se:
                // 1. nodesRes.error === null
                // 2. notesRes.error === null
                // 3. consulta remota realmente concluída
                // 4. nota realmente não possui node no resultado remoto
                // 5. node também não existe no IndexedDB
                // E se estiver online antes de tentar enviar (Problema 8)
                const recoveredTitle = MarkdownService.extractTitle(remoteNote.markdown_content || '') || 'Nota Recuperada';
                console.info(`[ORPHAN REPAIR] Reconstruindo TreeNode para nota órfã ${remoteNote.node_id} com título: "${recoveredTitle}"`);
                const reconstructedNode: TreeNode = {
                  id: remoteNote.node_id,
                  userId: authUserId,
                  parentId: null,
                  type: 'note',
                  name: recoveredTitle,
                  position: 9999,
                  createdAt: remoteNote.created_at || new Date().toISOString(),
                  updatedAt: remoteNote.updated_at || new Date().toISOString(),
                };

                await indexedDbService.saveNode(reconstructedNode);

                if (this.isOnline) {
                  await this.syncNode(reconstructedNode);
                } else {
                  // Se offline, enfileira para a fila resolver posteriormente (Problema 8)
                  await this.enqueueNode(reconstructedNode);
                }
                remoteNodeMap.set(reconstructedNode.id, reconstructedNode);
              }
            }
          }
        } else {
          console.warn('[ORPHAN CHECK SKIPPED] Consulta de nodes falhou. Preservando estado e evitando auto-repair prematuro.');
        }

        // Hidrata notas respeitando Last Write Wins (LWW) e comparação de timestamps
        // Problema 13 & 15: Usa sempre remoteNote.id e remoteNote.node_id canônicos (nunca cria novo ID duplicado)
        for (const d of remoteNotes) {
          // BUG 10 & 14: Se o node pai estiver marcado como excluído localmente, não ressuscita a nota e remove do Supabase
          const localParentNode = await indexedDbService.getNode(d.node_id);
          if (localParentNode && localParentNode.deletedAt) {
            this.deleteNoteRemote(d.id, d.node_id).catch(() => {});
            continue;
          }

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

          // Problema 13 & 15: Garante que a nota remota seja criada/atualizada no IndexedDB com IDs canônicos
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
      }

      // 3. Hidrata tags
      if (!tagsRes.error) {
        const remoteTagIdSet = new Set(remoteTags.map((t: any) => t.id));
        const localTags = await indexedDbService.getTags(authUserId);
        for (const lt of localTags) {
          if (!remoteTagIdSet.has(lt.id)) {
            await indexedDbService.deleteTag(lt.id);
          }
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
      }

      // 4. Reconstitui note_tags no IndexedDB
      if (!noteTagsRes.error) {
        const tagMapByNote = new Map<string, string[]>();
        for (const nt of remoteNoteTags) {
          const list = tagMapByNote.get(nt.note_id) || [];
          list.push(nt.tag_id);
          tagMapByNote.set(nt.note_id, list);
        }
        // Atualiza todas as notas locais para garantir que notas cujas tags foram removidas remotamente fiquem vazias
        const allLocalNotes = await indexedDbService.getAllNotes(authUserId);
        const processedNoteIds = new Set<string>();

        for (const note of allLocalNotes) {
          const tIds = tagMapByNote.get(note.id) || tagMapByNote.get(note.nodeId) || [];
          await indexedDbService.setNoteTags(authUserId, note.id, tIds);
          this.lastSyncedTags.set(toCanonicalUuid(note.id), [...tIds].map(toCanonicalUuid).sort().join(','));
          processedNoteIds.add(note.id);
          if (note.nodeId) processedNoteIds.add(note.nodeId);
        }

        for (const [nId, tIds] of tagMapByNote.entries()) {
          if (!processedNoteIds.has(nId)) {
            await indexedDbService.setNoteTags(authUserId, nId, tIds);
            this.lastSyncedTags.set(toCanonicalUuid(nId), [...tIds].map(toCanonicalUuid).sort().join(','));
          }
        }
      }

      // 5. Reconstitui note_links no IndexedDB
      if (!linksRes.error) {
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
      }

      // 6. Hidrata attachments
      if (!attachmentsRes.error && attachmentsRes.data) {
        for (const att of attachmentsRes.data) {
          const local = await indexedDbService.getAttachment(att.id);
          await indexedDbService.saveAttachment({
            id: att.id,
            userId: att.user_id,
            noteId: att.note_id,
            fileName: att.file_name,
            storagePath: att.storage_path,
            mimeType: att.mime_type,
            fileSize: att.file_size,
            localBlob: local?.localBlob || null,
            status: 'uploaded',
            createdAt: att.created_at,
            updatedAt: att.updated_at,
            url: `attachment:${att.storage_path}`,
          });
        }
      }

      // 7. Envia para o Supabase registros locais criados offline (sem existência no remoto)
      if (!nodesRes.error && !notesRes.error) {
        const allLocalNodes = await indexedDbService.getAllNodesRaw(authUserId);
        const remoteNodeIdSet = new Set(remoteNodes.map((rn: any) => rn.id));
        for (const localNode of allLocalNodes) {
          if (!remoteNodeIdSet.has(localNode.id) && !localNode.deletedAt) {
            const ok = await this.syncNode(localNode);
            if (!ok && !(await this.getAuthenticatedUserId())) {
              console.warn('[SyncEngine] Sessão de autenticação indisponível durante envio de nós locais. Pausando push.');
              break;
            }
          }
        }

        if (await this.getAuthenticatedUserId()) {
          const allLocalNotes = await indexedDbService.getAllNotes(authUserId);
          const remoteNoteIdSet = new Set(remoteNotes.map((rn: any) => rn.id));
          const remoteNoteNodeIdSet = new Set(remoteNotes.map((rn: any) => rn.node_id));
          for (const localNote of allLocalNotes) {
            if (!remoteNoteIdSet.has(localNote.id) && !remoteNoteNodeIdSet.has(localNote.nodeId)) {
              const parent = await indexedDbService.getNode(localNote.nodeId);
              if (parent && !parent.deletedAt) {
                await this.syncNode(parent);
              }
              const ok = await this.syncNote(localNote);
              if (!ok && !(await this.getAuthenticatedUserId())) {
                console.warn('[SyncEngine] Sessão de autenticação indisponível durante envio de notas locais. Pausando push.');
                break;
              }
            }
          }
        }
      }

      // Processa itens que possam ter ficado pendentes na fila local
      await this.processPersistentQueue();

      // Executa diagnóstico completo
      await this.debugDiagnosticSnapshot(authUserId);

      this.emitStatus('saved');
      console.info('[SyncEngine] Hidratação inicial concluída com sucesso.');
      return true;
    } catch (err: any) {
      if (isNetworkError(err) || classifySyncError(err) === 'NETWORK') {
        this.handleNetworkDisconnection('hydrateFromRemote', err);
        return false;
      }
      console.error('[SyncEngine] Erro na hidratação remota:', err);
      return false;
    }
  }
}

export const syncEngine = new SyncEngineClass();
