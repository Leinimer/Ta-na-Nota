import { NoteRecord, TreeNode } from '@/types';
import { indexedDbService } from './indexedDbService';
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase/client';
import { MarkdownService } from './markdownService';
import { syncEngine, toCanonicalUuid } from './syncEngine';

export function extractTitleFromEditorContent(editorContent: any, markdownContent?: string): string {
  if (editorContent && typeof editorContent === 'object' && Array.isArray(editorContent.content)) {
    const firstNode = editorContent.content[0];
    if (firstNode && firstNode.type === 'documentTitle') {
      if (Array.isArray(firstNode.content)) {
        return firstNode.content.map((c: any) => c.text || '').join('');
      }
      if (typeof firstNode.text === 'string') {
        return firstNode.text;
      }
      return '';
    }
  }

  // Fallback para markdown se não houver editorContent estruturado
  if (markdownContent) {
    const match = markdownContent.match(/^#\s*(.*)$/m);
    if (match) {
      return match[1];
    }
  }

  return '';
}

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
              editorContent: data.editor_content || MarkdownService.markdownToVisual(data.markdown_content || '', node.name ?? ''),
              isFavorite: Boolean(data.is_favorite),
              lastOpenedAt: data.last_opened_at,
              version: Number(data.version || 1),
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
      const finalMd = `# ${node.name ?? ''}\n\n`;
      note = {
        id: newNoteId,
        nodeId: node.id,
        userId: node.userId,
        markdownContent: finalMd,
        editorContent: MarkdownService.markdownToVisual(finalMd, node.name ?? ''),
        isFavorite: false,
        lastOpenedAt: now,
        version: 1,
        createdAt: now,
        updatedAt: now,
      };
      await indexedDbService.saveNote(note);
      await syncEngine.syncNote(note);
    }

    // Atualiza last_opened_at localmente
    note.lastOpenedAt = new Date().toISOString();
    await indexedDbService.saveNote(note);

    return { node, note };
  },

  /**
   * Salva conteúdo da nota de forma otimizada:
   * 1. IndexedDB local de resposta instantânea
   * 2. Incrementa versão e atualiza timestamp
   * 3. Sincroniza tags e links SOMENTE se houver mudança real
   * 4. Enfileira sincronização serializada no Supabase
   */
  async saveNote(
    nodeId: string,
    markdownContent: string,
    editorContent: any
  ): Promise<NoteRecord | null> {
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
      if (!node) return null;
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

    // Extrai o título canônico da nota diretamente do primeiro nó documentTitle
    const extractedTitle = extractTitleFromEditorContent(editorContent, markdownContent);

    // 1. Persistência local imediata no IndexedDB (sem latência na digitação)
    await indexedDbService.saveNote(existing);

    if (node) {
      node.name = extractedTitle;
      node.updatedAt = now;
      await indexedDbService.saveNode(node);

      console.log('[NODE LOCAL UPDATE]', {
        nodeId: node.id,
        title: node.name,
        updatedAt: node.updatedAt,
      });

      console.log('[NODE TITLE PERSISTED]', {
        nodeId: node.id,
        title: node.name,
        version: existing.version,
      });
    }

    // 2. Enfileira sincronização remota serializada e agrupada do conteúdo da nota
    await syncEngine.enqueueNoteSave(existing, node ?? undefined);

    // 3. Agenda a extração e sincronização de tags e links de forma DESACOPLADA (fora do caminho crítico)
    this.scheduleTagsAndLinksSync(existing.userId, existing.id, markdownContent);

    return existing;
  },

  // Mapas para debounce independente de tags e links
  _tagsDebounceTimers: new Map<string, NodeJS.Timeout>(),
  _linksDebounceTimers: new Map<string, NodeJS.Timeout>(),

  scheduleTagsAndLinksSync(userId: string, noteId: string, markdown: string) {
    // Debounce de WikiLinks (1000ms após cessar digitação)
    const existingLinkTimer = this._linksDebounceTimers.get(noteId);
    if (existingLinkTimer) clearTimeout(existingLinkTimer);

    const linkTimer = setTimeout(() => {
      this.syncWikiLinks(userId, noteId, markdown).catch((err) => {
        console.warn('[noteService] Erro ao sincronizar wikilinks em background:', err);
      });
      this._linksDebounceTimers.delete(noteId);
    }, 1200);
    this._linksDebounceTimers.set(noteId, linkTimer);

    // Debounce de Tags (1200ms após cessar digitação)
    const existingTagTimer = this._tagsDebounceTimers.get(noteId);
    if (existingTagTimer) clearTimeout(existingTagTimer);

    const tagTimer = setTimeout(() => {
      this.syncTags(userId, noteId, markdown).catch((err) => {
        console.warn('[noteService] Erro ao sincronizar tags em background:', err);
      });
      this._tagsDebounceTimers.delete(noteId);
    }, 1400);
    this._tagsDebounceTimers.set(noteId, tagTimer);
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
    note.version = (note.version || 1) + 1;
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
   * Sincroniza [[WikiLinks]] de forma estritamente diferencial.
   * Não executa DELETE nem INSERT se os alvos não mudaram.
   */
  async syncWikiLinks(userId: string, sourceNoteId: string, markdown: string): Promise<void> {
    const titles = MarkdownService.extractWikiLinks(markdown);
    const allNodes = await indexedDbService.getAllNodes(userId);
    const targetNoteIds: string[] = [];

    for (const title of titles) {
      const targetNode = allNodes.find(
        (n) => n.type === 'note' && n.name.trim().toLowerCase() === title.trim().toLowerCase() && !n.deletedAt
      );
      if (targetNode) {
        const targetNote = await indexedDbService.getNoteByNodeId(targetNode.id);
        if (targetNote && targetNote.id !== sourceNoteId && !targetNoteIds.includes(targetNote.id)) {
          targetNoteIds.push(targetNote.id);
        }
      }
    }

    // Compara com os links atualmente salvos no IndexedDB
    const currentLinks = await indexedDbService.getNoteLinksForSource(sourceNoteId);
    const currentTargetIds = currentLinks.map((l) => l.targetNoteId).sort().join(',');
    const newTargetIds = [...new Set(targetNoteIds)].sort().join(',');

    // Se os links forem idênticos, não toca no banco
    if (currentTargetIds === newTargetIds) {
      return;
    }

    await indexedDbService.setNoteLinks(userId, sourceNoteId, targetNoteIds);
    await syncEngine.syncNoteLinks(userId, sourceNoteId, targetNoteIds);
  },

  /**
   * Sincroniza #tags de forma estritamente diferencial.
   * Não executa DELETE nem INSERT se o conjunto de tags não mudou.
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

    // Compara com as tags atualmente vinculadas a esta nota
    const currentTagIds = (await indexedDbService.getNoteTags(noteId)).slice().sort().join(',');
    const newTagIds = [...new Set(targetTagIds)].slice().sort().join(',');

    // Se as tags forem idênticas, não toca no banco
    if (currentTagIds === newTagIds) {
      return;
    }

    await indexedDbService.setNoteTags(userId, noteId, targetTagIds);
    await syncEngine.syncNoteTags(userId, noteId, targetTagIds);
  },
};
