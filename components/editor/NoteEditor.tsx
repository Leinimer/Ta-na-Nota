'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
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
import { TextSelection } from '@tiptap/pm/state';
import { EditorToolbar } from './EditorToolbar';
import { MarkdownEditor } from './MarkdownEditor';
import { SlashCommandMenu } from './SlashCommandMenu';
import { MarkdownService } from '@/services/markdownService';
import { linkService } from '@/services/linkService';
import { attachmentService } from '@/services/attachmentService';
import { DocumentTitle, DocumentTitleContext } from './extensions/DocumentTitle';
import { ResizableImage } from './extensions/ResizableImage';

interface NoteEditorProps {
  node: TreeNode;
  note: NoteRecord;
  syncStatus: SyncStatus;
  remoteNoteUpdate?: NoteRecord | null;
  onRemoteUpdateHandled?: () => void;
  onUpdateTitle: (nodeId: string, newTitle: string) => void;
  onSaveContent: (nodeId: string, markdown: string, editorJson: any) => Promise<NoteRecord | null | void> | void;
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
  remoteNoteUpdate,
  onRemoteUpdateHandled,
  onUpdateTitle,
  onSaveContent,
  onToggleFavorite,
  onNavigateToNote,
  onTagClick,
}: NoteEditorProps) {
  const [mode, setMode] = useState<'visual' | 'markdown'>('visual');
  const titleRef = useRef(node.name || 'Nova nota');

  // Refs para controle estrito e separação entre edição local e dados remotos
  const localEditRevisionRef = useRef(0);
  const lastPersistedVersionRef = useRef<number>(note.version || 1);
  const lastPersistedUpdatedAtRef = useRef<string>(note.updatedAt || '');
  const lastPersistedMarkdownRef = useRef<string>(note.markdownContent || '');
  const lastEditedMarkdownRef = useRef<string>(note.markdownContent || '');
  const activeNoteIdRef = useRef<string>(note.id);
  const saveTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Sincroniza refs quando o ID da nota ativa muda (abertura de uma nota diferente)
  useEffect(() => {
    activeNoteIdRef.current = note.id;
    localEditRevisionRef.current = 0;
    lastPersistedVersionRef.current = note.version || 1;
    lastPersistedUpdatedAtRef.current = note.updatedAt || '';
    lastPersistedMarkdownRef.current = note.markdownContent || '';
    lastEditedMarkdownRef.current = note.markdownContent || '';
    titleRef.current = node.name || 'Nova nota';
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.id]);

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

  // Compute initial Tiptap JSON content ensuring DocumentTitle is at index 0 and schema is valid
  const getInitialContent = () => {
    try {
      let content = note.editorContent;
      if (typeof content === 'string') {
        try {
          content = JSON.parse(content);
        } catch {
          content = null;
        }
      }
      if (
        content &&
        typeof content === 'object' &&
        content.type === 'doc' &&
        Array.isArray(content.content) &&
        content.content[0]?.type === 'documentTitle'
      ) {
        return content;
      }
    } catch (err) {
      console.warn('[NoteEditor] Falha ao processar editorContent inicial:', err);
    }
    return MarkdownService.markdownToVisual(getInitialMarkdown(), node.name || 'Nova nota');
  };

  // Handle direct image file upload through storage service (NEVER as Base64 in JSON/Markdown)
  const handleUploadImage = async (file: File) => {
    if (!file) return;
    setIsUploading(true);
    try {
      const att = await attachmentService.uploadAttachment(node.userId, note.id, file);
      setAttachments((prev) => [...prev, att]);
      if (editor && att.url) {
        editor
          .chain()
          .focus()
          .insertContent({
            type: 'image',
            attrs: {
              src: att.url,
              alt: file.name,
              width: '50%',
            },
          })
          .run();
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.id, node.userId]);

  // Debounced autosave (~400ms)
  const triggerSave = useCallback(
    (md: string, json: any) => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
      saveTimerRef.current = setTimeout(async () => {
        try {
          const savedNote = await onSaveContent(node.id, md, json);
          if (savedNote) {
            lastPersistedMarkdownRef.current = savedNote.markdownContent || md;
            lastPersistedVersionRef.current = savedNote.version || (lastPersistedVersionRef.current + 1);
            lastPersistedUpdatedAtRef.current = savedNote.updatedAt || new Date().toISOString();
          } else {
            lastPersistedMarkdownRef.current = md;
            lastPersistedVersionRef.current += 1;
            lastPersistedUpdatedAtRef.current = new Date().toISOString();
          }
          console.log('[EDITOR LOCAL SAVE]', {
            noteId: node.id,
            version: lastPersistedVersionRef.current,
            updatedAt: lastPersistedUpdatedAtRef.current,
          });
        } catch (err) {
          console.warn('[NoteEditor] Erro ao persistir nota:', err);
        }
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
        // Anti-Base64: intercepta colagem e soltura de arquivos para upload no Storage
        handlePaste: (_view, event) => {
          const items = event.clipboardData?.items;
          if (items) {
            for (const item of Array.from(items)) {
              if (item.type.startsWith('image/')) {
                const file = item.getAsFile();
                if (file) {
                  event.preventDefault();
                  handleUploadImage(file);
                  return true;
                }
              }
            }
          }
          return false;
        },
        handleDrop: (_view, event) => {
          const files = event.dataTransfer?.files;
          if (files && files.length > 0) {
            for (const file of Array.from(files)) {
              if (file.type.startsWith('image/') || file.type === 'application/pdf') {
                event.preventDefault();
                handleUploadImage(file);
                return true;
              }
            }
          }
          return false;
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
        localEditRevisionRef.current += 1;
        const json = ed.getJSON();
        const md = MarkdownService.visualToMarkdown(json);
        lastEditedMarkdownRef.current = md;
        console.log('[EDITOR LOCAL UPDATE]', {
          noteId: node.id,
          revision: localEditRevisionRef.current,
        });

        setMarkdownContent(md);
        setTags(MarkdownService.extractTags(md));

        // Sync title with documentTitle node (first node)
        const firstNode = ed.state.doc.firstChild;
        if (firstNode && firstNode.type.name === 'documentTitle') {
          const currentText = firstNode.textContent;
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

  // Sincroniza alteração de nome vinda da sidebar diretamente no primeiro bloco documentTitle do Tiptap via transação atômica
  useEffect(() => {
    const newName = node.name || 'Nova nota';
    if (newName !== titleRef.current) {
      titleRef.current = newName;
      if (editor && !editor.isDestroyed) {
        const firstNode = editor.state.doc.firstChild;
        if (firstNode && firstNode.type.name === 'documentTitle' && firstNode.textContent !== newName) {
          const { tr } = editor.state;
          const from = 1;
          const to = firstNode.nodeSize - 1;
          if (to >= from) {
            tr.replaceWith(from, to, newName ? editor.schema.text(newName) : []);
          } else if (newName) {
            tr.insert(from, editor.schema.text(newName));
          }
          editor.view.dispatch(tr);
        }
      }
    }
  }, [node.name, editor]);

  // Tratamento de atualizações remotas genuínas via Realtime (sem setContent destrutivo)
  useEffect(() => {
    if (!remoteNoteUpdate || remoteNoteUpdate.id !== note.id) return;

    const incoming = remoteNoteUpdate;
    const incomingVersion = Number(incoming.version || 1);
    const persistedVersion = Number(lastPersistedVersionRef.current || 1);
    const incomingMd = incoming.markdownContent || '';

    // 1. Verificação adicional de eco da própria edição local
    if (
      incomingVersion <= persistedVersion ||
      incomingMd === lastPersistedMarkdownRef.current ||
      incomingMd === lastEditedMarkdownRef.current
    ) {
      console.log('[REALTIME LOCAL ECHO]', {
        noteId: incoming.id,
        version: incomingVersion,
        persistedVersion,
      });
      lastPersistedVersionRef.current = Math.max(lastPersistedVersionRef.current, incomingVersion);
      lastPersistedUpdatedAtRef.current = incoming.updatedAt || lastPersistedUpdatedAtRef.current;
      onRemoteUpdateHandled?.();
      return;
    }

    // 2. Mudança remota real
    console.log('[REALTIME REMOTE CHANGE]', {
      noteId: incoming.id,
      incomingVersion,
      persistedVersion,
    });

    // Se o usuário estiver ativamente editando o editor no momento, não sobrescrever destrutivamente
    const isActivelyEditing =
      (editor && editor.isFocused) ||
      lastEditedMarkdownRef.current !== lastPersistedMarkdownRef.current;

    if (isActivelyEditing) {
      console.warn('[NoteEditor] Edição local ativa em andamento; preservando conteúdo local contra sobrescrita remota.', {
        noteId: incoming.id,
        localVersion: persistedVersion,
        remoteVersion: incomingVersion,
      });
      lastPersistedVersionRef.current = incomingVersion;
      onRemoteUpdateHandled?.();
      return;
    }

    // 3. Aplicação remota incremental preservando a seleção do cursor via transação nativa do ProseMirror
    lastPersistedVersionRef.current = incomingVersion;
    lastPersistedUpdatedAtRef.current = incoming.updatedAt || '';
    lastPersistedMarkdownRef.current = incomingMd;
    lastEditedMarkdownRef.current = incomingMd;

    setMarkdownContent(incomingMd);
    setTags(MarkdownService.extractTags(incomingMd));

    if (editor && !editor.isDestroyed) {
      try {
        const previousSelection = editor.state.selection;
        let newJson = incoming.editorContent;
        if (typeof newJson === 'string') {
          try {
            newJson = JSON.parse(newJson);
          } catch {
            newJson = null;
          }
        }
        if (!newJson || typeof newJson !== 'object' || newJson.type !== 'doc' || !Array.isArray(newJson.content)) {
          newJson = MarkdownService.markdownToVisual(incomingMd, node.name || 'Nova nota');
        }

        const newDocNode = editor.schema.nodeFromJSON(newJson);
        if (newDocNode) {
          const { tr } = editor.state;
          tr.replaceWith(0, tr.doc.content.size, newDocNode.content);

          try {
            const mappedFrom = Math.min(Math.max(1, tr.mapping.map(previousSelection.from)), tr.doc.content.size);
            const mappedTo = Math.min(Math.max(mappedFrom, tr.mapping.map(previousSelection.to)), tr.doc.content.size);
            tr.setSelection(TextSelection.create(tr.doc, mappedFrom, mappedTo));
          } catch {
            // Mapeamento seguro
          }

          editor.view.dispatch(tr);
          console.log('[EDITOR REMOTE APPLIED WITH SELECTION MAPPING]', {
            noteId: incoming.id,
            version: incomingVersion,
          });
        }
      } catch (err) {
        console.warn('[NoteEditor] Erro ao aplicar atualização remota incremental:', err);
      }
    }

    onRemoteUpdateHandled?.();
  }, [remoteNoteUpdate, note.id, editor, node.name, onRemoteUpdateHandled]);

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
      {/* 1. Barra de Ferramentas diretamente acima da nota */}
      <EditorToolbar
        editor={editor}
        onUploadImage={handleUploadImage}
        highlightModeColor={highlightModeColor}
        onSetHighlightModeColor={setHighlightModeColor}
      />

      {/* 2. Editor Workspace Body (Nota com Título e Conteúdo) */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        <div className="p-4 sm:p-8 flex justify-center">
          {/* Paper Sheet Container (Página da Nota) */}
          <div
            id="tiptap-editor-wrapper"
            className="w-full max-w-[850px] min-h-[650px] bg-[#FFFFFF] border border-[#E3DCD2] rounded-xl shadow-xs p-6 sm:p-12 relative flex flex-col"
          >
            <DocumentTitleContext.Provider
              value={useMemo(
                () => ({
                  userId: node.userId,
                  noteId: note.id,
                  onTagClick: (tag: string) => onTagClick && onTagClick(tag),
                }),
                [node.userId, note.id, onTagClick]
              )}
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
