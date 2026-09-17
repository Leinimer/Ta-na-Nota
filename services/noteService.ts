import { NoteRecord, TreeNode } from '@/types';
import { indexedDbService } from './indexedDbService';
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase/client';
import { MarkdownService } from './markdownService';

export const noteService = {
  async getNoteByNodeId(nodeId: string): Promise<{ node: TreeNode; note: NoteRecord } | null> {
    const node = await indexedDbService.getNode(nodeId);
    if (!node) return null;

    let note = await indexedDbService.getNoteByNodeId(nodeId);

    // If not found in IndexedDB, attempt to fetch from Supabase
    if (!note) {
      const supabase = getSupabase();
      if (supabase && isSupabaseConfigured) {
        try {
          const { data } = await supabase
            .from('notes')
            .select('*')
            .eq('node_id', nodeId)
            .single();
          if (data) {
            note = {
              id: data.id,
              nodeId: data.node_id,
              userId: data.user_id,
              markdownContent: data.markdown_content || '',
              editorContent: data.editor_content || MarkdownService.markdownToVisual(data.markdown_content || ''),
              isFavorite: data.is_favorite || false,
              lastOpenedAt: data.last_opened_at,
              version: data.version || 1,
              createdAt: data.created_at,
              updatedAt: data.updated_at,
            };
            await indexedDbService.saveNote(note);
          }
        } catch (err) {
          console.warn('Error fetching note from Supabase:', err);
        }
      }
    }

    if (!note) {
      // Create empty record if node exists but note content was missing
      const now = new Date().toISOString();
      note = {
        id: 'note_' + crypto.randomUUID(),
        nodeId,
        userId: node.userId,
        markdownContent: '',
        editorContent: { type: 'doc', content: [{ type: 'paragraph' }] },
        isFavorite: false,
        lastOpenedAt: now,
        version: 1,
        createdAt: now,
        updatedAt: now,
      };
      await indexedDbService.saveNote(note);
    }

    // Update last_opened_at
    note.lastOpenedAt = new Date().toISOString();
    await indexedDbService.saveNote(note);

    return { node, note };
  },

  async saveNote(
    nodeId: string,
    markdownContent: string,
    editorContent: any
  ): Promise<void> {
    const existing = await indexedDbService.getNoteByNodeId(nodeId);
    if (!existing) return;

    const now = new Date().toISOString();
    existing.markdownContent = markdownContent;
    existing.editorContent = editorContent;
    existing.updatedAt = now;
    existing.version = (existing.version || 1) + 1;

    // 1. Immediate local persistence
    await indexedDbService.saveNote(existing);

    // 2. Extract and sync internal note links ([[WikiLinks]])
    await this.syncWikiLinks(existing.userId, existing.id, markdownContent);

    // 3. Extract and sync hashtags (#tags)
    await this.syncTags(existing.userId, existing.id, markdownContent);

    // 4. Background Supabase sync
    const supabase = getSupabase();
    if (supabase && isSupabaseConfigured) {
      try {
        await supabase
          .from('notes')
          .update({
            markdown_content: markdownContent,
            editor_content: editorContent,
            updated_at: now,
            version: existing.version,
          })
          .eq('node_id', nodeId);
      } catch (err) {
        console.warn('Supabase sync note error:', err);
      }
    }
  },

  async toggleFavorite(nodeId: string): Promise<boolean> {
    const note = await indexedDbService.getNoteByNodeId(nodeId);
    if (!note) return false;

    note.isFavorite = !note.isFavorite;
    note.updatedAt = new Date().toISOString();
    await indexedDbService.saveNote(note);

    const supabase = getSupabase();
    if (supabase && isSupabaseConfigured) {
      try {
        await supabase
          .from('notes')
          .update({ is_favorite: note.isFavorite, updated_at: note.updatedAt })
          .eq('node_id', nodeId);
      } catch (err) {
        console.warn('Supabase toggle favorite error:', err);
      }
    }

    return note.isFavorite;
  },

  /**
   * Parses [[Note Title]] in markdown, resolves to note IDs, and updates note_links
   */
  async syncWikiLinks(userId: string, sourceNoteId: string, markdown: string): Promise<void> {
    const titles = MarkdownService.extractWikiLinks(markdown);
    if (titles.length === 0) {
      await indexedDbService.setNoteLinks(userId, sourceNoteId, []);
      return;
    }

    const allNodes = await indexedDbService.getAllNodes(userId);
    const targetNoteIds: string[] = [];

    for (const title of titles) {
      const targetNode = allNodes.find(
        (n) => n.type === 'note' && n.name.trim().toLowerCase() === title.trim().toLowerCase()
      );
      if (targetNode) {
        const targetNote = await indexedDbService.getNoteByNodeId(targetNode.id);
        if (targetNote && targetNote.id !== sourceNoteId) {
          targetNoteIds.push(targetNote.id);
        }
      }
    }

    await indexedDbService.setNoteLinks(userId, sourceNoteId, targetNoteIds);
  },

  /**
   * Parses #tags in markdown, creates tags if needed, and updates note_tags
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
        tagId = 'tag_' + crypto.randomUUID();
        const newTag = {
          id: tagId,
          userId,
          name: rawTag,
          normalizedName: normalized,
          createdAt: new Date().toISOString(),
        };
        await indexedDbService.saveTag(newTag);
        tagIdMap.set(normalized, tagId);
      }
      if (!targetTagIds.includes(tagId)) {
        targetTagIds.push(tagId);
      }
    }

    await indexedDbService.setNoteTags(userId, noteId, targetTagIds);
  },
};
