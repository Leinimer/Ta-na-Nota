import { SearchResults } from '@/types';
import { indexedDbService } from './indexedDbService';

export const searchService = {
  async search(query: string, userId: string): Promise<SearchResults> {
    const q = query.trim().toLowerCase();
    if (!q) {
      return { folders: [], notes: [], contentMatches: [], tags: [] };
    }

    const [nodes, notes, tags] = await Promise.all([
      indexedDbService.getAllNodes(userId),
      indexedDbService.getAllNotes(userId),
      indexedDbService.getTags(userId),
    ]);

    const activeNodes = nodes.filter((n) => !n.deletedAt);
    const nodeMap = new Map(activeNodes.map((n) => [n.id, n]));

    // 1. Folders
    const matchingFolders = activeNodes
      .filter((n) => n.type === 'folder' && n.name.toLowerCase().includes(q))
      .map((n) => ({ id: n.id, name: n.name }));

    // 2. Notes by name
    const matchingNotes = activeNodes
      .filter((n) => n.type === 'note' && n.name.toLowerCase().includes(q))
      .map((n) => ({ id: n.id, nodeId: n.id, name: n.name }));

    // 3. Notes by content (deep search)
    const contentMatches: Array<{ id: string; nodeId: string; name: string; snippet: string }> = [];
    for (const note of notes) {
      const parentNode = nodeMap.get(note.nodeId);
      if (!parentNode) continue;

      const contentLower = (note.markdownContent || '').toLowerCase();
      const matchIdx = contentLower.indexOf(q);

      if (matchIdx !== -1 && !matchingNotes.some((mn) => mn.nodeId === note.nodeId)) {
        const start = Math.max(0, matchIdx - 35);
        const end = Math.min(note.markdownContent.length, matchIdx + q.length + 35);
        const snippet = (start > 0 ? '...' : '') +
          note.markdownContent.slice(start, end).replace(/\n/g, ' ') +
          (end < note.markdownContent.length ? '...' : '');

        contentMatches.push({
          id: note.id,
          nodeId: note.nodeId,
          name: parentNode.name,
          snippet,
        });
      }
    }

    // 4. Tags
    const matchingTags = tags
      .filter((t) => t.name.toLowerCase().includes(q.replace(/^#/, '')))
      .map((t) => ({
        id: t.id,
        name: t.name,
        noteCount: t.count || 0,
      }));

    return {
      folders: matchingFolders,
      notes: matchingNotes,
      contentMatches,
      tags: matchingTags,
    };
  },
};
