'use client';

import React, { useState, useRef } from 'react';
import { Editor } from '@tiptap/react';
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  Highlighter,
  AlignLeft,
  AlignCenter,
  AlignRight,
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

export function EditorToolbar({ editor, onInsertAttachment, onUploadImage }: EditorToolbarProps) {
  const [showTableMenu, setShowTableMenu] = useState(false);
  const imageFileInputRef = useRef<HTMLInputElement>(null);

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

  return (
    <div
      id="editor-docked-toolbar"
      className="sticky top-0 z-20 flex flex-wrap items-center gap-0.5 px-3 py-1.5 bg-[#F9F7F2]/95 backdrop-blur-md border-b border-[#E3DCD2] text-[#3D352E] text-xs"
    >
      {/* Headings */}
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

      {/* Formatting Marks */}
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

      <button
        type="button"
        title="Destacar Texto"
        onClick={() => editor.chain().focus().toggleHighlight({ color: '#D9C5B2' }).run()}
        className={`p-1.5 rounded-md transition-colors cursor-pointer ${
          editor.isActive('highlight')
            ? 'bg-[#D9C5B2] text-[#3D352E] font-medium'
            : 'hover:bg-[#E3DCD2] text-[#8C7B6E]'
        }`}
      >
        <Highlighter className="w-3.5 h-3.5" />
      </button>

      <div className="w-px h-4 bg-[#E3DCD2] mx-1" />

      {/* Lists & Tasks */}
      <button
        type="button"
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
        title="Bloco de Código"
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        className={`p-1.5 rounded-md transition-colors cursor-pointer ${
          editor.isActive('codeBlock')
            ? 'bg-[#D9C5B2] text-[#3D352E] font-medium'
            : 'hover:bg-[#E3DCD2] text-[#8C7B6E]'
        }`}
      >
        <Code className="w-3.5 h-3.5" />
      </button>

      <div className="w-px h-4 bg-[#E3DCD2] mx-1" />

      {/* Table controls */}
      <div className="relative">
        <button
          type="button"
          title="Tabela"
          onClick={() => {
            if (!editor.isActive('table')) {
              editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
            } else {
              setShowTableMenu(!showTableMenu);
            }
          }}
          className={`p-1.5 rounded-md transition-colors cursor-pointer ${
            editor.isActive('table')
              ? 'bg-[#D9C5B2] text-[#3D352E] font-medium'
              : 'hover:bg-[#E3DCD2] text-[#8C7B6E]'
          }`}
        >
          <TableIcon className="w-3.5 h-3.5" />
        </button>

        {showTableMenu && editor.isActive('table') && (
          <div className="absolute top-full left-0 mt-1 z-30 w-44 bg-[#FEFDFA] border border-[#E3DCD2] rounded-lg shadow-lg py-1 text-xs">
            <button
              onClick={() => {
                editor.chain().focus().addRowAfter().run();
                setShowTableMenu(false);
              }}
              className="w-full text-left px-3 py-1.5 hover:bg-[#E3DCD2] flex items-center gap-2 cursor-pointer text-[#3D352E]"
            >
              <Rows className="w-3 h-3 text-[#8C7B6E]" /> Adicionar Linha
            </button>
            <button
              onClick={() => {
                editor.chain().focus().addColumnAfter().run();
                setShowTableMenu(false);
              }}
              className="w-full text-left px-3 py-1.5 hover:bg-[#E3DCD2] flex items-center gap-2 cursor-pointer text-[#3D352E]"
            >
              <Columns className="w-3 h-3 text-[#8C7B6E]" /> Adicionar Coluna
            </button>
            <button
              onClick={() => {
                editor.chain().focus().deleteRow().run();
                setShowTableMenu(false);
              }}
              className="w-full text-left px-3 py-1.5 hover:bg-red-50 flex items-center gap-2 text-red-600 cursor-pointer"
            >
              <Trash2 className="w-3 h-3" /> Excluir Linha
            </button>
            <button
              onClick={() => {
                editor.chain().focus().deleteColumn().run();
                setShowTableMenu(false);
              }}
              className="w-full text-left px-3 py-1.5 hover:bg-red-50 flex items-center gap-2 text-red-600 cursor-pointer"
            >
              <Trash2 className="w-3 h-3" /> Excluir Coluna
            </button>
            <button
              onClick={() => {
                editor.chain().focus().deleteTable().run();
                setShowTableMenu(false);
              }}
              className="w-full text-left px-3 py-1.5 hover:bg-red-50 flex items-center gap-2 text-red-600 border-t border-[#E3DCD2] cursor-pointer"
            >
              <Trash2 className="w-3 h-3" /> Remover Tabela
            </button>
          </div>
        )}
      </div>

      {/* Media & Embeds */}
      <button
        type="button"
        title="Inserir Link"
        onClick={setLink}
        className={`p-1.5 rounded-md transition-colors cursor-pointer ${
          editor.isActive('link')
            ? 'bg-[#D9C5B2] text-[#3D352E] font-medium'
            : 'hover:bg-[#E3DCD2] text-[#8C7B6E]'
        }`}
      >
        <LinkIcon className="w-3.5 h-3.5" />
      </button>

      {/* Inserir Imagem do computador */}
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

      <div className="flex-1" />

      {/* Undo / Redo */}
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          title="Desfazer (Ctrl+Z)"
          disabled={!editor.can().undo()}
          onClick={() => editor.chain().focus().undo().run()}
          className="p-1.5 rounded-md hover:bg-[#E3DCD2] text-[#8C7B6E] disabled:opacity-30 transition-colors cursor-pointer"
        >
          <Undo2 className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          title="Refazer (Ctrl+Y)"
          disabled={!editor.can().redo()}
          onClick={() => editor.chain().focus().redo().run()}
          className="p-1.5 rounded-md hover:bg-[#E3DCD2] text-[#8C7B6E] disabled:opacity-30 transition-colors cursor-pointer"
        >
          <Redo2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
