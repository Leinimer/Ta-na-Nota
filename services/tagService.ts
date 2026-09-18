import { TagRecord, TreeNode } from '@/types';
import { indexedDbService } from './indexedDbService';
import { syncEngine } from './syncEngine';

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

  async getTagsForNote(noteId: string, userId: string): Promise<TagRecord[]> {
    const noteTagIds = await indexedDbService.getNoteTags(noteId);
    if (!noteTagIds || noteTagIds.length === 0) return [];
    const allTags = await indexedDbService.getTags(userId);
    const tagMap = new Map(allTags.map((t) => [t.id, t]));
    return noteTagIds
      .map((id) => tagMap.get(id))
      .filter((t): t is TagRecord => Boolean(t));
  },

  async getAllUserTags(userId: string): Promise<TagRecord[]> {
    return indexedDbService.getTags(userId);
  },

  async addTagToNote(userId: string, noteId: string, rawTagName: string): Promise<TagRecord[]> {
    const cleanName = rawTagName.trim().replace(/^#+/, '').trim();
    if (!cleanName) {
      return this.getTagsForNote(noteId, userId);
    }
    const normalized = cleanName.toLowerCase();

    // Find existing tag or create new one
    const allTags = await indexedDbService.getTags(userId);
    let tag = allTags.find((t) => t.normalizedName === normalized);

    if (!tag) {
      tag = {
        id: crypto.randomUUID(),
        userId,
        name: cleanName,
        normalizedName: normalized,
        createdAt: new Date().toISOString(),
      };
      await indexedDbService.saveTag(tag);
      await syncEngine.syncTag(tag);
    }

    // Attach to note
    const currentTagIds = await indexedDbService.getNoteTags(noteId);
    if (!currentTagIds.includes(tag.id)) {
      const updated = [...currentTagIds, tag.id];
      await indexedDbService.setNoteTags(userId, noteId, updated);
      await syncEngine.syncNoteTags(userId, noteId, updated);
    }

    return this.getTagsForNote(noteId, userId);
  },

  async removeTagFromNote(userId: string, noteId: string, tagId: string): Promise<TagRecord[]> {
    const currentTagIds = await indexedDbService.getNoteTags(noteId);
    const updatedIds = currentTagIds.filter((id) => id !== tagId);
    await indexedDbService.setNoteTags(userId, noteId, updatedIds);
    await syncEngine.syncNoteTags(userId, noteId, updatedIds);
    return this.getTagsForNote(noteId, userId);
  },
};
