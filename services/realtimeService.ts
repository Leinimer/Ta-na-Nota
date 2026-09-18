import { getSupabase, isSupabaseConfigured } from '@/lib/supabase/client';
import { indexedDbService } from './indexedDbService';
import { TreeNode, NoteRecord, TagRecord } from '@/types';
import { RealtimeChannel } from '@supabase/supabase-js';
import { MarkdownService } from './markdownService';

export type RealtimeEventType = 'INSERT' | 'UPDATE' | 'DELETE';

export interface RealtimeNodeEvent {
  type: 'node';
  eventType: RealtimeEventType;
  node?: TreeNode;
  nodeId: string;
}

export interface RealtimeNoteEvent {
  type: 'note';
  eventType: RealtimeEventType;
  note?: NoteRecord;
  nodeId: string;
}

export interface RealtimeTagEvent {
  type: 'tag';
  eventType: RealtimeEventType;
  tag?: TagRecord;
  tagId: string;
}

export interface RealtimeRelationEvent {
  type: 'relation';
  table: 'note_tags' | 'note_links' | 'attachments';
  eventType: RealtimeEventType;
  record: any;
}

export type RealtimeAppEvent =
  | RealtimeNodeEvent
  | RealtimeNoteEvent
  | RealtimeTagEvent
  | RealtimeRelationEvent;

type RealtimeListener = (event: RealtimeAppEvent) => void;

class RealtimeServiceClass {
  private channel: RealtimeChannel | null = null;
  private activeUserId: string | null = null;
  private listeners: Set<RealtimeListener> = new Set();
  private isSubscribing = false;

  // Rastreio de mutações locais pendentes para proteção rigorosa contra eco remoto
  private pendingLocalNodeUpdates = new Map<string, string>(); // nodeId -> updatedAt ISO string
  private locallyDeletedNodeIds = new Set<string>(); // nodeIds marcados com tombstone local

  /**
   * Registra uma mutação local para que qualquer eco remoto igual ou anterior seja descartado.
   */
  registerLocalNodeUpdate(nodeId: string, updatedAt: string, isDeleted: boolean = false) {
    this.pendingLocalNodeUpdates.set(nodeId, updatedAt);
    if (isDeleted) {
      this.locallyDeletedNodeIds.add(nodeId);
    }
  }

  isNodeDeletedLocally(nodeId: string): boolean {
    return this.locallyDeletedNodeIds.has(nodeId);
  }

  getPendingLocalNodeUpdate(nodeId: string): string | undefined {
    return this.pendingLocalNodeUpdates.get(nodeId);
  }

  clearPendingLocalNodeUpdate(nodeId: string, remoteUpdatedAt?: string) {
    if (!remoteUpdatedAt) {
      this.pendingLocalNodeUpdates.delete(nodeId);
      return;
    }
    const current = this.pendingLocalNodeUpdates.get(nodeId);
    if (current) {
      const curTime = new Date(current).getTime();
      const remTime = new Date(remoteUpdatedAt).getTime();
      if (remTime >= curTime) {
        this.pendingLocalNodeUpdates.delete(nodeId);
      }
    }
  }

  loadTombstoneIds(ids: string[]) {
    for (const id of ids) {
      this.locallyDeletedNodeIds.add(id);
    }
  }

  /**
   * Adiciona um ouvinte para alterações originadas remotamente via Realtime.
   */
  addListener(listener: RealtimeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public notifyListeners(event: RealtimeAppEvent) {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.error('[RealtimeService] Erro no callback do ouvinte:', err);
      }
    }
  }

  /**
   * Inicia a assinatura única por sessão autenticada.
   * Não cria múltiplas assinaturas nem conexões por nota.
   */
  async subscribe(userId: string): Promise<void> {
    if (!userId) return;

    // Se já estiver ouvindo o mesmo usuário com canal ativo, não recria
    if (this.channel && this.activeUserId === userId) {
      return;
    }

    if (this.isSubscribing) return;
    this.isSubscribing = true;

    try {
      // Limpa qualquer canal anterior
      await this.unsubscribe();

      const supabase = getSupabase();
      if (!supabase || !isSupabaseConfigured) {
        this.isSubscribing = false;
        return;
      }

      this.activeUserId = userId;
      const channelName = `realtime-user-sync-${userId}`;
      const channel = supabase.channel(channelName);

      // 1. Tabela NODES (criação, renomeação, movimentação, exclusão de pastas e notas)
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'nodes', filter: `user_id=eq.${userId}` },
        async (payload) => {
          await this.handleNodeChange(userId, payload);
        }
      );

      // 2. Tabela NOTES (conteúdo de notas, favoritos, atualizações)
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notes', filter: `user_id=eq.${userId}` },
        async (payload) => {
          await this.handleNoteChange(userId, payload);
        }
      );

      // 3. Tabela TAGS
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tags', filter: `user_id=eq.${userId}` },
        async (payload) => {
          await this.handleTagChange(userId, payload);
        }
      );

      // 4. Tabela NOTE_TAGS
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'note_tags', filter: `user_id=eq.${userId}` },
        async (payload) => {
          await this.handleNoteTagChange(userId, payload);
        }
      );

      // 5. Tabela NOTE_LINKS
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'note_links', filter: `user_id=eq.${userId}` },
        async (payload) => {
          await this.handleNoteLinkChange(userId, payload);
        }
      );

      // 6. Tabela ATTACHMENTS
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'attachments', filter: `user_id=eq.${userId}` },
        async (payload) => {
          await this.handleAttachmentChange(userId, payload);
        }
      );

      channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.info('[RealtimeService] Assinatura ativa para o usuário:', userId);
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn('[RealtimeService] Estado da assinatura realtime:', status);
        }
      });

      this.channel = channel;
    } catch (err) {
      console.error('[RealtimeService] Falha ao configurar canal realtime:', err);
    } finally {
      this.isSubscribing = false;
    }
  }

  /**
   * Processa alterações na tabela `nodes` respeitando a política Last Write Wins (LWW).
   * Se o estado local for igual ou mais recente que o evento remoto, o evento é ignorado.
   * Nós excluídos localmente (tombstones) NUNCA podem ser ressuscitados por eventos remotos desatualizados.
   */
  private async handleNodeChange(userId: string, payload: any) {
    const eventType = payload.eventType as RealtimeEventType;
    const row = payload.new || payload.old;
    if (!row || (row.user_id && row.user_id !== userId)) return;

    const nodeId = row.id;
    const remoteUpdatedAt = row.updated_at || new Date().toISOString();
    const remoteTime = new Date(remoteUpdatedAt).getTime();

    // 1. Tratamento para evento DELETE físico do PostgreSQL
    if (eventType === 'DELETE') {
      const localNode = await indexedDbService.getNode(nodeId);
      if (localNode && localNode.updatedAt) {
        const localTime = new Date(localNode.updatedAt).getTime();
        if (localTime > remoteTime) {
          // DELETE remoto mais antigo que mutação local: ignora
          return;
        }
      }
      this.locallyDeletedNodeIds.add(nodeId);
      await indexedDbService.deleteNode(nodeId);
      this.notifyListeners({
        type: 'node',
        eventType: 'DELETE',
        nodeId,
      });
      return;
    }

    // 2. Proteção contra eco local de nós excluídos (tombstone ativo em memória)
    if (this.locallyDeletedNodeIds.has(nodeId)) {
      const pendingTimeStr = this.pendingLocalNodeUpdates.get(nodeId);
      const pendingTime = pendingTimeStr ? new Date(pendingTimeStr).getTime() : 0;
      // Se o evento remoto não for uma deleção explícita ou tiver timestamp <= exclusão local: IGNORE
      if (!row.deleted_at || remoteTime <= pendingTime) {
        console.log('[NODE REMOTE IGNORED LOCALLY DELETED]', { nodeId, remoteUpdatedAt });
        return;
      }
    }

    // 3. Proteção contra eco de mutações locais pendentes (create, rename, move, title)
    const pendingUpdate = this.pendingLocalNodeUpdates.get(nodeId);
    if (pendingUpdate) {
      const pendingTime = new Date(pendingUpdate).getTime();
      if (remoteTime <= pendingTime) {
        console.log('[NODE REMOTE IGNORED LOCAL PENDING ECHO]', {
          nodeId,
          pendingUpdate,
          remoteUpdatedAt,
        });
        return;
      }
    }

    // 4. Consulta versão local no IndexedDB para aplicar Last Write Wins (LWW)
    const localNode = await indexedDbService.getNode(nodeId);
    if (localNode) {
      if (localNode.deletedAt) {
        // O nó local está marcado com tombstone no IndexedDB!
        const localTime = new Date(localNode.updatedAt || localNode.deletedAt).getTime();
        // Se o evento remoto não for um delete explícito ou tiver timestamp menor ou igual:
        if (!row.deleted_at || remoteTime <= localTime) {
          console.log('[NODE REMOTE IGNORED LOCAL TOMBSTONE]', {
            nodeId,
            localUpdatedAt: localNode.updatedAt,
            remoteUpdatedAt,
          });
          return;
        }
      } else if (localNode.updatedAt) {
        const localTime = new Date(localNode.updatedAt).getTime();
        if (localTime >= remoteTime) {
          console.log('[NODE REMOTE IGNORED STALE]', {
            nodeId,
            localUpdatedAt: localNode.updatedAt,
            remoteUpdatedAt,
          });
          return;
        }
      }
    }

    // 5. Se o evento remoto for soft-delete (row.deleted_at preenchido)
    if (row.deleted_at) {
      this.locallyDeletedNodeIds.add(nodeId);
      const tombstoneNode: TreeNode = {
        id: row.id,
        userId: row.user_id,
        parentId: row.parent_id,
        type: row.type,
        name: row.name,
        position: Number(row.position || 0),
        createdAt: row.created_at,
        updatedAt: remoteUpdatedAt,
        deletedAt: row.deleted_at,
      };
      await indexedDbService.saveNode(tombstoneNode);
      this.notifyListeners({
        type: 'node',
        eventType: 'DELETE',
        nodeId,
        node: tombstoneNode,
      });
      return;
    }

    // 6. Evento remoto válido e mais recente que o local
    const node: TreeNode = {
      id: row.id,
      userId: row.user_id,
      parentId: row.parent_id,
      type: row.type,
      name: row.name,
      position: Number(row.position || 0),
      createdAt: row.created_at,
      updatedAt: remoteUpdatedAt,
      deletedAt: row.deleted_at,
    };

    console.log('[NODE REMOTE EVENT APPLIED]', {
      nodeId: node.id,
      name: node.name,
      eventType,
      updatedAt: node.updatedAt,
    });

    // Atualiza IndexedDB local
    await indexedDbService.saveNode(node);

    // Notifica AppShell para atualizar sidebar cirurgicamente sem reconstruir toda a árvore
    this.notifyListeners({
      type: 'node',
      eventType,
      node,
      nodeId,
    });
  }

  /**
   * Processa alterações na tabela `notes` aplicando política Last Write Wins (LWW).
   * Nunca substitui uma edição local mais recente por uma versão remota antiga.
   */
  private async handleNoteChange(userId: string, payload: any) {
    const eventType = payload.eventType as RealtimeEventType;
    const row = payload.new || payload.old;
    if (!row || (row.user_id && row.user_id !== userId)) return;

    const nodeId = row.node_id;
    const noteId = row.id;

    // Se o nó ao qual a nota pertence foi excluído localmente, ignora qualquer evento da nota
    if (this.locallyDeletedNodeIds.has(nodeId)) {
      return;
    }
    const localNode = await indexedDbService.getNode(nodeId);
    if (localNode?.deletedAt) {
      this.locallyDeletedNodeIds.add(nodeId);
      return;
    }

    if (eventType === 'DELETE') {
      await indexedDbService.deleteNote(noteId);
      this.notifyListeners({
        type: 'note',
        eventType: 'DELETE',
        nodeId,
      });
      return;
    }

    const remoteVersion = Number(row.version || 1);
    const remoteUpdatedAt = row.updated_at || new Date().toISOString();

    // 1. Consulta versão local no IndexedDB
    const localNote =
      (await indexedDbService.getNote(noteId)) ||
      (await indexedDbService.getNoteByNodeId(nodeId));

    if (localNote) {
      const localVersion = Number(localNote.version || 1);

      // Política Last Write Wins: se a versão local for igual ou superior à remota, ignora (eco local ou sobrescrita mais recente)
      if (localVersion >= remoteVersion) {
        return;
      }
    }

    // 2. Dado remoto é mais recente: normaliza e sanitiza editorContent
    let parsedEditorContent: any = row.editor_content;
    if (typeof parsedEditorContent === 'string') {
      try {
        parsedEditorContent = JSON.parse(parsedEditorContent);
      } catch {
        parsedEditorContent = null;
      }
    }

    // Se editorContent for inválido ou ausente, reconstrói a partir do markdown
    if (!parsedEditorContent || typeof parsedEditorContent !== 'object' || !Array.isArray(parsedEditorContent.content)) {
      parsedEditorContent = MarkdownService.markdownToVisual(row.markdown_content || '', 'Nota');
    }

    const updatedNote: NoteRecord = {
      id: row.id,
      nodeId: row.node_id,
      userId: row.user_id,
      markdownContent: row.markdown_content || '',
      editorContent: parsedEditorContent,
      isFavorite: Boolean(row.is_favorite),
      lastOpenedAt: row.last_opened_at,
      version: remoteVersion,
      createdAt: row.created_at,
      updatedAt: remoteUpdatedAt,
    };

    await indexedDbService.saveNote(updatedNote);

    // 3. Notifica interface (NoteEditor e AppShell)
    this.notifyListeners({
      type: 'note',
      eventType,
      note: updatedNote,
      nodeId,
    });
  }

  /**
   * Processa alterações na tabela `tags`.
   */
  private async handleTagChange(userId: string, payload: any) {
    const eventType = payload.eventType as RealtimeEventType;
    const row = payload.new || payload.old;
    if (!row || (row.user_id && row.user_id !== userId)) return;

    if (eventType === 'DELETE') {
      await indexedDbService.deleteTag(row.id);
      this.notifyListeners({
        type: 'tag',
        eventType: 'DELETE',
        tagId: row.id,
      });
      return;
    }

    const tag: TagRecord = {
      id: row.id,
      userId: row.user_id,
      name: row.name,
      normalizedName: row.normalized_name,
      createdAt: row.created_at,
    };

    await indexedDbService.saveTag(tag);

    this.notifyListeners({
      type: 'tag',
      eventType,
      tag,
      tagId: row.id,
    });
  }

  /**
   * Processa alterações na tabela `note_tags`.
   */
  private async handleNoteTagChange(userId: string, payload: any) {
    const row = payload.new || payload.old;
    if (!row || (row.user_id && row.user_id !== userId)) return;

    this.notifyListeners({
      type: 'relation',
      table: 'note_tags',
      eventType: payload.eventType as RealtimeEventType,
      record: row,
    });
  }

  /**
   * Processa alterações na tabela `note_links`.
   */
  private async handleNoteLinkChange(userId: string, payload: any) {
    const row = payload.new || payload.old;
    if (!row || (row.user_id && row.user_id !== userId)) return;

    this.notifyListeners({
      type: 'relation',
      table: 'note_links',
      eventType: payload.eventType as RealtimeEventType,
      record: row,
    });
  }

  /**
   * Processa alterações na tabela `attachments`.
   */
  private async handleAttachmentChange(userId: string, payload: any) {
    const row = payload.new || payload.old;
    if (!row || (row.user_id && row.user_id !== userId)) return;

    if (payload.eventType === 'DELETE') {
      await indexedDbService.deleteAttachment(row.id);
    } else {
      await indexedDbService.saveAttachment({
        id: row.id,
        userId: row.user_id,
        noteId: row.note_id,
        fileName: row.file_name,
        storagePath: row.storage_path,
        mimeType: row.mime_type,
        fileSize: row.file_size,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        url: `attachment:${row.storage_path}`,
      });
    }

    this.notifyListeners({
      type: 'relation',
      table: 'attachments',
      eventType: payload.eventType as RealtimeEventType,
      record: row,
    });
  }

  /**
   * Cancela assinatura ao fazer logout ou desmontar sessão.
   */
  async unsubscribe(): Promise<void> {
    if (this.channel) {
      try {
        const supabase = getSupabase();
        if (supabase) {
          await supabase.removeChannel(this.channel);
        }
      } catch (err) {
        console.warn('[RealtimeService] Erro ao remover canal:', err);
      }
      this.channel = null;
    }
    this.activeUserId = null;
  }
}

export const realtimeService = new RealtimeServiceClass();
