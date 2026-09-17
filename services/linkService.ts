import { BacklinkItem } from '@/types';
import { indexedDbService } from './indexedDbService';

export const linkService = {
  /**
   * Returns all notes that reference the given note
   */
  async getBacklinks(targetNoteId: string, userId: string): Promise<BacklinkItem[]> {
    const links = await indexedDbService.getNoteLinksForTarget(targetNoteId);
    if (links.length === 0) return [];

    const nodes = await indexedDbService.getAllNodes(userId);
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    const backlinks: BacklinkItem[] = [];

    for (const link of links) {
      const sourceNote = await indexedDbService.getNote(link.sourceNoteId);
      if (sourceNote) {
        const sourceNode = nodeMap.get(sourceNote.nodeId);
        if (sourceNode && !sourceNode.deletedAt) {
          // Find context snippet around the link in the markdown
          let snippet = '';
          const lines = sourceNote.markdownContent.split('\n');
          for (const line of lines) {
            if (line.includes('[[')) {
              snippet = line.trim().slice(0, 100);
              break;
            }
          }
          backlinks.push({
            noteId: sourceNote.id,
            nodeId: sourceNode.id,
            title: sourceNode.name,
            snippet: snippet || 'Referência no documento',
          });
        }
      }
    }

    return backlinks;
  },

  /**
   * Search available note titles for autocomplete `[[Note Title]]`
   */
  async getNoteSuggestions(userId: string, query: string): Promise<Array<{ id: string; nodeId: string; title: string }>> {
    const nodes = await indexedDbService.getAllNodes(userId);
    const cleanQuery = query.toLowerCase().trim();

    return nodes
      .filter((n) => n.type === 'note' && !n.deletedAt && n.name.toLowerCase().includes(cleanQuery))
      .slice(0, 8)
      .map((n) => ({
        id: n.id,
        nodeId: n.id,
        title: n.name,
      }));
  },
};
