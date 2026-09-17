'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { StarterKit } from '@tiptap/starter-kit';
import { Underline } from '@tiptap/extension-underline';
import { Link } from '@tiptap/extension-link';
import { Youtube } from '@tiptap/extension-youtube';
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table';
import { TaskList } from '@tiptap/extension-task-list';
import { TaskItem } from '@tiptap/extension-task-item';
import { Highlight } from '@tiptap/extension-highlight';
import { Placeholder } from '@tiptap/extension-placeholder';
import { Details, DetailsContent, DetailsSummary } from '@tiptap/extension-details';

import { TreeNode, NoteRecord, BacklinkItem, AttachmentRecord, SyncStatus } from '@/types';
import { EditorToolbar } from './EditorToolbar';
import { MarkdownEditor } from './MarkdownEditor';
import { SlashCommandMenu } from './SlashCommandMenu';
import { MarkdownService } from '@/services/markdownService';
import { linkService } from '@/services/linkService';
import { attachmentService } from '@/services/attachmentService';
import { DocumentTitle, DocumentTitleContext } from './extensions/DocumentTitle';
import { ResizableImage } from './extensions/ResizableImage';
import {
  Star,
  Code2,
  Eye,
  RefreshCw,
  CheckCircle2,
} from 'lucide-react';

function formatLastModifiedTime(isoDate?: string) {
  if (!isoDate) return '';
  try {
    const d = new Date(isoDate);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

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
  onNavigateToNote,
  onTagClick,
}: NoteEditorProps) {
  const [mode, setMode] = useState<'visual' | 'markdown'>('visual');
  const titleRef = useRef(node.name || 'Nova nota');

  // Keep titleRef in sync with node.name if changed externally
  useEffect(() => {
    titleRef.current = node.name || 'Nova nota';
  }, [node.name]);

  // Ensure markdownContent has # Title as the first element
  const getInitialMarkdown = () => {
    const raw = note.markdownContent || '';
    if (/^#\s+/m.test(raw)) {
      return raw;
    }
    return `# ${node.name || 'Nova nota'}\n\n${raw}`.trim();
  };

  const [markdownContent, setMarkdownContent] = useState(getInitialMarkdown);
  const [backlinks, setBacklinks] = useState<BacklinkItem[]>([]);
  const [, setAttachments] = useState<AttachmentRecord[]>([]);
  const [, setTags] = useState<string[]>([]);
  const [, setIsUploading] = useState(false);
  const noteImageInputRef = useRef<HTMLInputElement>(null);

  // Slash Command state
  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  const [slashMenuPosition, setSlashMenuPosition] = useState({ top: 0, left: 0 });

  // Highlight Mode: when active, mouse text selection automatically highlights with active pastel color
  const [highlightModeColor, setHighlightModeColor] = useState<string | null>(null);
  const highlightColorRef = useRef<string | null>(null);

  useEffect(() => {
    highlightColorRef.current = highlightModeColor;
  }, [highlightModeColor]);

  const saveTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Compute initial Tiptap JSON content ensuring DocumentTitle is at index 0
  const getInitialContent = () => {
    if (note.editorContent && note.editorContent.content?.[0]?.type === 'documentTitle') {
      return note.editorContent;
    }
    return MarkdownService.markdownToVisual(getInitialMarkdown(), node.name || 'Nova nota');
  };

  // Handle direct image file upload from OS file picker (default width: 50%)
  const handleUploadImage = async (file: File) => {
    if (!file) return;
    setIsUploading(true);
    try {
      const att = await attachmentService.uploadAttachment(node.userId, note.id, file);
      setAttachments((prev) => [...prev, att]);
      if (editor && att.url) {
        editor.chain().focus().insertContent({
          type: 'image',
          attrs: {
            src: att.url,
            alt: file.name,
            width: '50%',
          },
        }).run();
      }
    } catch (err) {
      console.warn('Erro ao processar imagem:', err);
    } finally {
      setIsUploading(false);
    }
  };

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
        DocumentTitle,
        StarterKit.configure({
          heading: { levels: [1, 2, 3, 4] },
          codeBlock: false,
        }),
        Underline,
        Link.configure({
          openOnClick: true,
          autolink: true,
          linkOnPaste: true,
        }),
        ResizableImage,
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
        Details.configure({
          persist: true,
          HTMLAttributes: {
            class: 'details-block my-2 border border-[#E3DCD2] rounded-lg p-2.5 bg-[#FEFDFA]',
          },
        }),
        DetailsSummary,
        DetailsContent,
        Placeholder.configure({
          placeholder: 'Escreva seus pensamentos ou digite "/" para inserir blocos...',
        }),
      ],
      content: getInitialContent(),
      editorProps: {
        attributes: {
          class: 'focus:outline-none min-h-[450px]',
        },
        handleDOMEvents: {
          mouseup: (view) => {
            if (highlightColorRef.current) {
              const { selection } = view.state;
              if (!selection.empty) {
                const colorToApply = highlightColorRef.current;
                setTimeout(() => {
                  if (editor && colorToApply) {
                    editor.chain().setHighlight({ color: colorToApply }).run();
                  }
                }, 10);
              }
            }
            return false;
          },
          keydown: (view, event) => {
            if (event.key === 'Escape' && highlightColorRef.current) {
              setHighlightModeColor(null);
              return true;
            }
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

        // Sync title with documentTitle node (first node)
        const firstNode = ed.state.doc.firstChild;
        if (firstNode && firstNode.type.name === 'documentTitle') {
          const currentText = firstNode.textContent.trim() || 'Nova nota';
          if (currentText !== titleRef.current) {
            titleRef.current = currentText;
            onUpdateTitle(node.id, currentText);
          }
        }

        triggerSave(md, json);
      },
    },
    [note.id]
  );

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
        const json = MarkdownService.markdownToVisual(markdownContent, node.name || 'Nova nota');
        editor.commands.setContent(json);
      }
    }
    setMode(newMode);
  };

  // Handle Markdown raw edit
  const handleMarkdownChange = (newMd: string) => {
    setMarkdownContent(newMd);
    setTags(MarkdownService.extractTags(newMd));

    // Extract title from first # in markdown mode
    const titleMatch = newMd.trim().match(/^#\s+(.*)$/m);
    if (titleMatch && titleMatch[1].trim()) {
      const extractedTitle = titleMatch[1].trim();
      if (extractedTitle !== titleRef.current) {
        titleRef.current = extractedTitle;
        onUpdateTitle(node.id, extractedTitle);
      }
    }

    const json = MarkdownService.markdownToVisual(newMd, node.name || 'Nova nota');
    triggerSave(newMd, json);
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
    <div id="note-editor-container" className="flex flex-col flex-1 h-full bg-[#F9F7F2] overflow-hidden">
      {/* 1. Barra Superior - Nova Organização conforme item 13:
          LADO ESQUERDO: [ Favorito ] [ Visual ] [ Markdown ]
          LADO DIREITO: Salvo localmente • 16:22
      */}
      <div
        id="note-top-bar"
        className="flex items-center justify-between gap-3 px-4 sm:px-6 py-2 border-b border-[#E3DCD2] bg-[#F9F7F2] text-xs select-none"
      >
        {/* LADO ESQUERDO: Favorito | Visual | Markdown */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Botão de Favorito */}
          <button
            type="button"
            id="btn-note-favorite"
            title={node.isFavorite ? 'Remover dos favoritos' : 'Favoritar nota'}
            onClick={() => onToggleFavorite(node.id)}
            className="p-1.5 text-[#8C7B6E] hover:text-[#3D352E] rounded-md hover:bg-[#E3DCD2] transition-colors cursor-pointer"
            aria-label="Favoritar nota"
          >
            <Star className={`w-3.5 h-3.5 ${node.isFavorite ? 'fill-amber-500 text-amber-500' : ''}`} />
          </button>

          {/* Alternância Visual e Markdown - Botões pequenos somente ícones */}
          <div className="flex items-center p-0.5 rounded-md bg-[#E3DCD2] border border-[#D9C5B2]/60">
            <button
              type="button"
              id="btn-mode-visual"
              title="Modo Visual"
              onClick={() => handleToggleMode('visual')}
              className={`p-1 rounded transition-all cursor-pointer ${
                mode === 'visual'
                  ? 'bg-[#D9C5B2] text-[#3D352E] shadow-2xs font-semibold'
                  : 'text-[#8C7B6E]/70 hover:text-[#8C7B6E]'
              }`}
              aria-label="Visual"
            >
              <Eye className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              id="btn-mode-markdown"
              title="Modo Markdown"
              onClick={() => handleToggleMode('markdown')}
              className={`p-1 rounded transition-all cursor-pointer ${
                mode === 'markdown'
                  ? 'bg-[#D9C5B2] text-[#3D352E] shadow-2xs font-semibold'
                  : 'text-[#8C7B6E]/70 hover:text-[#8C7B6E]'
              }`}
              aria-label="Markdown"
            >
              <Code2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* LADO DIREITO: Salvo localmente • Última modificação */}
        <div className="flex items-center gap-2 text-xs text-[#8C7B6E] truncate">
          {syncStatus === 'saving' && (
            <span className="flex items-center gap-1.5 text-[11px] text-amber-700 font-medium">
              <RefreshCw className="w-3 h-3 animate-spin" /> Salvando...
            </span>
          )}
          {syncStatus === 'saved' && (
            <span className="flex items-center gap-1.5 text-[11px] text-emerald-700 font-medium">
              <CheckCircle2 className="w-3.5 h-3.5" /> Salvo localmente
            </span>
          )}
          {syncStatus === 'offline' && (
            <span className="flex items-center gap-1.5 text-[11px] text-[#8C7B6E]/70 font-medium">
              ● Offline
            </span>
          )}

          {node.updatedAt && (
            <span className="text-[11px] text-[#8C7B6E]/70 hidden sm:inline">
              • {formatLastModifiedTime(node.updatedAt)}
            </span>
          )}
        </div>
      </div>

      {/* 2. Visual Mode Docked Toolbar */}
      {mode === 'visual' && (
        <EditorToolbar
          editor={editor}
          onUploadImage={handleUploadImage}
          highlightModeColor={highlightModeColor}
          onSetHighlightModeColor={setHighlightModeColor}
        />
      )}

      {/* 3. Editor Workspace Body */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {mode === 'visual' ? (
          <div className="p-4 sm:p-8 flex justify-center">
            {/* Paper Sheet Container (Página da Nota) */}
            <div
              id="tiptap-editor-wrapper"
              className="w-full max-w-[850px] min-h-[650px] bg-[#FFFFFF] border border-[#E3DCD2] rounded-xl shadow-xs p-6 sm:p-12 relative flex flex-col"
            >
              <DocumentTitleContext.Provider
                value={{
                  userId: node.userId,
                  noteId: note.id,
                  onTagClick: (tag) => onTagClick && onTagClick(tag),
                }}
              >
                <div className="flex-1">
                  <EditorContent editor={editor} />
                </div>
              </DocumentTitleContext.Provider>

              {/* Slash Command Palette Popup */}
              <SlashCommandMenu
                editor={editor}
                isOpen={slashMenuOpen}
                onClose={() => setSlashMenuOpen(false)}
                position={slashMenuPosition}
                onTriggerImageUpload={() => noteImageInputRef.current?.click()}
              />
            </div>
          </div>
        ) : (
          <MarkdownEditor
            content={markdownContent}
            onChange={handleMarkdownChange}
          />
        )}
      </div>

      {/* Hidden input para seleção e upload de imagem via explorador do SO */}
      <input
        ref={noteImageInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif,image/svg+xml"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (file) {
            await handleUploadImage(file);
          }
          e.target.value = '';
        }}
      />
    </div>
  );
}
