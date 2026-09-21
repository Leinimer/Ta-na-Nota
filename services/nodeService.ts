import { TreeNode } from '@/types';
import { indexedDbService } from './indexedDbService';
import { MarkdownService } from './markdownService';
import { syncEngine, toCanonicalUuid } from './syncEngine';
import { realtimeService } from './realtimeService';
import { attachmentService } from './attachmentService';

export const nodeService = {
  /**
   * Retrieves all active nodes for user and constructs the nested hierarchy tree
   */
  async getTree(userId: string): Promise<TreeNode[]> {
    // 1. Obtém todos os nós ativos do cache local IndexedDB (que é hidratado pelo syncEngine na inicialização)
    let nodes = await indexedDbService.getAllNodes(userId);
    nodes = nodes.filter((n) => !n.deletedAt);

    // 2. Anexa favoritos e noteId das notas correspondentes
    const allNotes = await indexedDbService.getAllNotes(userId);
    const noteMap = new Map(allNotes.map((n) => [toCanonicalUuid(n.nodeId), n]));

    for (const node of nodes) {
      if (node.type === 'note') {
        const canonicalId = toCanonicalUuid(node.id);
        const note = noteMap.get(canonicalId) || noteMap.get(node.id);
        if (note) {
          node.isFavorite = note.isFavorite;
          node.lastOpenedAt = note.lastOpenedAt;
          node.noteId = note.id;
        }
      }
    }

    // 3. Constrói a hierarquia de pastas e notas
    return this.buildTreeHierarchy(nodes);
  },

  buildTreeHierarchy(flatList: TreeNode[]): TreeNode[] {
    const nodeMap = new Map<string, TreeNode>();
    const roots: TreeNode[] = [];

    // Clone and initialize children
    for (const item of flatList) {
      nodeMap.set(item.id, { ...item, children: [] });
    }

    for (const item of flatList) {
      const current = nodeMap.get(item.id)!;
      if (item.parentId && nodeMap.has(item.parentId)) {
        const parent = nodeMap.get(item.parentId)!;
        parent.children = parent.children || [];
        parent.children.push(current);
      } else {
        roots.push(current);
      }
    }

    // Sort children by position
    const sortNodes = (list: TreeNode[]) => {
      list.sort((a, b) => a.position - b.position);
      for (const node of list) {
        if (node.children && node.children.length > 0) {
          sortNodes(node.children);
        }
      }
    };

    sortNodes(roots);
    return roots;
  },

  async createFolder(userId: string, name: string, parentId: string | null = null): Promise<TreeNode> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const all = await indexedDbService.getAllNodes(userId);
    const siblings = all.filter((n) => n.parentId === parentId && !n.deletedAt);
    const maxPos = siblings.reduce((max, n) => Math.max(max, n.position), 0);
    const position = maxPos + 1000;

    const folderNode: TreeNode = {
      id,
      userId,
      parentId,
      type: 'folder',
      name: name.trim() || 'Nova pasta',
      position,
      createdAt: now,
      updatedAt: now,
      children: [],
    };

    // Registra mutação local para blindar contra eco remoto
    realtimeService.registerLocalNodeUpdate(folderNode.id, folderNode.updatedAt);

    // 1. Salva imediatamente no IndexedDB local
    await indexedDbService.saveNode(folderNode);

    // 2. Enfileira na sync_queue para sincronização em background (não bloqueia a UI)
    syncEngine.enqueueNode(folderNode).catch((err) => {
      console.warn('[nodeService] Falha ao enfileirar pasta criada:', err);
    });

    return folderNode;
  },

  async createNote(
    userId: string,
    name: string,
    parentId: string | null = null,
    initialMarkdown: string = ''
  ): Promise<{ node: TreeNode; noteId: string }> {
    const nodeId = crypto.randomUUID();
    const noteId = crypto.randomUUID();
    const now = new Date().toISOString();
    const all = await indexedDbService.getAllNodes(userId);
    const siblings = all.filter((n) => n.parentId === parentId && !n.deletedAt);
    const maxPos = siblings.reduce((max, n) => Math.max(max, n.position), 0);
    const position = maxPos + 1000;

    const nodeName = name.trim() || 'Sem título';

    const node: TreeNode = {
      id: nodeId,
      userId,
      parentId,
      type: 'note',
      name: nodeName,
      position,
      createdAt: now,
      updatedAt: now,
      isFavorite: false,
      noteId,
    };

    const finalMarkdown = initialMarkdown || `# ${nodeName}\n\n`;
    const initialJson = MarkdownService.markdownToVisual(finalMarkdown, nodeName);

    const noteRecord = {
      id: noteId,
      nodeId,
      userId,
      markdownContent: finalMarkdown,
      editorContent: initialJson,
      isFavorite: false,
      lastOpenedAt: now,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };

    // Registra mutação local para blindar contra eco remoto
    realtimeService.registerLocalNodeUpdate(node.id, node.updatedAt);

    // 1. Salva atomicamente no IndexedDB local em transação multi-store
    await indexedDbService.saveNoteAndNode(noteRecord, node);

    console.log('[LOCAL CREATE NOTE]', {
      nodeId,
      noteId,
      userId,
      name: nodeName,
    });

    // 2. Enfileira na sync_queue para sincronização em background (não bloqueia a UI)
    syncEngine.enqueueNode(node).catch((err) => {
      console.warn('[nodeService] Falha ao enfileirar nó da nova nota:', err);
    });
    syncEngine.enqueueNoteSave(noteRecord, node).catch((err) => {
      console.warn('[nodeService] Falha ao enfileirar conteúdo da nova nota:', err);
    });

    return { node, noteId };
  },

  async renameNode(nodeId: string, newName: string): Promise<void> {
    const node = await indexedDbService.getNode(nodeId);
    if (!node) return;
    const now = new Date().toISOString();
    node.name = newName.trim();
    node.updatedAt = now;

    // Registra mutação local para blindar contra eco remoto
    realtimeService.registerLocalNodeUpdate(node.id, now);

    await indexedDbService.saveNode(node);

    // Enfileira na sync_queue em background
    syncEngine.enqueueNode(node).catch((err) => {
      console.warn('[nodeService] Falha ao enfileirar renomeação de nó:', err);
    });
  },

  async setNodeColor(nodeId: string, color: string | null): Promise<void> {
    const node = await indexedDbService.getNode(nodeId);
    if (!node) return;
    const now = new Date().toISOString();
    node.color = color;
    node.updatedAt = now;

    // Registra mutação local para blindar contra eco remoto
    realtimeService.registerLocalNodeUpdate(node.id, now);

    await indexedDbService.saveNode(node);

    // Enfileira na sync_queue em background
    syncEngine.enqueueNode(node).catch((err) => {
      console.warn('[nodeService] Falha ao enfileirar alteração de cor de nó:', err);
    });
  },

  async moveNode(nodeId: string, newParentId: string | null, newPosition?: number): Promise<boolean> {
    // 1. Previne ciclos: novo pai não pode ser o próprio nó nem nenhum descendente
    if (newParentId === nodeId) {
      return false;
    }

    const node = await indexedDbService.getNode(nodeId);
    if (!node) return false;

    if (newParentId) {
      let cur: string | null = newParentId;
      while (cur) {
        if (cur === nodeId) {
          return false;
        }
        const parent = await indexedDbService.getNode(cur);
        cur = parent ? parent.parentId : null;
      }
    }

    const now = new Date().toISOString();
    // 2. Atualizar no IndexedDB localmente
    node.parentId = newParentId;
    if (typeof newPosition === 'number') {
      node.position = newPosition;
    }
    node.updatedAt = now;

    // Registra mutação local para blindar contra eco remoto
    realtimeService.registerLocalNodeUpdate(node.id, now);

    await indexedDbService.saveNode(node);

    console.log('[MOVE LOCAL]', {
      nodeId: node.id,
      targetParentId: newParentId,
      updatedAt: node.updatedAt,
    });

    // 3. Enfileira sincronização remota na fila persistente sem bloquear a UI
    console.log('[MOVE SYNC]', {
      nodeId: node.id,
      targetParentId: newParentId,
    });
    syncEngine.enqueueNode(node).catch((err) => {
      console.warn('[nodeService] Falha ao enfileirar movimentação de nó:', err);
    });

    // 4. Retorna resultado local imediatamente
    return true;
  },

  async deleteNode(nodeId: string): Promise<void> {
    const now = new Date().toISOString();
    const node = await indexedDbService.getNode(nodeId);
    if (!node) return;

    node.deletedAt = now;
    node.updatedAt = now;

    // Registra tombstone no realtimeService imediatamente
    realtimeService.registerLocalNodeUpdate(node.id, now, true);

    // Se for uma pasta, marca recursivamente todos os nós filhos como excluídos em lote
    if (node.type === 'folder') {
      const allNodes = await indexedDbService.getAllNodes(node.userId);
      const affectedNodes: TreeNode[] = [node];

      const collectDescendants = (parentId: string) => {
        const children = allNodes.filter((n) => n.parentId === parentId && !n.deletedAt);
        for (const child of children) {
          child.deletedAt = now;
          child.updatedAt = now;
          realtimeService.registerLocalNodeUpdate(child.id, now, true);
          affectedNodes.push(child);
          if (child.type === 'folder') {
            collectDescendants(child.id);
          }
        }
      };
      collectDescendants(nodeId);

      // Persiste todos os nós afetados em uma única transação no IndexedDB
      await indexedDbService.saveNodesBatch(affectedNodes);

      // Enfileira cada nó para sincronização em background
      for (const affected of affectedNodes) {
        syncEngine.enqueueNode(affected).catch((err) => {
          console.warn('[nodeService] Falha ao enfileirar deleção de nó:', err);
        });

        if (affected.type === 'note') {
          indexedDbService.getNoteByNodeId(affected.id).then((noteRec) => {
            if (noteRec) {
              attachmentService.deleteAttachmentsForNote(noteRec.id).catch(() => {});
              syncEngine.enqueueNoteDelete(noteRec.id, affected.id, node.userId).catch((err) => {
                console.warn('[nodeService] Falha ao enfileirar deleção de nota:', err);
              });
            }
          });
        }
      }
    } else {
      await indexedDbService.saveNode(node);
      syncEngine.enqueueNode(node).catch((err) => {
        console.warn('[nodeService] Falha ao enfileirar deleção de nó:', err);
      });

      if (node.type === 'note') {
        const noteRec = await indexedDbService.getNoteByNodeId(node.id);
        console.log('[LOCAL DELETE NOTE]', {
          nodeId: node.id,
          noteId: noteRec?.id || node.id,
        });
        if (noteRec) {
          attachmentService.deleteAttachmentsForNote(noteRec.id).catch(() => {});
          syncEngine.enqueueNoteDelete(noteRec.id, node.id, node.userId).catch((err) => {
            console.warn('[nodeService] Falha ao enfileirar deleção de nota:', err);
          });
        }
      }
    }
  },

  async duplicateNote(nodeId: string, userId: string): Promise<{ node: TreeNode; noteId: string } | null> {
    const originalNode = await indexedDbService.getNode(nodeId);
    if (!originalNode || originalNode.type !== 'note') return null;

    const originalNote = await indexedDbService.getNoteByNodeId(nodeId);
    const newName = `${originalNode.name} (cópia)`;
    return this.createNote(userId, newName, originalNode.parentId, originalNote?.markdownContent || '');
  },
};
