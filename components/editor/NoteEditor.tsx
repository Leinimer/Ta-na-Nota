'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { StarterKit } from '@tiptap/starter-kit';
import { Underline } from '@tiptap/extension-underline';
import { Link } from '@tiptap/extension-link';
import { Image } from '@tiptap/extension-image';
import { Youtube } from '@tiptap/extension-youtube';
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table';
import { TaskList } from '@tiptap/extension-task-list';
import { TaskItem } from '@tiptap/extension-task-item';
import { Highlight } from '@tiptap/extension-highlight';
import { Placeholder } from '@tiptap/extension-placeholder';

import { TreeNode, NoteRecord, BacklinkItem, AttachmentRecord, SyncStatus } from '@/types';
import { EditorToolbar } from './EditorToolbar';
import { MarkdownEditor } from './MarkdownEditor';
import { SlashCommandMenu } from './SlashCommandMenu';
import { MarkdownService } from '@/services/markdownService';
import { linkService } from '@/services/linkService';
import { attachmentService } from '@/services/attachmentService';
import {
  Star,
  Trash2,
  Download,
  Copy,
  Code2,
  Eye,
  Link2,
  Paperclip,
  Plus,
  FileText,
  Music,
  Video,
  FileDown,
  X,
  RefreshCw,
  CheckCircle2,
  Calendar,
} from 'lucide-react';

interface NoteEditorProps {
  node: TreeNode;
  note: NoteRecord;
  syncStatus: SyncStatus;
  onUpdateTitle: (nodeId: string, newTitle: string) => void;
  onSaveContent: (nodeId: string, markdown: string, editorJson: any) => void;
  onToggleFavorite: (nodeId: string) => void;
  onDeleteNote: (nodeId: string) => void;
  onDuplicateNote: (nodeId: string) => void;
  onExportNote: (nodeId: string) => void;
  onNavigateToNote: (nodeId: string) => void;
  onTagClick?: (tag: string) => void;
}

export function NoteEditor({
  node,
  note,
  syncStatus,
  onUpdateTitle,
  onSaveContent,
  onToggleFavorite,
  onDeleteNote,
  onDuplicateNote,
  onExportNote,
  onNavigateToNote,
  onTagClick,
}: NoteEditorProps) {
  const [mode, setMode] = useState<'visual' | 'markdown'>('visual');
  const [title, setTitle] = useState(node.name);
  const [prevNodeName, setPrevNodeName] = useState(node.name);
  if (prevNodeName !== node.name) {
    setPrevNodeName(node.name);
    setTitle(node.name);
  }

  const [markdownContent, setMarkdownContent] = useState(note.markdownContent || '');
  const [backlinks, setBacklinks] = useState<BacklinkItem[]>([]);
  const [attachments, setAttachments] = useState<AttachmentRecord[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [newTagInput, setNewTagInput] = useState('');
  const [isUploading, setIsUploading] = useState(false);

  // Slash Command state
  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  const [slashMenuPosition, setSlashMenuPosition] = useState({ top: 0, left: 0 });

  const saveTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Load backlinks & attachments when active note changes
  useEffect(() => {
    let isMounted = true;

    async function loadMetadata() {
      try {
        const [bl, att] = await Promise.all([
          linkService.getBacklinks(note.id, node.userId),
          attachmentService.getAttachments(note.id),
        ]);
        if (isMounted) {
          setBacklinks(bl);
          setAttachments(att);
          setTags(MarkdownService.extractTags(note.markdownContent || ''));
        }
      } catch (err) {
        console.warn('Error loading note metadata:', err);
      }
    }

    loadMetadata();
    return () => {
      isMounted = false;
    };
  }, [note.id, note.markdownContent, node.userId]);

  // Debounced autosave
  const triggerSave = useCallback(
    (md: string, json: any) => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
      saveTimerRef.current = setTimeout(() => {
        onSaveContent(node.id, md, json);
      }, 400);
    },
    [node.id, onSaveContent]
  );

  // Tiptap Editor Initialization
  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          heading: { levels: [1, 2, 3, 4] },
          codeBlock: false, // will use custom codeblock styling
        }),
        Underline,
        Link.configure({
          openOnClick: true,
          autolink: true,
          linkOnPaste: true,
        }),
        Image.configure({
          allowBase64: false,
          inline: true,
        }),
        Youtube.configure({
          controls: true,
          allowFullscreen: true,
        }),
        Table.configure({
          resizable: true,
        }),
        TableRow,
        TableHeader,
        TableCell,
        TaskList,
        TaskItem.configure({
          nested: true,
        }),
        Highlight.configure({
          multicolor: true,
        }),
        Placeholder.configure({
          placeholder: 'Escreva seus pensamentos ou digite "/" para inserir blocos...',
        }),
      ],
      content: note.editorContent || MarkdownService.markdownToVisual(note.markdownContent || ''),
      editorProps: {
        attributes: {
          class: 'focus:outline-none min-h-[450px]',
        },
        handleDOMEvents: {
          keydown: (view, event) => {
            // Handle slash command
            if (event.key === '/') {
              const { selection } = view.state;
              const coords = view.coordsAtPos(selection.from);
              setSlashMenuPosition({
                top: Math.min(window.innerHeight - 320, coords.bottom + 8),
                left: Math.min(window.innerWidth - 300, coords.left),
              });
              setSlashMenuOpen(true);
            }
            return false;
          },
        },
      },
      onUpdate: ({ editor: ed }) => {
        const json = ed.getJSON();
        const md = MarkdownService.visualToMarkdown(json);
        setMarkdownContent(md);
        setTags(MarkdownService.extractTags(md));
        triggerSave(md, json);
      },
    },
    [note.id]
  );

  // Handle title changes
  const handleTitleChange = (newTitle: string) => {
    setTitle(newTitle);
    onUpdateTitle(node.id, newTitle);
  };

  // Toggle between Visual and Raw Markdown mode
  const handleToggleMode = (newMode: 'visual' | 'markdown') => {
    if (newMode === mode) return;

    if (newMode === 'markdown') {
      if (editor) {
        const md = MarkdownService.visualToMarkdown(editor.getJSON());
        setMarkdownContent(md);
      }
    } else {
      // Switching from markdown to visual
      if (editor) {
        const json = MarkdownService.markdownToVisual(markdownContent);
        editor.commands.setContent(json);
      }
    }
    setMode(newMode);
  };

  // Handle Markdown raw edit
  const handleMarkdownChange = (newMd: string) => {
    setMarkdownContent(newMd);
    setTags(MarkdownService.extractTags(newMd));
    const json = MarkdownService.markdownToVisual(newMd);
    triggerSave(newMd, json);
  };

  // Handle file attachment upload
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsUploading(true);
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const att = await attachmentService.uploadAttachment(node.userId, note.id, file);
        setAttachments((prev) => [...prev, att]);

        // Insert into editor if visual mode
        if (editor) {
          if (file.type.startsWith('image/')) {
            editor.chain().focus().setImage({ src: att.url || '' }).run();
          } else {
            // Add reference link in markdown
            const linkText = `[${file.name}](${att.url})`;
            editor.chain().focus().insertContent(`\n${linkText}\n`).run();
          }
        }
      }
    } catch (err) {
      console.warn('Upload error:', err);
    } finally {
      setIsUploading(false);
      e.target.value = '';
    }
  };

  // Add tag
  const handleAddTag = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanTag = newTagInput.trim().replace(/^#/, '');
    if (!cleanTag || tags.includes(cleanTag)) return;

    const updatedTags = [...tags, cleanTag];
    setTags(updatedTags);
    const appendedMd = `${markdownContent}\n\n#${cleanTag}`;
    setMarkdownContent(appendedMd);
    if (editor) {
      editor.commands.setContent(MarkdownService.markdownToVisual(appendedMd));
    }
    triggerSave(appendedMd, MarkdownService.markdownToVisual(appendedMd));
    setNewTagInput('');
  };

  // Intercept wiki-link clicks inside the editor
  useEffect(() => {
    const handleEditorLinkClick = (e: MouseEvent) => {
      const target = (e.target as HTMLElement).closest('a');
      if (target) {
        const href = target.getAttribute('href');
        if (href && href.startsWith('note:')) {
          e.preventDefault();
          const noteTitle = decodeURIComponent(href.replace('note:', ''));
          // Find matching note
          const matchingBl = backlinks.find((b) => b.title.toLowerCase() === noteTitle.toLowerCase());
          if (matchingBl) {
            onNavigateToNote(matchingBl.nodeId);
          }
        }
      }
    };

    const container = document.getElementById('tiptap-editor-wrapper');
    container?.addEventListener('click', handleEditorLinkClick);
    return () => container?.removeEventListener('click', handleEditorLinkClick);
  }, [backlinks, onNavigateToNote]);

  return (
    <div id="note-editor-container" className="flex flex-col flex-1 h-full bg-[#fbf9f4] dark:bg-[#191816] overflow-hidden">
      {/* 1. Note Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-6 py-3 border-b border-[#eae8e3] dark:border-[#2f2d29] bg-[#ffffff] dark:bg-[#201f1c]">
        {/* Title Input */}
        <div className="flex items-center gap-2 flex-1 min-w-[200px]">
          <input
            id="note-title-input"
            type="text"
            value={title}
            onChange={(e) => handleTitleChange(e.target.value)}
            placeholder="Título da anotação..."
            className="w-full text-xl sm:text-2xl font-serif font-semibold text-[#1b1c19] dark:text-[#f2f1ec] bg-transparent outline-none border-b border-transparent hover:border-[#d1c4bc] focus:border-[#68594d] transition-colors py-0.5"
          />
        </div>

        {/* Action controls */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Mode Switcher: Visual vs Markdown */}
          <div className="flex items-center p-0.5 rounded-lg bg-[#f5f3ee] dark:bg-[#2c2a26] border border-[#d1c4bc] dark:border-[#44403a] text-xs">
            <button
              id="btn-mode-visual"
              onClick={() => handleToggleMode('visual')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-md font-medium transition-all ${
                mode === 'visual'
                  ? 'bg-[#ffffff] dark:bg-[#36342f] text-[#68594d] dark:text-[#d7c3b4] shadow-xs'
                  : 'text-[#7f756e] hover:text-[#1b1c19]'
              }`}
            >
              <Eye className="w-3.5 h-3.5" />
              <span>Visual</span>
            </button>
            <button
              id="btn-mode-markdown"
              onClick={() => handleToggleMode('markdown')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-md font-medium transition-all ${
                mode === 'markdown'
                  ? 'bg-[#ffffff] dark:bg-[#36342f] text-[#68594d] dark:text-[#d7c3b4] shadow-xs'
                  : 'text-[#7f756e] hover:text-[#1b1c19]'
              }`}
            >
              <Code2 className="w-3.5 h-3.5" />
              <span>Markdown</span>
            </button>
          </div>

          {/* Favorite toggle */}
          <button
            id="btn-note-favorite"
            title={node.isFavorite ? 'Remover dos favoritos' : 'Favoritar nota'}
            onClick={() => onToggleFavorite(node.id)}
            className="p-2 text-[#7f756e] hover:text-[#1b1c19] dark:hover:text-[#ffffff] rounded-lg hover:bg-[#eae8e3] dark:hover:bg-[#2c2a26] transition-colors"
          >
            <Star className={`w-4 h-4 ${node.isFavorite ? 'fill-amber-500 text-amber-500' : ''}`} />
          </button>

          {/* Duplicate note */}
          <button
            id="btn-note-duplicate"
            title="Duplicar nota"
            onClick={() => onDuplicateNote(node.id)}
            className="p-2 text-[#7f756e] hover:text-[#1b1c19] dark:hover:text-[#ffffff] rounded-lg hover:bg-[#eae8e3] dark:hover:bg-[#2c2a26] transition-colors"
          >
            <Copy className="w-4 h-4" />
          </button>

          {/* Export Markdown */}
          <button
            id="btn-note-export-md"
            title="Exportar Markdown (.md)"
            onClick={() => onExportNote(node.id)}
            className="p-2 text-[#7f756e] hover:text-[#1b1c19] dark:hover:text-[#ffffff] rounded-lg hover:bg-[#eae8e3] dark:hover:bg-[#2c2a26] transition-colors"
          >
            <Download className="w-4 h-4" />
          </button>

          {/* Delete note */}
          <button
            id="btn-note-delete"
            title="Excluir nota"
            onClick={() => {
              if (confirm(`Deseja mover "${node.name}" para a lixeira?`)) {
                onDeleteNote(node.id);
              }
            }}
            className="p-2 text-[#7f756e] hover:text-red-600 dark:hover:text-red-400 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 2. Visual Mode Docked Toolbar */}
      {mode === 'visual' && (
        <EditorToolbar
          editor={editor}
          onInsertAttachment={() => document.getElementById('file-upload-input')?.click()}
        />
      )}

      {/* 3. Editor Workspace Body */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {mode === 'visual' ? (
          <div className="p-4 sm:p-8 flex justify-center">
            {/* Paper Sheet Container */}
            <div
              id="tiptap-editor-wrapper"
              className="w-full max-w-[850px] min-h-[600px] bg-[#ffffff] dark:bg-[#23221e] border border-[#d1c4bc] dark:border-[#44403a] rounded-xl shadow-xs p-6 sm:p-12 relative"
            >
              {/* Note Metadata Details Bar */}
              <div className="flex items-center justify-between pb-6 mb-6 border-b border-[#eae8e3] dark:border-[#2f2d29] text-xs text-[#7f756e]">
                <div className="flex items-center gap-4">
                  <span className="flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5" />
                    {new Date(node.updatedAt).toLocaleDateString('pt-BR', {
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </span>
                  <span>
                    {markdownContent.trim() ? markdownContent.trim().split(/\s+/).length : 0} palavras
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  {syncStatus === 'saving' && (
                    <span className="flex items-center gap-1 text-[11px] text-amber-600">
                      <RefreshCw className="w-3 h-3 animate-spin" /> Salvando...
                    </span>
                  )}
                  {syncStatus === 'saved' && (
                    <span className="flex items-center gap-1 text-[11px] text-emerald-600">
                      <CheckCircle2 className="w-3 h-3" /> Salvo localmente
                    </span>
                  )}
                </div>
              </div>

              {/* Tiptap Canvas */}
              <EditorContent editor={editor} />

              {/* Slash Command Palette Popup */}
              <SlashCommandMenu
                editor={editor}
                isOpen={slashMenuOpen}
                onClose={() => setSlashMenuOpen(false)}
                position={slashMenuPosition}
              />

              {/* Attachments Section */}
              <div className="mt-12 pt-6 border-t border-[#eae8e3] dark:border-[#2f2d29]">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-semibold tracking-wider text-[#7f756e] uppercase flex items-center gap-1.5">
                    <Paperclip className="w-3.5 h-3.5 text-[#68594d]" /> Anexos e Mídia ({attachments.length})
                  </span>
                  <label
                    htmlFor="file-upload-input"
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-md bg-[#f5f3ee] dark:bg-[#2c2a26] hover:bg-[#eae8e3] dark:hover:bg-[#36342f] text-[#68594d] dark:text-[#d7c3b4] cursor-pointer transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    {isUploading ? 'Enviando...' : 'Adicionar Anexo'}
                  </label>
                  <input
                    id="file-upload-input"
                    type="file"
                    multiple
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </div>

                {attachments.length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                    {attachments.map((att) => {
                      const isImage = att.mimeType.startsWith('image/');
                      const isAudio = att.mimeType.startsWith('audio/');
                      const isVideo = att.mimeType.startsWith('video/');
                      const isPdf = att.mimeType.includes('pdf');

                      return (
                        <div
                          key={att.id}
                          className="p-3 bg-[#f5f3ee] dark:bg-[#2c2a26] border border-[#d1c4bc] dark:border-[#44403a] rounded-lg text-xs flex flex-col gap-2"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 truncate">
                              {isAudio && <Music className="w-4 h-4 text-[#68594d] shrink-0" />}
                              {isVideo && <Video className="w-4 h-4 text-[#68594d] shrink-0" />}
                              {isPdf && <FileText className="w-4 h-4 text-red-600 shrink-0" />}
                              {!isAudio && !isVideo && !isPdf && <Paperclip className="w-4 h-4 text-[#68594d] shrink-0" />}
                              <span className="font-medium truncate">{att.fileName}</span>
                            </div>
                            <span className="text-[10px] text-[#7f756e] shrink-0">
                              {(att.fileSize / 1024).toFixed(1)} KB
                            </span>
                          </div>

                          {/* Media Player Renders */}
                          {isAudio && att.url && (
                            <audio controls src={att.url} className="w-full h-8 mt-1" />
                          )}
                          {isVideo && att.url && (
                            <video controls src={att.url} className="w-full max-h-48 rounded-md mt-1" />
                          )}
                          {isPdf && att.url && (
                            <a
                              href={att.url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-[11px] text-[#68594d] dark:text-[#d7c3b4] hover:underline"
                            >
                              <FileDown className="w-3.5 h-3.5" /> Abrir / Baixar Documento PDF
                            </a>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Backlinks / "Referenciado por" Section */}
              <div className="mt-8 pt-6 border-t border-[#eae8e3] dark:border-[#2f2d29]">
                <div className="text-xs font-semibold tracking-wider text-[#7f756e] uppercase mb-2 flex items-center gap-1.5">
                  <Link2 className="w-3.5 h-3.5 text-[#68594d]" /> Referenciado Por / Backlinks ({backlinks.length})
                </div>
                {backlinks.length === 0 ? (
                  <p className="text-xs text-[#7f756e] italic">
                    Nenhuma outra nota faz referência a esta no momento. Use [[{node.name}]] em qualquer outra nota para criar uma conexão bilateral.
                  </p>
                ) : (
                  <div className="space-y-1.5 mt-2">
                    {backlinks.map((bl) => (
                      <div
                        key={bl.noteId}
                        onClick={() => onNavigateToNote(bl.nodeId)}
                        className="p-2.5 rounded-lg border border-[#d1c4bc] dark:border-[#44403a] hover:border-[#68594d] bg-[#f5f3ee] dark:bg-[#2c2a26] hover:bg-[#f4dfcb]/30 transition-colors cursor-pointer"
                      >
                        <div className="font-medium text-xs text-[#68594d] dark:text-[#d7c3b4]">
                          {bl.title}
                        </div>
                        {bl.snippet && (
                          <div className="text-[11px] text-[#7f756e] mt-0.5 truncate font-serif italic">
                            &ldquo;{bl.snippet}&rdquo;
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Tags Section */}
              <div className="mt-8 pt-6 border-t border-[#eae8e3] dark:border-[#2f2d29]">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-[#7f756e] font-medium">Etiquetas:</span>
                  {tags.map((tag) => (
                    <button
                      key={tag}
                      onClick={() => onTagClick && onTagClick(tag)}
                      className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-mono bg-[#f5f3ee] dark:bg-[#2c2a26] text-[#68594d] dark:text-[#d7c3b4] border border-[#d1c4bc] dark:border-[#44403a] hover:bg-[#f4dfcb]/50 transition-colors"
                    >
                      #{tag}
                    </button>
                  ))}

                  <form onSubmit={handleAddTag} className="inline-flex items-center gap-1">
                    <input
                      type="text"
                      value={newTagInput}
                      onChange={(e) => setNewTagInput(e.target.value)}
                      placeholder="+ tag"
                      className="w-16 px-2 py-0.5 rounded-full text-xs border border-dashed border-[#d1c4bc] dark:border-[#44403a] bg-transparent outline-none focus:w-24 focus:border-[#68594d] transition-all font-mono"
                    />
                  </form>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <MarkdownEditor
            content={markdownContent}
            onChange={handleMarkdownChange}
          />
        )}
      </div>
    </div>
  );
}
