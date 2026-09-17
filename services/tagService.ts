import { TagRecord, TreeNode } from '@/types';
import { indexedDbService } from './indexedDbService';

export const tagService = {
  async getTagsWithCount(userId: string): Promise<TagRecord[]> {
    const tags = await indexedDbService.getTags(userId);
    const notes = await indexedDbService.getAllNotes(userId);

    const counts = new Map<string, number>();

    for (const note of notes) {
      const noteTagIds = await indexedDbService.getNoteTags(note.id);
      for (const tId of noteTagIds) {
        counts.set(tId, (counts.get(tId) || 0) + 1);
      }
    }

    return tags.map((t) => ({
      ...t,
      count: counts.get(t.id) || 0,
    }));
  },

  async getNotesForTag(tagId: string, userId: string): Promise<TreeNode[]> {
    const notes = await indexedDbService.getAllNotes(userId);
    const nodes = await indexedDbService.getAllNodes(userId);
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));

    const matchingNodes: TreeNode[] = [];

    for (const note of notes) {
      const tagIds = await indexedDbService.getNoteTags(note.id);
      if (tagIds.includes(tagId)) {
        const node = nodeMap.get(note.nodeId);
        if (node && !node.deletedAt) {
          matchingNodes.push({
            ...node,
            noteId: note.id,
            isFavorite: note.isFavorite,
          });
        }
      }
    }

    return matchingNodes;
  },
};
