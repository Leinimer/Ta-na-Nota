import { NoteRecord, TreeNode } from '@/types';
import { indexedDbService } from './indexedDbService';
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase/client';
import { MarkdownService } from './markdownService';
import { syncEngine, toCanonicalUuid } from './syncEngine';

export const noteService = {
  async getNoteByNodeId(nodeId: string): Promise<{ node: TreeNode; note: NoteRecord } | null> {
    const canonicalNodeId = toCanonicalUuid(nodeId);
    let node = await indexedDbService.getNode(canonicalNodeId);
    if (!node) {
      node = await indexedDbService.getNode(nodeId);
    }
    if (!node) return null;

    let note = await indexedDbService.getNoteByNodeId(node.id);
    if (!note && node.id !== nodeId) {
      note = await indexedDbService.getNoteByNodeId(nodeId);
    }

    // Se não encontrado no IndexedDB, tenta buscar diretamente no Supabase
    if (!note) {
      const supabase = getSupabase();
      if (supabase && isSupabaseConfigured) {
        try {
          const { data, error } = await supabase
            .from('notes')
            .select('*')
            .eq('node_id', toCanonicalUuid(node.id))
            .maybeSingle();

          if (!error && data) {
            note = {
              id: data.id,
              nodeId: data.node_id,
              userId: data.user_id,
              markdownContent: data.markdown_content || '',
              editorContent: data.editor_content || MarkdownService.markdownToVisual(data.markdown_content || ''),
              isFavorite: Boolean(data.is_favorite),
              lastOpenedAt: data.last_opened_at,
              version: data.version || 1,
              createdAt: data.created_at,
              updatedAt: data.updated_at,
            };
            await indexedDbService.saveNote(note);
          }
        } catch (err) {
          console.error('[noteService] Erro ao buscar nota no Supabase:', err);
        }
      }
    }

    if (!note) {
      // Cria registro vazio se o nó existe mas a nota não havia sido inicializada
      const now = new Date().toISOString();
      const newNoteId = crypto.randomUUID();
      const finalMd = `# ${node.name || 'Nova nota'}\n\n`;
      note = {
        id: newNoteId,
        nodeId: node.id,
        userId: node.userId,
        markdownContent: finalMd,
        editorContent: MarkdownService.markdownToVisual(finalMd, node.name || 'Nova nota'),
        isFavorite: false,
        lastOpenedAt: now,
        version: 1,
        createdAt: now,
        updatedAt: now,
      };
      await indexedDbService.saveNote(note);
      // Sincroniza imediatamente com o Supabase
      await syncEngine.syncNote(note);
    }

    // Atualiza last_opened_at
    note.lastOpenedAt = new Date().toISOString();
    await indexedDbService.saveNote(note);

    return { node, note };
  },

  async saveNote(
    nodeId: string,
    markdownContent: string,
    editorContent: any
  ): Promise<void> {
    const canonicalNodeId = toCanonicalUuid(nodeId);
    let existing = await indexedDbService.getNoteByNodeId(canonicalNodeId);
    if (!existing) {
      existing = await indexedDbService.getNoteByNodeId(nodeId);
    }

    let node = await indexedDbService.getNode(canonicalNodeId);
    if (!node) {
      node = await indexedDbService.getNode(nodeId);
    }

    const now = new Date().toISOString();

    if (!existing) {
      if (!node) return;
      existing = {
        id: crypto.randomUUID(),
        nodeId: node.id,
        userId: node.userId,
        markdownContent,
        editorContent,
        isFavorite: false,
        lastOpenedAt: now,
        version: 1,
        createdAt: now,
        updatedAt: now,
      };
    } else {
      existing.markdownContent = markdownContent;
      existing.editorContent = editorContent;
      existing.updatedAt = now;
      existing.version = (existing.version || 1) + 1;
    }

    // 1. Persistência local imediata (sem latência na digitação)
    await indexedDbService.saveNote(existing);

    if (node) {
      node.updatedAt = now;
      await indexedDbService.saveNode(node);
    }

    // 2. Extrai e sincroniza links internos ([[WikiLinks]]) e hashtags (#tags)
    await this.syncWikiLinks(existing.userId, existing.id, markdownContent);
    await this.syncTags(existing.userId, existing.id, markdownContent);

    // 3. Enfileira sincronização remota (serializada, sem duplicatas e com retry automático)
    await syncEngine.enqueueNoteSave(existing, node ?? undefined);
  },

  async toggleFavorite(nodeId: string): Promise<boolean> {
    const canonicalNodeId = toCanonicalUuid(nodeId);
    let note = await indexedDbService.getNoteByNodeId(canonicalNodeId);
    if (!note) {
      note = await indexedDbService.getNoteByNodeId(nodeId);
    }
    if (!note) return false;

    let node = await indexedDbService.getNode(canonicalNodeId);
    if (!node) {
      node = await indexedDbService.getNode(nodeId);
    }

    note.isFavorite = !note.isFavorite;
    note.updatedAt = new Date().toISOString();
    await indexedDbService.saveNote(note);

    if (node) {
      node.isFavorite = note.isFavorite;
      node.updatedAt = note.updatedAt;
      await indexedDbService.saveNode(node);
      await syncEngine.syncNode(node);
    }

    await syncEngine.syncNote(note);

    return note.isFavorite;
  },

  /**
   * Identifica [[Nome da Nota]] no markdown, resolve IDs e atualiza note_links local e no Supabase.
   */
  async syncWikiLinks(userId: string, sourceNoteId: string, markdown: string): Promise<void> {
    const titles = MarkdownService.extractWikiLinks(markdown);
    if (titles.length === 0) {
      await indexedDbService.setNoteLinks(userId, sourceNoteId, []);
      await syncEngine.syncNoteLinks(userId, sourceNoteId, []);
      return;
    }

    const allNodes = await indexedDbService.getAllNodes(userId);
    const targetNoteIds: string[] = [];

    for (const title of titles) {
      const targetNode = allNodes.find(
        (n) => n.type === 'note' && n.name.trim().toLowerCase() === title.trim().toLowerCase() && !n.deletedAt
      );
      if (targetNode) {
        const targetNote = await indexedDbService.getNoteByNodeId(targetNode.id);
        if (targetNote && targetNote.id !== sourceNoteId) {
          targetNoteIds.push(targetNote.id);
        }
      }
    }

    await indexedDbService.setNoteLinks(userId, sourceNoteId, targetNoteIds);
    await syncEngine.syncNoteLinks(userId, sourceNoteId, targetNoteIds);
  },

  /**
   * Identifica #tags no markdown, persiste novas tags e atualiza note_tags local e no Supabase.
   */
  async syncTags(userId: string, noteId: string, markdown: string): Promise<void> {
    const tagsFromMd = MarkdownService.extractTags(markdown);
    const existingTags = await indexedDbService.getTags(userId);
    const tagIdMap = new Map(existingTags.map((t) => [t.normalizedName, t.id]));
    const targetTagIds: string[] = [];

    for (const rawTag of tagsFromMd) {
      const normalized = rawTag.toLowerCase();
      let tagId = tagIdMap.get(normalized);
      if (!tagId) {
        tagId = crypto.randomUUID();
        const newTag = {
          id: tagId,
          userId,
          name: rawTag,
          normalizedName: normalized,
          createdAt: new Date().toISOString(),
        };
        await indexedDbService.saveTag(newTag);
        await syncEngine.syncTag(newTag);
        tagIdMap.set(normalized, tagId);
      }
      if (!targetTagIds.includes(tagId)) {
        targetTagIds.push(tagId);
      }
    }

    await indexedDbService.setNoteTags(userId, noteId, targetTagIds);
    await syncEngine.syncNoteTags(userId, noteId, targetTagIds);
  },
};
