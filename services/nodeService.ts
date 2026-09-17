import { TreeNode } from '@/types';
import { indexedDbService } from './indexedDbService';
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase/client';
import { MarkdownService } from './markdownService';

export const nodeService = {
  /**
   * Retrieves all active nodes for user and constructs the nested hierarchy tree
   */
  async getTree(userId: string): Promise<TreeNode[]> {
    const supabase = getSupabase();
    let nodes: TreeNode[] = [];

    if (supabase && isSupabaseConfigured) {
      try {
        const { data, error } = await supabase
          .from('nodes')
          .select('id, user_id, parent_id, type, name, position, created_at, updated_at, deleted_at')
          .eq('user_id', userId)
          .is('deleted_at', null)
          .order('position', { ascending: true });

        if (!error && data) {
          nodes = data.map((d: any) => ({
            id: d.id,
            userId: d.user_id,
            parentId: d.parent_id,
            type: d.type,
            name: d.name,
            position: Number(d.position),
            createdAt: d.created_at,
            updatedAt: d.updated_at,
            deletedAt: d.deleted_at,
          }));
          // Sync to indexedDB cache
          for (const n of nodes) await indexedDbService.saveNode(n);
        }
      } catch (err) {
        console.warn('Supabase fetch failed, using local IndexedDB', err);
      }
    }

    if (nodes.length === 0) {
      nodes = await indexedDbService.getAllNodes(userId);
    }

    // Attach note favorites & lastOpened if type === 'note'
    const allNotes = await indexedDbService.getAllNotes(userId);
    const noteMap = new Map(allNotes.map((n) => [n.nodeId, n]));

    for (const node of nodes) {
      if (node.type === 'note') {
        const note = noteMap.get(node.id);
        if (note) {
          node.isFavorite = note.isFavorite;
          node.lastOpenedAt = note.lastOpenedAt;
          node.noteId = note.id;
        }
      }
    }

    // Build hierarchy
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
    const id = 'folder_' + crypto.randomUUID();
    const now = new Date().toISOString();
    const all = await indexedDbService.getAllNodes(userId);
    const siblings = all.filter((n) => n.parentId === parentId);
    const maxPos = siblings.reduce((max, n) => Math.max(max, n.position), 0);
    const position = maxPos + 1000;

    const folderNode: TreeNode = {
      id,
      userId,
      parentId,
      type: 'folder',
      name: name.trim() || 'Nova Pasta',
      position,
      createdAt: now,
      updatedAt: now,
      children: [],
    };

    await indexedDbService.saveNode(folderNode);

    const supabase = getSupabase();
    if (supabase && isSupabaseConfigured) {
      try {
        await supabase.from('nodes').insert({
          id: folderNode.id,
          user_id: userId,
          parent_id: parentId,
          type: 'folder',
          name: folderNode.name,
          position,
        });
      } catch (err) {
        console.warn('Sync folder to supabase error:', err);
      }
    }

    return folderNode;
  },

  async createNote(
    userId: string,
    name: string,
    parentId: string | null = null,
    initialMarkdown: string = ''
  ): Promise<{ node: TreeNode; noteId: string }> {
    const nodeId = 'node_' + crypto.randomUUID();
    const noteId = 'note_' + crypto.randomUUID();
    const now = new Date().toISOString();
    const all = await indexedDbService.getAllNodes(userId);
    const siblings = all.filter((n) => n.parentId === parentId);
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

    // Save atomically in local IndexedDB
    await indexedDbService.saveNode(node);
    await indexedDbService.saveNote(noteRecord);

    // Sync to Supabase if available
    const supabase = getSupabase();
    if (supabase && isSupabaseConfigured) {
      try {
        await supabase.from('nodes').insert({
          id: nodeId,
          user_id: userId,
          parent_id: parentId,
          type: 'note',
          name: nodeName,
          position,
        });
        await supabase.from('notes').insert({
          id: noteId,
          node_id: nodeId,
          user_id: userId,
          markdown_content: initialMarkdown,
          editor_content: initialJson,
          is_favorite: false,
          last_opened_at: now,
        });
      } catch (err) {
        console.warn('Sync note to supabase error:', err);
      }
    }

    return { node, noteId };
  },

  async renameNode(nodeId: string, newName: string): Promise<void> {
    const node = await indexedDbService.getNode(nodeId);
    if (!node) return;
    node.name = newName.trim() || node.name;
    node.updatedAt = new Date().toISOString();
    await indexedDbService.saveNode(node);

    const supabase = getSupabase();
    if (supabase && isSupabaseConfigured) {
      try {
        await supabase.from('nodes').update({ name: node.name, updated_at: node.updatedAt }).eq('id', nodeId);
      } catch (err) {
        console.warn('Supabase rename error:', err);
      }
    }
  },

  async moveNode(nodeId: string, newParentId: string | null, newPosition?: number): Promise<boolean> {
    // 1. Prevent cycle: newParent cannot be nodeId or any descendant of nodeId
    if (newParentId === nodeId) {
      return false;
    }

    const node = await indexedDbService.getNode(nodeId);
    if (!node) return false;

    if (newParentId) {
      let cur: string | null = newParentId;
      while (cur) {
        if (cur === nodeId) {
          // Circular hierarchy attempt!
          return false;
        }
        const parent = await indexedDbService.getNode(cur);
        cur = parent ? parent.parentId : null;
      }
    }

    node.parentId = newParentId;
    if (typeof newPosition === 'number') {
      node.position = newPosition;
    }
    node.updatedAt = new Date().toISOString();
    await indexedDbService.saveNode(node);

    const supabase = getSupabase();
    if (supabase && isSupabaseConfigured) {
      try {
        await supabase.from('nodes').update({
          parent_id: newParentId,
          position: node.position,
          updated_at: node.updatedAt,
        }).eq('id', nodeId);
      } catch (err) {
        console.warn('Supabase move error:', err);
      }
    }

    return true;
  },

  async deleteNode(nodeId: string): Promise<void> {
    await indexedDbService.deleteNodeSoft(nodeId);
    const supabase = getSupabase();
    if (supabase && isSupabaseConfigured) {
      try {
        await supabase.from('nodes').update({ deleted_at: new Date().toISOString() }).eq('id', nodeId);
      } catch (err) {
        console.warn('Supabase delete error:', err);
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
