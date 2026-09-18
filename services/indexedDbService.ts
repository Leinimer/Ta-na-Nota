import { TreeNode, NoteRecord, TagRecord, NoteLinkRecord, AttachmentRecord, AppUser, SyncQueueItem } from '@/types';

const DB_NAME = 'DigitalTactilityDB';
const DB_VERSION = 2;

let dbPromise: Promise<IDBDatabase> | null = null;

function getDB(): Promise<IDBDatabase> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('IndexedDB is only available in browser'));
  }

  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // 1. Nodes store
        if (!db.objectStoreNames.contains('nodes')) {
          const nodeStore = db.createObjectStore('nodes', { keyPath: 'id' });
          nodeStore.createIndex('userId', 'userId', { unique: false });
          nodeStore.createIndex('parentId', 'parentId', { unique: false });
          nodeStore.createIndex('type', 'type', { unique: false });
          nodeStore.createIndex('deletedAt', 'deletedAt', { unique: false });
        }

        // 2. Notes store
        if (!db.objectStoreNames.contains('notes')) {
          const noteStore = db.createObjectStore('notes', { keyPath: 'id' });
          noteStore.createIndex('nodeId', 'nodeId', { unique: true });
          noteStore.createIndex('userId', 'userId', { unique: false });
          noteStore.createIndex('isFavorite', 'isFavorite', { unique: false });
          noteStore.createIndex('lastOpenedAt', 'lastOpenedAt', { unique: false });
        }

        // 3. Tags store
        if (!db.objectStoreNames.contains('tags')) {
          const tagStore = db.createObjectStore('tags', { keyPath: 'id' });
          tagStore.createIndex('userId', 'userId', { unique: false });
          tagStore.createIndex('normalizedName', 'normalizedName', { unique: false });
        }

        // 4. Note Tags junction
        if (!db.objectStoreNames.contains('note_tags')) {
          const noteTagStore = db.createObjectStore('note_tags', { keyPath: ['noteId', 'tagId'] });
          noteTagStore.createIndex('noteId', 'noteId', { unique: false });
          noteTagStore.createIndex('tagId', 'tagId', { unique: false });
          noteTagStore.createIndex('userId', 'userId', { unique: false });
        }

        // 5. Note Links (for internal links and backlinks)
        if (!db.objectStoreNames.contains('note_links')) {
          const linkStore = db.createObjectStore('note_links', { keyPath: 'id' });
          linkStore.createIndex('sourceNoteId', 'sourceNoteId', { unique: false });
          linkStore.createIndex('targetNoteId', 'targetNoteId', { unique: false });
          linkStore.createIndex('userId', 'userId', { unique: false });
        }

        // 6. Attachments store
        if (!db.objectStoreNames.contains('attachments')) {
          const attachmentStore = db.createObjectStore('attachments', { keyPath: 'id' });
          attachmentStore.createIndex('noteId', 'noteId', { unique: false });
          attachmentStore.createIndex('userId', 'userId', { unique: false });
        }

        // 7. App State / Local User store
        if (!db.objectStoreNames.contains('user_session')) {
          db.createObjectStore('user_session', { keyPath: 'key' });
        }

        // 8. Persistent Sync Queue store (para fila de persistência offline/online resiliente)
        if (!db.objectStoreNames.contains('sync_queue')) {
          const syncQueueStore = db.createObjectStore('sync_queue', { keyPath: 'id' });
          syncQueueStore.createIndex('userId', 'userId', { unique: false });
          syncQueueStore.createIndex('status', 'status', { unique: false });
          syncQueueStore.createIndex('entityId', 'entityId', { unique: false });
          syncQueueStore.createIndex('createdAt', 'createdAt', { unique: false });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  return dbPromise;
}

export const indexedDbService = {
  // Session
  async getLocalUser(): Promise<AppUser | null> {
    const db = await getDB();
    return new Promise((resolve) => {
      const tx = db.transaction('user_session', 'readonly');
      const req = tx.objectStore('user_session').get('currentUser');
      req.onsuccess = () => resolve(req.result ? req.result.user : null);
      req.onerror = () => resolve(null);
    });
  },

  async setLocalUser(user: AppUser | null): Promise<void> {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('user_session', 'readwrite');
      const store = tx.objectStore('user_session');
      if (user) {
        store.put({ key: 'currentUser', user });
      } else {
        store.delete('currentUser');
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  // Nodes
  async getAllNodes(userId: string): Promise<TreeNode[]> {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('nodes', 'readonly');
      const req = tx.objectStore('nodes').getAll();
      req.onsuccess = () => {
        const list: TreeNode[] = req.result.filter((n: TreeNode) => n.userId === userId && !n.deletedAt);
        resolve(list.sort((a, b) => a.position - b.position));
      };
      req.onerror = () => reject(req.error);
    });
  },

  async getTombstoneNodeIds(userId: string): Promise<string[]> {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('nodes', 'readonly');
      const req = tx.objectStore('nodes').getAll();
      req.onsuccess = () => {
        const ids: string[] = req.result
          .filter((n: TreeNode) => n.userId === userId && Boolean(n.deletedAt))
          .map((n: TreeNode) => n.id);
        resolve(ids);
      };
      req.onerror = () => reject(req.error);
    });
  },

  async getNode(id: string): Promise<TreeNode | null> {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('nodes', 'readonly');
      const req = tx.objectStore('nodes').get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  },

  async saveNode(node: TreeNode): Promise<void> {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('nodes', 'readwrite');
      tx.objectStore('nodes').put(node);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  async saveNodesBatch(nodes: TreeNode[]): Promise<void> {
    if (nodes.length === 0) return;
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('nodes', 'readwrite');
      const store = tx.objectStore('nodes');
      for (const node of nodes) {
        store.put(node);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  async deleteNodeSoft(id: string): Promise<void> {
    const node = await this.getNode(id);
    if (node) {
      node.deletedAt = new Date().toISOString();
      await this.saveNode(node);
    }
  },

  async deleteNode(id: string): Promise<void> {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('nodes', 'readwrite');
      tx.objectStore('nodes').delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  // Notes
  async getNoteByNodeId(nodeId: string): Promise<NoteRecord | null> {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('notes', 'readonly');
      const index = tx.objectStore('notes').index('nodeId');
      const req = index.get(nodeId);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  },

  async getNote(id: string): Promise<NoteRecord | null> {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('notes', 'readonly');
      const req = tx.objectStore('notes').get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  },

  async getAllNotes(userId: string): Promise<NoteRecord[]> {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('notes', 'readonly');
      const req = tx.objectStore('notes').getAll();
      req.onsuccess = () => {
        const list = req.result.filter((n: NoteRecord) => n.userId === userId);
        resolve(list);
      };
      req.onerror = () => reject(req.error);
    });
  },

  async saveNote(note: NoteRecord): Promise<void> {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('notes', 'readwrite');
      tx.objectStore('notes').put(note);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  async saveNoteAndNode(note: NoteRecord, node: TreeNode): Promise<void> {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['notes', 'nodes'], 'readwrite');
      tx.objectStore('notes').put(note);
      tx.objectStore('nodes').put(node);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  async deleteNote(id: string): Promise<void> {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('notes', 'readwrite');
      tx.objectStore('notes').delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  // Tags
  async getTags(userId: string): Promise<TagRecord[]> {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('tags', 'readonly');
      const req = tx.objectStore('tags').getAll();
      req.onsuccess = () => {
        const list = req.result.filter((t: TagRecord) => t.userId === userId);
        resolve(list);
      };
      req.onerror = () => reject(req.error);
    });
  },

  async saveTag(tag: TagRecord): Promise<void> {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('tags', 'readwrite');
      tx.objectStore('tags').put(tag);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  async deleteTag(id: string): Promise<void> {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('tags', 'readwrite');
      tx.objectStore('tags').delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  async getNoteTags(noteId: string): Promise<string[]> {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('note_tags', 'readonly');
      const index = tx.objectStore('note_tags').index('noteId');
      const req = index.getAll(noteId);
      req.onsuccess = () => resolve(req.result.map((item: any) => item.tagId));
      req.onerror = () => reject(req.error);
    });
  },

  async setNoteTags(userId: string, noteId: string, tagIds: string[]): Promise<void> {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('note_tags', 'readwrite');
      const store = tx.objectStore('note_tags');
      const index = store.index('noteId');
      const req = index.getAll(noteId);

      req.onsuccess = () => {
        // remove existing
        for (const item of req.result) {
          store.delete([item.noteId, item.tagId]);
        }
        // add new
        for (const tagId of tagIds) {
          store.put({ noteId, tagId, userId, createdAt: new Date().toISOString() });
        }
      };

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  // Note Links (Backlinks)
  async getNoteLinksForSource(sourceNoteId: string): Promise<NoteLinkRecord[]> {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('note_links', 'readonly');
      const index = tx.objectStore('note_links').index('sourceNoteId');
      const req = index.getAll(sourceNoteId);
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  },

  async getNoteLinksForTarget(targetNoteId: string): Promise<NoteLinkRecord[]> {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('note_links', 'readonly');
      const index = tx.objectStore('note_links').index('targetNoteId');
      const req = index.getAll(targetNoteId);
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  },

  async setNoteLinks(userId: string, sourceNoteId: string, targetNoteIds: string[]): Promise<void> {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('note_links', 'readwrite');
      const store = tx.objectStore('note_links');
      const index = store.index('sourceNoteId');
      const req = index.getAll(sourceNoteId);

      req.onsuccess = () => {
        // delete old
        for (const item of req.result) {
          store.delete(item.id);
        }
        // insert new
        for (const targetId of targetNoteIds) {
          if (targetId !== sourceNoteId) {
            store.put({
              id: `link_${sourceNoteId}_${targetId}`,
              userId,
              sourceNoteId,
              targetNoteId: targetId,
              createdAt: new Date().toISOString(),
            });
          }
        }
      };

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  // Attachments
  async getAttachment(id: string): Promise<AttachmentRecord | null> {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('attachments', 'readonly');
      const req = tx.objectStore('attachments').get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  },

  async getAttachments(noteId: string): Promise<AttachmentRecord[]> {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('attachments', 'readonly');
      const index = tx.objectStore('attachments').index('noteId');
      const req = index.getAll(noteId);
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  },

  async saveAttachment(attachment: AttachmentRecord): Promise<void> {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('attachments', 'readwrite');
      tx.objectStore('attachments').put(attachment);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  async deleteAttachment(id: string): Promise<void> {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('attachments', 'readwrite');
      tx.objectStore('attachments').delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  async getAttachmentByStoragePath(storagePath: string): Promise<AttachmentRecord | null> {
    const db = await getDB();
    return new Promise((resolve) => {
      const tx = db.transaction('attachments', 'readonly');
      const store = tx.objectStore('attachments');
      const req = store.openCursor();
      req.onsuccess = (e) => {
        const cursor = (e.target as IDBRequest).result as IDBCursorWithValue;
        if (cursor) {
          if (cursor.value.storagePath === storagePath) {
            resolve(cursor.value);
            return;
          }
          cursor.continue();
        } else {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    });
  },

  // ====================================================================
  // Persistent Sync Queue Operations (resiliente offline, reconexão e LWW)
  // ====================================================================
  async enqueueSyncItem(item: SyncQueueItem): Promise<void> {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('sync_queue', 'readwrite');
      const store = tx.objectStore('sync_queue');

      // Busca item pendente existente para o mesmo entityId
      const req = store.openCursor();
      let foundExisting = false;

      req.onsuccess = (e) => {
        const cursor = (e.target as IDBRequest).result as IDBCursorWithValue;
        if (cursor) {
          const val = cursor.value as SyncQueueItem;
          if (val.userId === item.userId && val.entityId === item.entityId && val.status === 'pending') {
            foundExisting = true;
            // Coalescing: se a versão nova for igual ou mais recente, substitui o payload e atualiza version
            if (item.version >= (val.version || 0)) {
              const updatedItem: SyncQueueItem = {
                ...val,
                operation: item.operation || val.operation,
                payload: item.payload,
                version: item.version,
                updatedAt: new Date().toISOString(),
                attempts: 0,
                nextAttemptAt: 0,
                lastError: undefined,
              };
              cursor.update(updatedItem);
            }
            // Se já encontrou, não precisa continuar iterando
            return;
          }
          cursor.continue();
        } else {
          // Se não encontrou item pendente pré-existente para esta entidade, insere novo
          if (!foundExisting) {
            const newItem: SyncQueueItem = {
              ...item,
              id: item.id || crypto.randomUUID(),
              status: 'pending',
              attempts: 0,
              nextAttemptAt: 0,
              createdAt: item.createdAt || new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            };
            store.put(newItem);
          }
        }
      };

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  async getPendingSyncItems(userId: string): Promise<SyncQueueItem[]> {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('sync_queue', 'readonly');
      const store = tx.objectStore('sync_queue');
      const req = store.openCursor();
      const results: SyncQueueItem[] = [];
      const now = Date.now();

      req.onsuccess = (e) => {
        const cursor = (e.target as IDBRequest).result as IDBCursorWithValue;
        if (cursor) {
          const val = cursor.value as SyncQueueItem;
          if (val.userId === userId) {
            if (val.status === 'pending' || (val.status === 'failed' && (val.nextAttemptAt || 0) <= now)) {
              results.push(val);
            }
          }
          cursor.continue();
        } else {
          // Ordena por data de criação para processar cronologicamente
          results.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
          resolve(results);
        }
      };

      req.onerror = () => reject(tx.error);
    });
  },

  async updateSyncItem(item: SyncQueueItem): Promise<void> {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('sync_queue', 'readwrite');
      const store = tx.objectStore('sync_queue');
      store.put(item);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  async removeSyncItem(id: string): Promise<void> {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('sync_queue', 'readwrite');
      const store = tx.objectStore('sync_queue');
      store.delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  /**
   * Conclui um item de sincronização de forma atômica e segura contra race conditions.
   * Somente remove da fila se a versão atual na store for menor ou igual à versão que foi processada.
   * Se o usuário realizou novas edições durante a requisição de rede e a fila foi atualizada
   * para uma versão mais recente, o item É MANTIDO na fila para envio subsequente.
   */
  async completeSyncItem(
    id: string,
    processedVersion?: number
  ): Promise<{ removed: boolean; currentVersion?: number }> {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('sync_queue', 'readwrite');
      const store = tx.objectStore('sync_queue');
      const req = store.get(id);

      req.onsuccess = () => {
        const item = req.result as SyncQueueItem | undefined;
        if (!item) {
          resolve({ removed: true });
          return;
        }

        const queueVersion = item.version !== undefined ? Number(item.version) : undefined;
        const targetVersion = processedVersion !== undefined ? Number(processedVersion) : undefined;

        // Se não houver controle de versão ou se a versão na fila for <= à processada:
        if (
          queueVersion === undefined ||
          targetVersion === undefined ||
          queueVersion <= targetVersion
        ) {
          store.delete(id);
          resolve({ removed: true });
        } else {
          // Versão mais recente entrou na fila enquanto o sync estava em andamento: PRESERVA!
          console.info(
            `[SyncQueue] Mantendo item ${id}: versão na fila (${queueVersion}) > versão processada (${targetVersion})`
          );
          resolve({ removed: false, currentVersion: queueVersion });
        }
      };

      tx.oncomplete = () => {};
      tx.onerror = () => reject(tx.error);
    });
  },

  async getPendingSyncCount(userId: string): Promise<number> {
    const items = await this.getPendingSyncItems(userId);
    return items.length;
  },

  /**
   * Migra identificadores legados (com prefixos node_, folder_, note_, tag_)
   * para UUIDs válidos e compatíveis com as tabelas do PostgreSQL no Supabase.
   * Não roda repetidamente nem altera IDs que já sejam UUIDs válidos.
   */
  async migrateLegacyIds(userId: string): Promise<void> {
    const db = await getDB();

    // 1. Verifica flag de migração já concluída para evitar trabalho repetido
    const alreadyMigrated = await new Promise<boolean>((resolve) => {
      try {
        const tx = db.transaction('user_session', 'readonly');
        const req = tx.objectStore('user_session').get(`legacy_migrated_${userId}`);
        req.onsuccess = () => resolve(Boolean(req.result));
        req.onerror = () => resolve(false);
      } catch {
        resolve(false);
      }
    });

    if (alreadyMigrated) return;

    const nodes = await this.getAllNodes(userId);
    const notes = await this.getAllNotes(userId);

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const toValidUuid = (val: string | null | undefined): string => {
      if (!val) return crypto.randomUUID();
      const stripped = val.replace(/^(folder_|node_|note_|tag_)/i, '');
      return uuidRegex.test(stripped) ? stripped.toLowerCase() : crypto.randomUUID();
    };

    const needsMigration =
      nodes.some((n) => !uuidRegex.test(n.id) || (n.parentId && !uuidRegex.test(n.parentId))) ||
      notes.some((nt) => !uuidRegex.test(nt.id) || !uuidRegex.test(nt.nodeId));

    if (!needsMigration) {
      // Marca como migrado e retorna
      try {
        const tx = db.transaction('user_session', 'readwrite');
        tx.objectStore('user_session').put({ key: `legacy_migrated_${userId}`, migratedAt: new Date().toISOString() });
      } catch (err) {
        console.warn('[IndexedDB] Erro ao salvar flag de migração:', err);
      }
      return;
    }

    console.info('[IndexedDB] Migrando identificadores legados para UUIDs válidos com preservação de relações...');

    const nodeIdMap = new Map<string, string>();
    for (const n of nodes) {
      const newId = uuidRegex.test(n.id) ? n.id : toValidUuid(n.id);
      nodeIdMap.set(n.id, newId);
    }

    // 1. Atualiza nós
    const nodeTx = db.transaction('nodes', 'readwrite');
    const nodeStore = nodeTx.objectStore('nodes');
    for (const n of nodes) {
      const newId = nodeIdMap.get(n.id) || n.id;
      const newParentId = n.parentId ? (nodeIdMap.get(n.parentId) || toValidUuid(n.parentId)) : null;

      if (newId !== n.id || newParentId !== n.parentId) {
        nodeStore.delete(n.id);
        nodeStore.put({
          ...n,
          id: newId,
          parentId: newParentId,
        });
      }
    }
    await new Promise<void>((res, rej) => {
      nodeTx.oncomplete = () => res();
      nodeTx.onerror = () => rej(nodeTx.error);
    });

    // 2. Atualiza notas
    const noteTx = db.transaction('notes', 'readwrite');
    const noteStore = noteTx.objectStore('notes');
    for (const nt of notes) {
      const newNoteId = uuidRegex.test(nt.id) ? nt.id : toValidUuid(nt.id);
      const newNodeId = nodeIdMap.get(nt.nodeId) || (uuidRegex.test(nt.nodeId) ? nt.nodeId : toValidUuid(nt.nodeId));

      if (newNoteId !== nt.id || newNodeId !== nt.nodeId) {
        noteStore.delete(nt.id);
        noteStore.put({
          ...nt,
          id: newNoteId,
          nodeId: newNodeId,
        });
      }
    }
    await new Promise<void>((res, rej) => {
      noteTx.oncomplete = () => res();
      noteTx.onerror = () => rej(noteTx.error);
    });

    // 3. Marca como concluído
    try {
      const tx = db.transaction('user_session', 'readwrite');
      tx.objectStore('user_session').put({ key: `legacy_migrated_${userId}`, migratedAt: new Date().toISOString() });
    } catch {}

    console.info('[IndexedDB] Migração concluída com sucesso!');
  },
};
