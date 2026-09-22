'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Editor } from '@tiptap/react';
import {
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  CheckSquare,
  Quote,
  Code,
  Table as TableIcon,
  Image as ImageIcon,
  Youtube,
  Sigma,
  Minus,
  Type,
  ListCollapse,
} from 'lucide-react';

interface SlashCommandMenuProps {
  editor: Editor | null;
  isOpen: boolean;
  onClose: () => void;
  position: { top: number; left: number };
  onTriggerImageUpload?: () => void;
  externalQuery?: string;
  slashStartPos?: number;
}

interface CommandItem {
  id: string;
  title: string;
  description: string;
  keywords?: string[];
  icon: React.ComponentType<{ className?: string }>;
  action: (editor: Editor) => void;
}

export function SlashCommandMenu({
  editor,
  isOpen,
  onClose,
  position,
  onTriggerImageUpload,
  externalQuery,
  slashStartPos,
}: SlashCommandMenuProps) {
  const [internalQuery, setInternalQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const query = externalQuery !== undefined && externalQuery !== '' ? externalQuery : internalQuery;

  const handleClose = React.useCallback(() => {
    setInternalQuery('');
    setSelectedIndex(0);
    onClose();
  }, [onClose]);

  const commands: CommandItem[] = [
    {
      id: 'paragraph',
      title: 'Texto / Parágrafo',
      description: 'Comece a escrever com texto normal',
      keywords: ['texto', 'paragrafo', 'p', 'normal'],
      icon: Type,
      action: (ed) => ed.chain().focus().setParagraph().run(),
    },
    {
      id: 'heading-1',
      title: 'Título 1',
      description: 'Seção principal com destaque',
      keywords: ['h1', 'titulo', 'header', 'grande'],
      icon: Heading1,
      action: (ed) => ed.chain().focus().toggleHeading({ level: 1 }).run(),
    },
    {
      id: 'heading-2',
      title: 'Título 2',
      description: 'Subseção média',
      keywords: ['h2', 'subtitulo', 'medio'],
      icon: Heading2,
      action: (ed) => ed.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      id: 'heading-3',
      title: 'Título 3',
      description: 'Subtítulo pequeno',
      keywords: ['h3', 'subtitulo', 'pequeno'],
      icon: Heading3,
      action: (ed) => ed.chain().focus().toggleHeading({ level: 3 }).run(),
    },
    {
      id: 'toggle-list',
      title: 'Lista Recolhível / Toggle',
      description: 'Crie um bloco expansível para ocultar e exibir conteúdo (/toggle)',
      keywords: ['toggle', 'toggle-list', 'detalhes', 'details', 'recolhivel', 'expansivel', 'dropdown', 'colapsar', 'acordeao'],
      icon: ListCollapse,
      action: (ed) => (ed.chain().focus() as any).setDetails().run(),
    },
    {
      id: 'task-list',
      title: 'Checklist / Tarefas',
      description: 'Acompanhe itens a fazer',
      keywords: ['todo', 'task', 'checklist', 'tarefa', 'afazer'],
      icon: CheckSquare,
      action: (ed) => ed.chain().focus().toggleTaskList().run(),
    },
    {
      id: 'bullet-list',
      title: 'Lista com Marcadores',
      description: 'Crie uma lista simples de itens',
      keywords: ['bullet', 'lista', 'pontos', 'marcador', 'ul'],
      icon: List,
      action: (ed) => ed.chain().focus().toggleBulletList().run(),
    },
    {
      id: 'ordered-list',
      title: 'Lista Numerada',
      description: 'Crie uma lista em ordem sequencial',
      keywords: ['numero', 'ordem', 'ordenada', 'sequencia', 'ol', '1.'],
      icon: ListOrdered,
      action: (ed) => ed.chain().focus().toggleOrderedList().run(),
    },
    {
      id: 'blockquote',
      title: 'Citação',
      description: 'Destaque uma citação ou reflexão',
      keywords: ['quote', 'citacao', 'frase'],
      icon: Quote,
      action: (ed) => ed.chain().focus().toggleBlockquote().run(),
    },
    {
      id: 'code-block',
      title: 'Bloco de Código',
      description: 'Trecho de código com fonte monoespaçada',
      keywords: ['codigo', 'code', 'javascript', 'typescript', 'python', 'pre'],
      icon: Code,
      action: (ed) => ed.chain().focus().toggleCodeBlock().run(),
    },
    {
      id: 'table',
      title: 'Tabela',
      description: 'Insira uma tabela com linhas e colunas',
      keywords: ['tabela', 'grid', 'table', 'planilha'],
      icon: TableIcon,
      action: (ed) => ed.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
    },
    {
      id: 'youtube',
      title: 'Vídeo do YouTube',
      description: 'Incorpore um player de vídeo',
      keywords: ['youtube', 'video', 'player', 'midia'],
      icon: Youtube,
      action: (ed) => {
        const url = prompt('Cole a URL do vídeo do YouTube:');
        if (url) {
          (ed.chain().focus() as any).setYoutubeVideo({ src: url }).run();
        }
      },
    },
    {
      id: 'image',
      title: 'Inserir Imagem',
      description: 'Insira uma imagem do computador',
      keywords: ['imagem', 'foto', 'picture', 'upload', 'figura'],
      icon: ImageIcon,
      action: (ed) => {
        if (onTriggerImageUpload) {
          onTriggerImageUpload();
        } else {
          const url = prompt('Cole a URL da imagem:');
          if (url) {
            ed.chain().focus().insertContent({ type: 'image', attrs: { src: url } }).run();
          }
        }
      },
    },
    {
      id: 'math-block',
      title: 'Equação LaTeX',
      description: 'Insira equação matemática',
      keywords: ['math', 'latex', 'formula', 'equacao', 'sigma'],
      icon: Sigma,
      action: (ed) => {
        ed.chain().focus().setCodeBlock({ language: 'latex' }).run();
      },
    },
    {
      id: 'divider',
      title: 'Linha Divisória',
      description: 'Separe seções visualmente',
      keywords: ['linha', 'divisor', 'separador', 'hr', 'divider'],
      icon: Minus,
      action: (ed) => ed.chain().focus().setHorizontalRule().run(),
    },
  ];

  const cleanQuery = query.trim().toLowerCase().replace(/^\//, '');

  const filtered = commands.filter((c) =>
    c.title.toLowerCase().includes(cleanQuery) ||
    c.description.toLowerCase().includes(cleanQuery) ||
    (c.keywords && c.keywords.some((k) => k.toLowerCase().includes(cleanQuery)))
  );

  const executeCommand = React.useCallback(
    (item: CommandItem) => {
      if (editor) {
        const { state } = editor;
        const { $from } = state.selection;
        // Se houver posição de início do slash ou caractere anterior for '/', remove antes de inserir o bloco
        const slashPos =
          slashStartPos !== undefined && slashStartPos >= 0
            ? slashStartPos
            : state.doc.textBetween(Math.max(0, $from.pos - 1), $from.pos) === '/'
            ? $from.pos - 1
            : null;

        if (slashPos !== null && slashPos >= 0 && slashPos < $from.pos) {
          editor.chain().deleteRange({ from: slashPos, to: $from.pos }).run();
        }
        item.action(editor);
        handleClose();
      }
    },
    [editor, slashStartPos, handleClose]
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % (filtered.length || 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + filtered.length) % (filtered.length || 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (filtered[selectedIndex]) {
          executeCommand(filtered[selectedIndex]);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        handleClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, filtered, selectedIndex, executeCommand, handleClose]);

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={handleClose} />
      <div
        ref={containerRef}
        style={{
          top: `${position.top}px`,
          left: `${position.left}px`,
        }}
        className="fixed z-50 w-72 max-h-80 overflow-y-auto bg-[#FEFDFA] border border-[#E3DCD2] rounded-xl shadow-2xl p-1.5 custom-scrollbar text-[#3D352E] animate-in fade-in zoom-in-95 duration-100"
      >
        <div className="px-2 py-1.5 mb-1 border-b border-[#E3DCD2]">
          <input
            type="text"
            value={query}
            onChange={(e) => {
              setInternalQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key === ' ' && !query.trim()) {
                e.preventDefault();
                handleClose();
                if (editor) {
                  editor.chain().focus().insertContent(' ').run();
                }
              }
            }}
            placeholder="Filtrar blocos..."
            className="w-full bg-transparent text-xs outline-none placeholder:text-[#8C7B6E]/60 text-[#3D352E]"
          />
        </div>

        <div className="space-y-0.5">
          {filtered.length === 0 ? (
            <div className="px-3 py-4 text-xs text-center text-[#8C7B6E]/70 italic">
              Nenhum bloco encontrado
            </div>
          ) : (
            filtered.map((item, idx) => {
              const Icon = item.icon;
              const isSelected = idx === selectedIndex;
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    if (editor) {
                      item.action(editor);
                      onClose();
                    }
                  }}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={`w-full text-left px-2.5 py-2 rounded-lg flex items-center gap-2.5 transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-[#D9C5B2] text-[#3D352E]'
                      : 'hover:bg-[#E3DCD2] text-[#3D352E]'
                  }`}
                >
                  <div
                    className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 ${
                      isSelected
                        ? 'bg-[#8C7B6E] text-[#F9F7F2]'
                        : 'bg-[#E3DCD2] text-[#8C7B6E]'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="truncate">
                    <div className="text-xs font-medium leading-tight truncate">{item.title}</div>
                    <div className="text-[10px] text-[#8C7B6E] leading-tight truncate">{item.description}</div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}
