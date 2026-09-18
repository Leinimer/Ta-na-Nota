import { TreeNode } from '@/types';
import { indexedDbService } from './indexedDbService';
import { MarkdownService } from './markdownService';
import { syncEngine, toCanonicalUuid } from './syncEngine';

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

    // 1. Salva imediatamente no IndexedDB local
    await indexedDbService.saveNode(folderNode);

    // 2. Sincroniza com o Supabase
    await syncEngine.syncNode(folderNode);

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

    // 1. Salva atomicamente no IndexedDB local
    await indexedDbService.saveNode(node);
    await indexedDbService.saveNote(noteRecord);

    // 2. Sincroniza imediatamente com o Supabase (node primeiro, depois a note)
    await syncEngine.syncNode(node);
    await syncEngine.syncNote(noteRecord);

    return { node, noteId };
  },

  async renameNode(nodeId: string, newName: string): Promise<void> {
    const node = await indexedDbService.getNode(nodeId);
    if (!node) return;
    node.name = newName.trim();
    node.updatedAt = new Date().toISOString();
    await indexedDbService.saveNode(node);

    // Sincroniza com o Supabase
    await syncEngine.syncNode(node);
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

    // 2. Atualizar no IndexedDB localmente
    node.parentId = newParentId;
    if (typeof newPosition === 'number') {
      node.position = newPosition;
    }
    node.updatedAt = new Date().toISOString();
    await indexedDbService.saveNode(node);

    // 3. Dispara sincronização remota em background sem bloquear a UI
    syncEngine.syncNode(node).catch((err) => {
      console.warn('[nodeService] Sincronização em background falhou para nó movido:', err);
    });

    // 4. Retorna resultado local imediatamente
    return true;
  },

  async deleteNode(nodeId: string): Promise<void> {
    const now = new Date().toISOString();
    const node = await indexedDbService.getNode(nodeId);
    if (!node) return;

    node.deletedAt = now;
    await indexedDbService.saveNode(node);
    await syncEngine.syncNode(node);

    // Se for uma pasta, marca recursivamente todos os nós filhos como excluídos
    if (node.type === 'folder') {
      const allNodes = await indexedDbService.getAllNodes(node.userId);
      const markDescendants = async (parentId: string) => {
        const children = allNodes.filter((n) => n.parentId === parentId && !n.deletedAt);
        for (const child of children) {
          child.deletedAt = now;
          await indexedDbService.saveNode(child);
          await syncEngine.syncNode(child);
          if (child.type === 'folder') {
            await markDescendants(child.id);
          }
        }
      };
      await markDescendants(nodeId);
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
