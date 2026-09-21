'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Editor } from '@tiptap/react';
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  Highlighter,
  ChevronDown,
  List,
  ListOrdered,
  CheckSquare,
  Quote,
  Code,
  Table as TableIcon,
  Image as ImageIcon,
  Paperclip,
  Youtube,
  Link as LinkIcon,
  Minus,
  Undo2,
  Redo2,
  Heading1,
  Heading2,
  Heading3,
  Columns,
  Rows,
  Trash2,
  Sigma,
  ListCollapse,
  Check,
} from 'lucide-react';

interface EditorToolbarProps {
  editor: Editor | null;
  onUploadAttachment?: (file: File) => Promise<void> | void;
  onUploadImage?: (file: File) => Promise<void> | void;
  highlightModeColor?: string | null;
  onSetHighlightModeColor?: (color: string | null) => void;
}

const PASTEL_COLORS = [
  { name: 'Amarelo pastel', hex: '#FFF3A6' },
  { name: 'Verde pastel', hex: '#CDECCF' },
  { name: 'Vermelho pastel', hex: '#F7C6C7' },
  { name: 'Azul pastel', hex: '#C9DDF5' },
];

export function EditorToolbar({
  editor,
  onUploadAttachment,
  onUploadImage,
  highlightModeColor,
  onSetHighlightModeColor,
}: EditorToolbarProps) {
  const [showTableMenu, setShowTableMenu] = useState(false);
  const [tableHover, setTableHover] = useState({ rows: 3, cols: 3 });
  const [showHighlightMenu, setShowHighlightMenu] = useState(false);
  const [selectedHighlightColor, setSelectedHighlightColor] = useState('#FFF3A6');
  const imageFileInputRef = useRef<HTMLInputElement>(null);
  const attachmentFileInputRef = useRef<HTMLInputElement>(null);
  const highlightMenuRef = useRef<HTMLDivElement>(null);
  const tableMenuRef = useRef<HTMLDivElement>(null);

  // Close menus on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (highlightMenuRef.current && !highlightMenuRef.current.contains(event.target as Node)) {
        setShowHighlightMenu(false);
      }
      if (tableMenuRef.current && !tableMenuRef.current.contains(event.target as Node)) {
        setShowTableMenu(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (!editor) return null;

  // Toggle highlight mode with default yellow (#FFF3A6)
  const handleToggleHighlight = () => {
    if (highlightModeColor) {
      // Exit highlight mode
      if (onSetHighlightModeColor) onSetHighlightModeColor(null);
      setShowHighlightMenu(false);
    } else {
      // Enter highlight mode with yellow default
      const color = selectedHighlightColor || '#FFF3A6';
      if (onSetHighlightModeColor) onSetHighlightModeColor(color);
      setShowHighlightMenu(true);

      // If text is already selected, apply immediately
      if (!editor.state.selection.empty) {
        editor.chain().focus().setHighlight({ color }).run();
      }
    }
  };

  const handleSelectDotColor = (colorHex: string) => {
    setSelectedHighlightColor(colorHex);
    if (onSetHighlightModeColor) onSetHighlightModeColor(colorHex);
    // If text was selected, apply immediately without losing mode
    if (!editor.state.selection.empty) {
      editor.chain().focus().setHighlight({ color: colorHex }).run();
    }
  };

  const clearHighlightMode = () => {
    if (highlightModeColor && onSetHighlightModeColor) {
      onSetHighlightModeColor(null);
    }
  };

  const setLink = () => {
    clearHighlightMode();
    const previousUrl = editor.getAttributes('link').href;
    const url = prompt('Cole o endereço do link ou digite [[Título]] para nota interna:', previousUrl);
    if (url === null) return;
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  };

  const addYoutube = () => {
    clearHighlightMode();
    const url = prompt('Cole a URL do vídeo do YouTube:');
    if (url) {
      (editor.chain().focus() as any).setYoutubeVideo({ src: url }).run();
    }
  };

  const addImage = () => {
    clearHighlightMode();
    imageFileInputRef.current?.click();
  };

  const handleImageFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && onUploadImage) {
      await onUploadImage(file);
    }
    e.target.value = '';
  };

  const addAttachment = () => {
    clearHighlightMode();
    attachmentFileInputRef.current?.click();
  };

  const handleAttachmentFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (onUploadAttachment) {
        await onUploadAttachment(file);
      } else if (onUploadImage) {
        await onUploadImage(file);
      }
    }
    e.target.value = '';
  };

  const handleSelectTableDimension = (rows: number, cols: number) => {
    editor.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run();
    setShowTableMenu(false);
  };

  const handleSelectEntireTable = () => {
    // Seleciona a tabela inteira
    (editor.chain().focus() as any).selectAll?.() || editor.chain().focus().selectParentNode().run();
    setShowTableMenu(false);
  };

  return (
    <div
      id="editor-docked-toolbar"
      className="sticky top-0 z-20 flex items-center justify-center flex-wrap gap-0.5 px-3 py-1.5 bg-[#F9F7F2]/95 backdrop-blur-md border-b border-[#E3DCD2] text-[#3D352E] text-xs select-none"
    >
      {/* 1. Undo / Redo integrados no início do grupo central */}
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          id="btn-toolbar-undo"
          title="Desfazer (Ctrl+Z)"
          disabled={!editor.can().undo()}
          onClick={() => editor.chain().focus().undo().run()}
          className="p-1.5 rounded-md hover:bg-[#E3DCD2] text-[#8C7B6E] disabled:opacity-30 transition-colors cursor-pointer"
        >
          <Undo2 className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          id="btn-toolbar-redo"
          title="Refazer (Ctrl+Y)"
          disabled={!editor.can().redo()}
          onClick={() => editor.chain().focus().redo().run()}
          className="p-1.5 rounded-md hover:bg-[#E3DCD2] text-[#8C7B6E] disabled:opacity-30 transition-colors cursor-pointer"
        >
          <Redo2 className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="w-px h-4 bg-[#E3DCD2] mx-1" />

      {/* 2. Títulos */}
      <button
        type="button"
        title="Título 1"
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        className={`p-1.5 rounded-md transition-colors cursor-pointer ${
          editor.isActive('heading', { level: 1 })
            ? 'bg-[#D9C5B2] text-[#3D352E] font-medium'
            : 'hover:bg-[#E3DCD2] text-[#8C7B6E]'
        }`}
      >
        <Heading1 className="w-3.5 h-3.5" />
      </button>

      <button
        type="button"
        title="Título 2"
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        className={`p-1.5 rounded-md transition-colors cursor-pointer ${
          editor.isActive('heading', { level: 2 })
            ? 'bg-[#D9C5B2] text-[#3D352E] font-medium'
            : 'hover:bg-[#E3DCD2] text-[#8C7B6E]'
        }`}
      >
        <Heading2 className="w-3.5 h-3.5" />
      </button>

      <button
        type="button"
        title="Título 3"
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        className={`p-1.5 rounded-md transition-colors cursor-pointer ${
          editor.isActive('heading', { level: 3 })
            ? 'bg-[#D9C5B2] text-[#3D352E] font-medium'
            : 'hover:bg-[#E3DCD2] text-[#8C7B6E]'
        }`}
      >
        <Heading3 className="w-3.5 h-3.5" />
      </button>

      <div className="w-px h-4 bg-[#E3DCD2] mx-1" />

      {/* 3. Formatação inline */}
      <button
        type="button"
        title="Negrito (Ctrl+B)"
        onClick={() => editor.chain().focus().toggleBold().run()}
        className={`p-1.5 rounded-md transition-colors cursor-pointer ${
          editor.isActive('bold')
            ? 'bg-[#D9C5B2] text-[#3D352E] font-medium'
            : 'hover:bg-[#E3DCD2] text-[#8C7B6E]'
        }`}
      >
        <Bold className="w-3.5 h-3.5" />
      </button>

      <button
        type="button"
        title="Itálico (Ctrl+I)"
        onClick={() => editor.chain().focus().toggleItalic().run()}
        className={`p-1.5 rounded-md transition-colors cursor-pointer ${
          editor.isActive('italic')
            ? 'bg-[#D9C5B2] text-[#3D352E] font-medium'
            : 'hover:bg-[#E3DCD2] text-[#8C7B6E]'
        }`}
      >
        <Italic className="w-3.5 h-3.5" />
      </button>

      <button
        type="button"
        title="Sublinhado (Ctrl+U)"
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        className={`p-1.5 rounded-md transition-colors cursor-pointer ${
          editor.isActive('underline')
            ? 'bg-[#D9C5B2] text-[#3D352E] font-medium'
            : 'hover:bg-[#E3DCD2] text-[#8C7B6E]'
        }`}
      >
        <UnderlineIcon className="w-3.5 h-3.5" />
      </button>

      <button
        type="button"
        title="Tachado"
        onClick={() => editor.chain().focus().toggleStrike().run()}
        className={`p-1.5 rounded-md transition-colors cursor-pointer ${
          editor.isActive('strike')
            ? 'bg-[#D9C5B2] text-[#3D352E] font-medium'
            : 'hover:bg-[#E3DCD2] text-[#8C7B6E]'
        }`}
      >
        <Strikethrough className="w-3.5 h-3.5" />
      </button>

      {/* 4. Destaque de Texto com Paleta Pastel (4 bolinhas, amarelo padrão, modo de seleção contínuo) */}
      <div ref={highlightMenuRef} className="relative inline-flex items-center">
        <button
          type="button"
          id="btn-toolbar-highlight"
          title={
            highlightModeColor
              ? `Modo Marcador ativo. Selecione qualquer trecho com o mouse para destacar. Clique para sair ou pressione Esc.`
              : 'Destacar texto (Marcador)'
          }
          onClick={handleToggleHighlight}
          className={`p-1.5 rounded-md transition-all cursor-pointer flex items-center gap-1 ${
            highlightModeColor
              ? 'bg-[#E3DCD2] text-[#3D352E] ring-2 ring-[#8C7B6E] font-medium shadow-2xs'
              : editor.isActive('highlight')
              ? 'bg-[#D9C5B2] text-[#3D352E]'
              : 'hover:bg-[#E3DCD2] text-[#8C7B6E]'
          }`}
        >
          <Highlighter className="w-3.5 h-3.5" />
          <span
            className="w-2 h-2 rounded-full border border-black/15 shrink-0"
            style={{ backgroundColor: highlightModeColor || selectedHighlightColor }}
          />
        </button>

        {/* Paleta compacta de 4 bolinhas logo abaixo do botão (sem nomes de cores, sem dropdown tradicional) */}
        {showHighlightMenu && (
          <div
            id="highlight-palette-dots"
            className="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 px-2 py-1.5 bg-[#FEFDFA] border border-[#E3DCD2] rounded-full shadow-lg z-30 flex items-center gap-2 animate-in fade-in zoom-in-95 duration-100"
          >
            {PASTEL_COLORS.map((color) => {
              const isActiveDot = (highlightModeColor || selectedHighlightColor) === color.hex;
              return (
                <button
                  key={color.hex}
                  type="button"
                  onMouseDown={(e) => {
                    // Evita perder foco da seleção no editor
                    e.preventDefault();
                    handleSelectDotColor(color.hex);
                  }}
                  title={color.name}
                  aria-label={color.name}
                  className={`w-4 h-4 rounded-full border border-black/15 cursor-pointer transition-transform hover:scale-125 ${
                    isActiveDot ? 'ring-2 ring-[#8C7B6E] scale-110' : ''
                  }`}
                  style={{ backgroundColor: color.hex }}
                />
              );
            })}
          </div>
        )}
      </div>

      <div className="w-px h-4 bg-[#E3DCD2] mx-1" />

      {/* 5. Listas, Checklist & Toggle List */}
      <button
        type="button"
        id="btn-toolbar-checklist"
        title="Checklist / Tarefas"
        onClick={() => {
          clearHighlightMode();
          editor.chain().focus().toggleTaskList().run();
        }}
        className={`p-1.5 rounded-md transition-colors cursor-pointer ${
          editor.isActive('taskList')
            ? 'bg-[#D9C5B2] text-[#3D352E] font-medium'
            : 'hover:bg-[#E3DCD2] text-[#8C7B6E]'
        }`}
      >
        <CheckSquare className="w-3.5 h-3.5" />
      </button>

      <button
        type="button"
        title="Lista com Marcadores"
        onClick={() => {
          clearHighlightMode();
          editor.chain().focus().toggleBulletList().run();
        }}
        className={`p-1.5 rounded-md transition-colors cursor-pointer ${
          editor.isActive('bulletList')
            ? 'bg-[#D9C5B2] text-[#3D352E] font-medium'
            : 'hover:bg-[#E3DCD2] text-[#8C7B6E]'
        }`}
      >
        <List className="w-3.5 h-3.5" />
      </button>

      <button
        type="button"
        title="Lista Numerada"
        onClick={() => {
          clearHighlightMode();
          editor.chain().focus().toggleOrderedList().run();
        }}
        className={`p-1.5 rounded-md transition-colors cursor-pointer ${
          editor.isActive('orderedList')
            ? 'bg-[#D9C5B2] text-[#3D352E] font-medium'
            : 'hover:bg-[#E3DCD2] text-[#8C7B6E]'
        }`}
      >
        <ListOrdered className="w-3.5 h-3.5" />
      </button>

      <button
        type="button"
        id="btn-toolbar-toggle-list"
        title="Lista Recolhível (Toggle List)"
        onClick={() => {
          clearHighlightMode();
          (editor.chain().focus() as any).setDetails().run();
        }}
        className={`p-1.5 rounded-md transition-colors cursor-pointer ${
          editor.isActive('details')
            ? 'bg-[#D9C5B2] text-[#3D352E] font-medium'
            : 'hover:bg-[#E3DCD2] text-[#8C7B6E]'
        }`}
      >
        <ListCollapse className="w-3.5 h-3.5" />
      </button>

      <div className="w-px h-4 bg-[#E3DCD2] mx-1" />

      {/* 6. Blocos & Links */}
      <button
        type="button"
        title="Citação"
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        className={`p-1.5 rounded-md transition-colors cursor-pointer ${
          editor.isActive('blockquote')
            ? 'bg-[#D9C5B2] text-[#3D352E] font-medium'
            : 'hover:bg-[#E3DCD2] text-[#8C7B6E]'
        }`}
      >
        <Quote className="w-3.5 h-3.5" />
      </button>

      <button
        type="button"
        title="Código / Bloco de Código"
        onClick={() => editor.chain().focus().toggleCode().run()}
        className={`p-1.5 rounded-md transition-colors cursor-pointer ${
          editor.isActive('code')
            ? 'bg-[#D9C5B2] text-[#3D352E] font-medium'
            : 'hover:bg-[#E3DCD2] text-[#8C7B6E]'
        }`}
      >
        <Code className="w-3.5 h-3.5" />
      </button>

      <button
        type="button"
        title="Adicionar Link"
        onClick={setLink}
        className={`p-1.5 rounded-md transition-colors cursor-pointer ${
          editor.isActive('link')
            ? 'bg-[#D9C5B2] text-[#3D352E] font-medium'
            : 'hover:bg-[#E3DCD2] text-[#8C7B6E]'
        }`}
      >
        <LinkIcon className="w-3.5 h-3.5" />
      </button>

      <div className="w-px h-4 bg-[#E3DCD2] mx-1" />

      {/* 7. Mídias e Tabelas */}
      {/* Tabela Dropdown com Seletor Visual 6x6 */}
      <div ref={tableMenuRef} className="relative">
        <button
          type="button"
          id="btn-toolbar-table"
          title="Tabela (Seletor 6x6)"
          onClick={() => setShowTableMenu(!showTableMenu)}
          className={`p-1.5 rounded-md transition-colors cursor-pointer ${
            editor.isActive('table') || showTableMenu
              ? 'bg-[#D9C5B2] text-[#3D352E] font-medium'
              : 'hover:bg-[#E3DCD2] text-[#8C7B6E]'
          }`}
        >
          <TableIcon className="w-3.5 h-3.5" />
        </button>

        {showTableMenu && (
          <div className="absolute top-full left-0 mt-1.5 p-2.5 bg-[#FEFDFA] border border-[#E3DCD2] rounded-lg shadow-lg z-30 flex flex-col gap-2 min-w-[180px] animate-in fade-in zoom-in-95 duration-100">
            <div className="flex items-center justify-between text-[11px] font-semibold text-[#8C7B6E] uppercase tracking-wider">
              <span>Inserir Tabela</span>
              <span className="font-mono text-[#3D352E]">
                {tableHover.rows} × {tableHover.cols}
              </span>
            </div>

            {/* Grade Interativa 6x6 */}
            <div
              className="grid grid-cols-6 gap-1 p-1 bg-[#F9F7F2] rounded-md border border-[#E3DCD2]"
              onMouseLeave={() => setTableHover({ rows: 3, cols: 3 })}
            >
              {Array.from({ length: 6 }).map((_, rIdx) =>
                Array.from({ length: 6 }).map((_, cIdx) => {
                  const isHovered = rIdx < tableHover.rows && cIdx < tableHover.cols;
                  return (
                    <div
                      key={`${rIdx}-${cIdx}`}
                      onMouseEnter={() => setTableHover({ rows: rIdx + 1, cols: cIdx + 1 })}
                      onClick={() => handleSelectTableDimension(rIdx + 1, cIdx + 1)}
                      className={`w-4 h-4 rounded-xs border transition-colors cursor-pointer ${
                        isHovered
                          ? 'bg-[#8C7B6E] border-[#796A5E]'
                          : 'bg-white border-[#E3DCD2] hover:bg-[#D9C5B2]'
                      }`}
                    />
                  );
                })
              )}
            </div>

            {editor.isActive('table') && (
              <div className="flex flex-col gap-0.5 pt-1.5 border-t border-[#E3DCD2]">
                <span className="text-[10px] font-semibold text-[#8C7B6E] uppercase px-1 py-0.5">
                  Ações da Tabela
                </span>
                <button
                  type="button"
                  onClick={() => {
                    editor.chain().focus().addRowAfter().run();
                    setShowTableMenu(false);
                  }}
                  className="flex items-center gap-1.5 px-2 py-1 text-left hover:bg-[#F9F7F2] rounded text-xs text-[#3D352E] cursor-pointer"
                >
                  <Rows className="w-3 h-3 text-[#8C7B6E]" /> + Linha
                </button>
                <button
                  type="button"
                  onClick={() => {
                    editor.chain().focus().addColumnAfter().run();
                    setShowTableMenu(false);
                  }}
                  className="flex items-center gap-1.5 px-2 py-1 text-left hover:bg-[#F9F7F2] rounded text-xs text-[#3D352E] cursor-pointer"
                >
                  <Columns className="w-3 h-3 text-[#8C7B6E]" /> + Coluna
                </button>
                <button
                  type="button"
                  onClick={handleSelectEntireTable}
                  className="flex items-center gap-1.5 px-2 py-1 text-left hover:bg-[#F9F7F2] rounded text-xs text-[#3D352E] cursor-pointer"
                >
                  <Check className="w-3 h-3 text-[#8C7B6E]" /> Selecionar Tabela Inteira
                </button>
                <button
                  type="button"
                  onClick={() => {
                    editor.chain().focus().deleteTable().run();
                    setShowTableMenu(false);
                  }}
                  className="flex items-center gap-1.5 px-2 py-1 text-left hover:bg-red-50 rounded text-xs text-red-600 cursor-pointer"
                >
                  <Trash2 className="w-3 h-3" /> Excluir Tabela Inteira
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Inserir Anexo / PDF do computador */}
      <button
        type="button"
        id="btn-insert-attachment"
        title="Inserir Anexo / PDF do Computador"
        onClick={addAttachment}
        className="p-1.5 rounded-md hover:bg-[#E3DCD2] text-[#8C7B6E] transition-colors cursor-pointer"
        aria-label="Inserir Anexo / PDF do Computador"
      >
        <Paperclip className="w-3.5 h-3.5" />
      </button>
      <input
        ref={attachmentFileInputRef}
        type="file"
        accept="application/pdf,.pdf,application/*,text/*,image/*,video/*"
        className="hidden"
        onChange={handleAttachmentFileChange}
      />

      {/* Inserir Imagem ou Vídeo do computador (sem pedir URL) */}
      <button
        type="button"
        id="btn-insert-image"
        title="Inserir Imagem ou Vídeo do Computador"
        onClick={addImage}
        className="p-1.5 rounded-md hover:bg-[#E3DCD2] text-[#8C7B6E] transition-colors cursor-pointer"
        aria-label="Inserir Imagem ou Vídeo do Computador"
      >
        <ImageIcon className="w-3.5 h-3.5" />
      </button>
      <input
        ref={imageFileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif,image/svg+xml,video/mp4,video/webm,video/quicktime"
        className="hidden"
        onChange={handleImageFileChange}
      />

      <button
        type="button"
        title="Inserir Vídeo do YouTube"
        onClick={addYoutube}
        className="p-1.5 rounded-md hover:bg-[#E3DCD2] text-[#8C7B6E] transition-colors cursor-pointer"
      >
        <Youtube className="w-3.5 h-3.5" />
      </button>

      <button
        type="button"
        title="Equação Matemática LaTeX"
        onClick={() => editor.chain().focus().setCodeBlock({ language: 'latex' }).run()}
        className="p-1.5 rounded-md hover:bg-[#E3DCD2] text-[#8C7B6E] transition-colors cursor-pointer"
      >
        <Sigma className="w-3.5 h-3.5" />
      </button>

      <button
        type="button"
        title="Linha Divisória"
        onClick={() => editor.chain().focus().setHorizontalRule().run()}
        className="p-1.5 rounded-md hover:bg-[#E3DCD2] text-[#8C7B6E] transition-colors cursor-pointer"
      >
        <Minus className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
