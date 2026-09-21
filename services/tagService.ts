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

    // 1. Localiza tag existente ou cria nova
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
      // Etapa 1: salvar no IndexedDB
      await indexedDbService.saveTag(tag);

      // Etapas 2 e 3: salvar na tabela tags do Supabase e confirmar que a linha foi gravada
      const tagSynced = await syncEngine.syncTag(tag);
      if (!tagSynced) {
        // Enfileira na sync_queue com garantia de entrega
        await syncEngine.enqueueTag(tag, 'upsert');
      }
    }

    // Etapas 4 e 5: associar tag à nota na tabela note_tags e confirmar gravação
    const currentTagIds = await indexedDbService.getNoteTags(noteId);
    if (!currentTagIds.includes(tag.id)) {
      const updated = [...currentTagIds, tag.id];
      // 4. Salvar associação no IndexedDB
      await indexedDbService.setNoteTags(userId, noteId, updated);

      // 5. Salvar na tabela note_tags do Supabase com confirmação
      const noteTagsSynced = await syncEngine.syncNoteTags(userId, noteId, updated);
      if (!noteTagsSynced) {
        // Enfileira na sync_queue com garantia de entrega
        await syncEngine.enqueueNoteTags(userId, noteId, updated);
      }
    }

    // 6. Retorna tags atualizadas da nota
    return this.getTagsForNote(noteId, userId);
  },

  async removeTagFromNote(userId: string, noteId: string, tagId: string): Promise<TagRecord[]> {
    const currentTagIds = await indexedDbService.getNoteTags(noteId);
    const updatedIds = currentTagIds.filter((id) => id !== tagId);

    // 1. Remover a associação de note_tags no IndexedDB
    await indexedDbService.setNoteTags(userId, noteId, updatedIds);

    // Sincroniza remoção no Supabase
    const synced = await syncEngine.syncNoteTags(userId, noteId, updatedIds);
    if (!synced) {
      await syncEngine.enqueueNoteTags(userId, noteId, updatedIds);
    }

    // 2. Se a tag não estiver mais em nenhuma nota, remover ou marcar como sem uso
    const allNotes = await indexedDbService.getAllNotes(userId);
    let isTagStillInUse = false;
    for (const n of allNotes) {
      const nTagIds = await indexedDbService.getNoteTags(n.id);
      if (nTagIds.includes(tagId)) {
        isTagStillInUse = true;
        break;
      }
    }

    if (!isTagStillInUse) {
      // 3. Sincronizar essa remoção de forma consistente com o Supabase e IndexedDB
      await indexedDbService.deleteTag(tagId);
      const delOk = await syncEngine.deleteTagRemote(tagId);
      if (!delOk) {
        const tagRecord: TagRecord = {
          id: tagId,
          userId,
          name: '',
          normalizedName: '',
          createdAt: new Date().toISOString(),
        };
        await syncEngine.enqueueTag(tagRecord, 'delete');
      }
    }

    return this.getTagsForNote(noteId, userId);
  },
};
