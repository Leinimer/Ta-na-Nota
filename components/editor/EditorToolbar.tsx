'use client';

import React, { useState } from 'react';
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
}

export function EditorToolbar({ editor, onInsertAttachment }: EditorToolbarProps) {
  const [showTableMenu, setShowTableMenu] = useState(false);

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

  const addImage = () => {
    const url = prompt('Cole a URL da imagem:');
    if (url) {
      editor.chain().focus().setImage({ src: url }).run();
    }
  };

  return (
    <div
      id="editor-docked-toolbar"
      className="sticky top-0 z-20 flex flex-wrap items-center gap-0.5 px-3 py-1.5 bg-[#fbf9f4]/95 dark:bg-[#191816]/95 backdrop-blur-md border-b border-[#eae8e3] dark:border-[#2f2d29] text-[#1b1c19] dark:text-[#f2f1ec] text-xs"
    >
      {/* Headings */}
      <button
        type="button"
        title="Título 1"
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        className={`p-1.5 rounded-md transition-colors ${
          editor.isActive('heading', { level: 1 })
            ? 'bg-[#68594d] text-white'
            : 'hover:bg-[#eae8e3] dark:hover:bg-[#2c2a26] text-[#7f756e]'
        }`}
      >
        <Heading1 className="w-3.5 h-3.5" />
      </button>

      <button
        type="button"
        title="Título 2"
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        className={`p-1.5 rounded-md transition-colors ${
          editor.isActive('heading', { level: 2 })
            ? 'bg-[#68594d] text-white'
            : 'hover:bg-[#eae8e3] dark:hover:bg-[#2c2a26] text-[#7f756e]'
        }`}
      >
        <Heading2 className="w-3.5 h-3.5" />
      </button>

      <button
        type="button"
        title="Título 3"
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        className={`p-1.5 rounded-md transition-colors ${
          editor.isActive('heading', { level: 3 })
            ? 'bg-[#68594d] text-white'
            : 'hover:bg-[#eae8e3] dark:hover:bg-[#2c2a26] text-[#7f756e]'
        }`}
      >
        <Heading3 className="w-3.5 h-3.5" />
      </button>

      <div className="w-px h-4 bg-[#d1c4bc] dark:bg-[#44403a] mx-1" />

      {/* Formatting Marks */}
      <button
        type="button"
        title="Negrito (Ctrl+B)"
        onClick={() => editor.chain().focus().toggleBold().run()}
        className={`p-1.5 rounded-md transition-colors ${
          editor.isActive('bold')
            ? 'bg-[#68594d] text-white'
            : 'hover:bg-[#eae8e3] dark:hover:bg-[#2c2a26] text-[#7f756e]'
        }`}
      >
        <Bold className="w-3.5 h-3.5" />
      </button>

      <button
        type="button"
        title="Itálico (Ctrl+I)"
        onClick={() => editor.chain().focus().toggleItalic().run()}
        className={`p-1.5 rounded-md transition-colors ${
          editor.isActive('italic')
            ? 'bg-[#68594d] text-white'
            : 'hover:bg-[#eae8e3] dark:hover:bg-[#2c2a26] text-[#7f756e]'
        }`}
      >
        <Italic className="w-3.5 h-3.5" />
      </button>

      <button
        type="button"
        title="Sublinhado (Ctrl+U)"
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        className={`p-1.5 rounded-md transition-colors ${
          editor.isActive('underline')
            ? 'bg-[#68594d] text-white'
            : 'hover:bg-[#eae8e3] dark:hover:bg-[#2c2a26] text-[#7f756e]'
        }`}
      >
        <UnderlineIcon className="w-3.5 h-3.5" />
      </button>

      <button
        type="button"
        title="Tachado"
        onClick={() => editor.chain().focus().toggleStrike().run()}
        className={`p-1.5 rounded-md transition-colors ${
          editor.isActive('strike')
            ? 'bg-[#68594d] text-white'
            : 'hover:bg-[#eae8e3] dark:hover:bg-[#2c2a26] text-[#7f756e]'
        }`}
      >
        <Strikethrough className="w-3.5 h-3.5" />
      </button>

      <button
        type="button"
        title="Destacar Texto"
        onClick={() => editor.chain().focus().toggleHighlight({ color: '#ffe699' }).run()}
        className={`p-1.5 rounded-md transition-colors ${
          editor.isActive('highlight')
            ? 'bg-amber-400 text-amber-950'
            : 'hover:bg-[#eae8e3] dark:hover:bg-[#2c2a26] text-[#7f756e]'
        }`}
      >
        <Highlighter className="w-3.5 h-3.5" />
      </button>

      <div className="w-px h-4 bg-[#d1c4bc] dark:bg-[#44403a] mx-1" />

      {/* Lists & Tasks */}
      <button
        type="button"
        title="Checklist / Tarefas"
        onClick={() => editor.chain().focus().toggleTaskList().run()}
        className={`p-1.5 rounded-md transition-colors ${
          editor.isActive('taskList')
            ? 'bg-[#68594d] text-white'
            : 'hover:bg-[#eae8e3] dark:hover:bg-[#2c2a26] text-[#7f756e]'
        }`}
      >
        <CheckSquare className="w-3.5 h-3.5" />
      </button>

      <button
        type="button"
        title="Lista com Marcadores"
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        className={`p-1.5 rounded-md transition-colors ${
          editor.isActive('bulletList')
            ? 'bg-[#68594d] text-white'
            : 'hover:bg-[#eae8e3] dark:hover:bg-[#2c2a26] text-[#7f756e]'
        }`}
      >
        <List className="w-3.5 h-3.5" />
      </button>

      <button
        type="button"
        title="Lista Numerada"
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        className={`p-1.5 rounded-md transition-colors ${
          editor.isActive('orderedList')
            ? 'bg-[#68594d] text-white'
            : 'hover:bg-[#eae8e3] dark:hover:bg-[#2c2a26] text-[#7f756e]'
        }`}
      >
        <ListOrdered className="w-3.5 h-3.5" />
      </button>

      <button
        type="button"
        title="Citação"
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        className={`p-1.5 rounded-md transition-colors ${
          editor.isActive('blockquote')
            ? 'bg-[#68594d] text-white'
            : 'hover:bg-[#eae8e3] dark:hover:bg-[#2c2a26] text-[#7f756e]'
        }`}
      >
        <Quote className="w-3.5 h-3.5" />
      </button>

      <button
        type="button"
        title="Bloco de Código"
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        className={`p-1.5 rounded-md transition-colors ${
          editor.isActive('codeBlock')
            ? 'bg-[#68594d] text-white'
            : 'hover:bg-[#eae8e3] dark:hover:bg-[#2c2a26] text-[#7f756e]'
        }`}
      >
        <Code className="w-3.5 h-3.5" />
      </button>

      <div className="w-px h-4 bg-[#d1c4bc] dark:bg-[#44403a] mx-1" />

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
          className={`p-1.5 rounded-md transition-colors ${
            editor.isActive('table')
              ? 'bg-[#f4dfcb] dark:bg-[#3c3328] text-[#68594d] dark:text-[#d7c3b4]'
              : 'hover:bg-[#eae8e3] dark:hover:bg-[#2c2a26] text-[#7f756e]'
          }`}
        >
          <TableIcon className="w-3.5 h-3.5" />
        </button>

        {showTableMenu && editor.isActive('table') && (
          <div className="absolute top-full left-0 mt-1 z-30 w-44 bg-[#ffffff] dark:bg-[#23221e] border border-[#d1c4bc] dark:border-[#44403a] rounded-lg shadow-lg py-1 text-xs">
            <button
              onClick={() => {
                editor.chain().focus().addRowAfter().run();
                setShowTableMenu(false);
              }}
              className="w-full text-left px-3 py-1.5 hover:bg-[#f5f3ee] dark:hover:bg-[#2c2a26] flex items-center gap-2"
            >
              <Rows className="w-3 h-3" /> Adicionar Linha
            </button>
            <button
              onClick={() => {
                editor.chain().focus().addColumnAfter().run();
                setShowTableMenu(false);
              }}
              className="w-full text-left px-3 py-1.5 hover:bg-[#f5f3ee] dark:hover:bg-[#2c2a26] flex items-center gap-2"
            >
              <Columns className="w-3 h-3" /> Adicionar Coluna
            </button>
            <button
              onClick={() => {
                editor.chain().focus().deleteRow().run();
                setShowTableMenu(false);
              }}
              className="w-full text-left px-3 py-1.5 hover:bg-[#f5f3ee] dark:hover:bg-[#2c2a26] flex items-center gap-2 text-red-600"
            >
              <Trash2 className="w-3 h-3" /> Excluir Linha
            </button>
            <button
              onClick={() => {
                editor.chain().focus().deleteColumn().run();
                setShowTableMenu(false);
              }}
              className="w-full text-left px-3 py-1.5 hover:bg-[#f5f3ee] dark:hover:bg-[#2c2a26] flex items-center gap-2 text-red-600"
            >
              <Trash2 className="w-3 h-3" /> Excluir Coluna
            </button>
            <button
              onClick={() => {
                editor.chain().focus().deleteTable().run();
                setShowTableMenu(false);
              }}
              className="w-full text-left px-3 py-1.5 hover:bg-[#f5f3ee] dark:hover:bg-[#2c2a26] flex items-center gap-2 text-red-600 border-t border-[#eae8e3] dark:border-[#2f2d29]"
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
        className={`p-1.5 rounded-md transition-colors ${
          editor.isActive('link')
            ? 'bg-[#68594d] text-white'
            : 'hover:bg-[#eae8e3] dark:hover:bg-[#2c2a26] text-[#7f756e]'
        }`}
      >
        <LinkIcon className="w-3.5 h-3.5" />
      </button>

      <button
        type="button"
        title="Inserir Imagem por URL"
        onClick={addImage}
        className="p-1.5 rounded-md hover:bg-[#eae8e3] dark:hover:bg-[#2c2a26] text-[#7f756e] transition-colors"
      >
        <ImageIcon className="w-3.5 h-3.5" />
      </button>

      <button
        type="button"
        title="Inserir Vídeo do YouTube"
        onClick={addYoutube}
        className="p-1.5 rounded-md hover:bg-[#eae8e3] dark:hover:bg-[#2c2a26] text-[#7f756e] transition-colors"
      >
        <Youtube className="w-3.5 h-3.5" />
      </button>

      <button
        type="button"
        title="Equação Matemática LaTeX"
        onClick={() => editor.chain().focus().setCodeBlock({ language: 'latex' }).run()}
        className="p-1.5 rounded-md hover:bg-[#eae8e3] dark:hover:bg-[#2c2a26] text-[#7f756e] transition-colors"
      >
        <Sigma className="w-3.5 h-3.5" />
      </button>

      <button
        type="button"
        title="Linha Divisória"
        onClick={() => editor.chain().focus().setHorizontalRule().run()}
        className="p-1.5 rounded-md hover:bg-[#eae8e3] dark:hover:bg-[#2c2a26] text-[#7f756e] transition-colors"
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
          className="p-1.5 rounded-md hover:bg-[#eae8e3] dark:hover:bg-[#2c2a26] text-[#7f756e] disabled:opacity-30 transition-colors"
        >
          <Undo2 className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          title="Refazer (Ctrl+Y)"
          disabled={!editor.can().redo()}
          onClick={() => editor.chain().focus().redo().run()}
          className="p-1.5 rounded-md hover:bg-[#eae8e3] dark:hover:bg-[#2c2a26] text-[#7f756e] disabled:opacity-30 transition-colors"
        >
          <Redo2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
