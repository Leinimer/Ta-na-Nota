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
} from 'lucide-react';

interface EditorToolbarProps {
  editor: Editor | null;
  onInsertAttachment?: () => void;
  onUploadImage?: (file: File) => Promise<void> | void;
}

const PASTEL_COLORS = [
  { name: 'Amarelo pastel', hex: '#FFF3A6' },
  { name: 'Verde pastel', hex: '#CDECCF' },
  { name: 'Vermelho pastel', hex: '#F7C6C7' },
  { name: 'Azul pastel', hex: '#C9DDF5' },
];

export function EditorToolbar({ editor, onUploadImage }: EditorToolbarProps) {
  const [showTableMenu, setShowTableMenu] = useState(false);
  const [showHighlightMenu, setShowHighlightMenu] = useState(false);
  const [selectedHighlightColor, setSelectedHighlightColor] = useState('#FFF3A6');
  const imageFileInputRef = useRef<HTMLInputElement>(null);
  const highlightMenuRef = useRef<HTMLDivElement>(null);

  // Close highlight dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (highlightMenuRef.current && !highlightMenuRef.current.contains(event.target as Node)) {
        setShowHighlightMenu(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (!editor) return null;

  const setLink = () => {
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
    const url = prompt('Cole a URL do vídeo do YouTube:');
    if (url) {
      (editor.chain().focus() as any).setYoutubeVideo({ src: url }).run();
    }
  };

  // Abre diretamente o seletor de arquivos do computador (sem pedir URL)
  const addImage = () => {
    imageFileInputRef.current?.click();
  };

  const handleImageFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && onUploadImage) {
      await onUploadImage(file);
    }
    e.target.value = '';
  };

  // Toggle highlight with currently selected pastel color (default: #FFF3A6)
  const applyCurrentHighlight = () => {
    if (editor.isActive('highlight', { color: selectedHighlightColor })) {
      editor.chain().focus().unsetHighlight().run();
    } else {
      editor.chain().focus().toggleHighlight({ color: selectedHighlightColor }).run();
    }
  };

  const selectColorAndApply = (colorHex: string) => {
    setSelectedHighlightColor(colorHex);
    setShowHighlightMenu(false);
    editor.chain().focus().setHighlight({ color: colorHex }).run();
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

      {/* 4. Destaque de Texto com 4 Cores Pastel & Amarelo (#FFF3A6) como Padrão */}
      <div ref={highlightMenuRef} className="relative inline-flex items-center">
        <div
          className={`flex items-center rounded-md transition-colors ${
            editor.isActive('highlight')
              ? 'bg-[#D9C5B2] text-[#3D352E]'
              : 'hover:bg-[#E3DCD2] text-[#8C7B6E]'
          }`}
        >
          <button
            type="button"
            id="btn-toolbar-highlight"
            title={`Destacar texto (${PASTEL_COLORS.find((c) => c.hex === selectedHighlightColor)?.name || 'Amarelo pastel'})`}
            onClick={applyCurrentHighlight}
            className="p-1.5 rounded-l-md transition-colors cursor-pointer flex items-center"
          >
            <Highlighter className="w-3.5 h-3.5" />
            <span
              className="w-2 h-2 rounded-full ml-1 border border-black/10"
              style={{ backgroundColor: selectedHighlightColor }}
            />
          </button>
          <button
            type="button"
            id="btn-toolbar-highlight-palette"
            title="Escolher cor de destaque"
            onClick={() => setShowHighlightMenu((prev) => !prev)}
            className="p-1 pr-1.5 rounded-r-md hover:bg-black/5 cursor-pointer text-[#8C7B6E]"
          >
            <ChevronDown className="w-3 h-3" />
          </button>
        </div>

        {showHighlightMenu && (
          <div className="absolute top-full left-0 mt-1 p-2 bg-[#FEFDFA] border border-[#E3DCD2] rounded-lg shadow-lg z-30 flex flex-col gap-1.5 min-w-[140px]">
            <div className="text-[10px] uppercase font-semibold text-[#8C7B6E] px-1 pb-1 border-b border-[#E3DCD2]/60">
              Cores Pastel
            </div>
            {PASTEL_COLORS.map((color) => (
              <button
                key={color.hex}
                type="button"
                onClick={() => selectColorAndApply(color.hex)}
                className={`flex items-center gap-2 px-2 py-1 rounded text-xs text-[#3D352E] hover:bg-[#F9F7F2] cursor-pointer transition-colors text-left ${
                  selectedHighlightColor === color.hex ? 'bg-[#E3DCD2]/50 font-medium' : ''
                }`}
              >
                <span
                  className="w-4 h-4 rounded-full border border-black/10 shrink-0"
                  style={{ backgroundColor: color.hex }}
                />
                <span className="truncate">{color.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="w-px h-4 bg-[#E3DCD2] mx-1" />

      {/* 5. Listas e Checklist */}
      <button
        type="button"
        id="btn-toolbar-checklist"
        title="Checklist / Tarefas"
        onClick={() => editor.chain().focus().toggleTaskList().run()}
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
        onClick={() => editor.chain().focus().toggleBulletList().run()}
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
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        className={`p-1.5 rounded-md transition-colors cursor-pointer ${
          editor.isActive('orderedList')
            ? 'bg-[#D9C5B2] text-[#3D352E] font-medium'
            : 'hover:bg-[#E3DCD2] text-[#8C7B6E]'
        }`}
      >
        <ListOrdered className="w-3.5 h-3.5" />
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
      {/* Tabela Dropdown */}
      <div className="relative">
        <button
          type="button"
          title="Tabela"
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
          <div className="absolute top-full left-0 mt-1 p-1 bg-[#FEFDFA] border border-[#E3DCD2] rounded-lg shadow-md z-30 flex flex-col gap-1 min-w-[150px]">
            <button
              type="button"
              onClick={() => {
                editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
                setShowTableMenu(false);
              }}
              className="px-2 py-1 text-left hover:bg-[#F9F7F2] rounded text-xs text-[#3D352E] cursor-pointer"
            >
              Inserir Tabela 3x3
            </button>
            {editor.isActive('table') && (
              <>
                <div className="h-px bg-[#E3DCD2] my-0.5" />
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
                    editor.chain().focus().deleteTable().run();
                    setShowTableMenu(false);
                  }}
                  className="flex items-center gap-1.5 px-2 py-1 text-left hover:bg-red-50 rounded text-xs text-red-600 cursor-pointer"
                >
                  <Trash2 className="w-3 h-3" /> Excluir Tabela
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Inserir Imagem do computador (sem pedir URL) */}
      <button
        type="button"
        id="btn-insert-image"
        title="Inserir Imagem do Computador"
        onClick={addImage}
        className="p-1.5 rounded-md hover:bg-[#E3DCD2] text-[#8C7B6E] transition-colors cursor-pointer"
        aria-label="Inserir Imagem do Computador"
      >
        <ImageIcon className="w-3.5 h-3.5" />
      </button>
      <input
        ref={imageFileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif,image/svg+xml"
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
