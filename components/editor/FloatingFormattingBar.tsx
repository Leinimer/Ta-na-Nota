'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Editor } from '@tiptap/react';
import { TextSelection } from '@tiptap/pm/state';
import { Bold, Italic, Underline as UnderlineIcon, Highlighter } from 'lucide-react';
import { PASTEL_HIGHLIGHT_COLORS } from './EditorToolbar';

interface FloatingFormattingBarProps {
  editor: Editor | null;
  isContinuousHighlightActive: boolean;
}

export function FloatingFormattingBar({
  editor,
  isContinuousHighlightActive,
}: FloatingFormattingBarProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [showColorPicker, setShowColorPicker] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!editor) return;

    const updatePosition = () => {
      // 1. Se modo contínuo estiver ativo, prioridade absoluta: não exibir barra flutuante
      if (isContinuousHighlightActive) {
        setIsVisible(false);
        setShowColorPicker(false);
        return;
      }

      const { state, view } = editor;
      const { selection } = state;

      // 2. Não exibir se seleção estiver vazia ou se não for seleção de texto normal
      // (ignora nós inteiros como imagem, vídeo, tabela, toggle, etc.)
      if (!selection || selection.empty || !(selection instanceof TextSelection)) {
        setIsVisible(false);
        setShowColorPicker(false);
        return;
      }

      // 3. Verificar se há texto selecionado válido
      const selectedText = state.doc.textBetween(selection.from, selection.to, ' ');
      if (!selectedText || !selectedText.trim()) {
        setIsVisible(false);
        setShowColorPicker(false);
        return;
      }

      // 4. Calcular coordenadas na tela da seleção
      try {
        const start = view.coordsAtPos(selection.from);
        const end = view.coordsAtPos(selection.to);

        const centerX = (start.left + end.right) / 2;
        const topY = Math.min(start.top, end.top);

        const barWidth = 165;
        const barHeight = 40;

        let left = centerX - barWidth / 2;
        let top = topY - barHeight - 8;

        // Se estiver muito próximo ao topo da janela, posiciona logo abaixo da seleção
        if (top < 55) {
          top = Math.max(start.bottom, end.bottom) + 8;
        }

        // Clamp horizontal para viewport e mobile
        if (left < 10) left = 10;
        if (left + barWidth > window.innerWidth - 10) {
          left = window.innerWidth - barWidth - 10;
        }

        setPosition({ top, left });
        setIsVisible(true);
      } catch {
        setIsVisible(false);
      }
    };

    editor.on('selectionUpdate', updatePosition);
    editor.on('transaction', updatePosition);
    editor.on('blur', () => {
      // Pequeno timeout para permitir cliques nos botões da própria barra
      setTimeout(() => {
        if (
          barRef.current &&
          document.activeElement &&
          barRef.current.contains(document.activeElement)
        ) {
          return;
        }
        setIsVisible(false);
        setShowColorPicker(false);
      }, 150);
    });

    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);

    return () => {
      editor.off('selectionUpdate', updatePosition);
      editor.off('transaction', updatePosition);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [editor, isContinuousHighlightActive]);

  if (!editor || !isVisible) return null;

  const handleApplyHighlight = (hex: string) => {
    // Aplicação pontual sem ativar o modo contínuo da Toolbar
    editor.chain().focus().setHighlight({ color: hex }).run();
    setShowColorPicker(false);
  };

  return (
    <div
      ref={barRef}
      style={{
        position: 'fixed',
        top: `${position.top}px`,
        left: `${position.left}px`,
        zIndex: 50,
      }}
      className="flex flex-col items-center select-none animate-in fade-in zoom-in-95 duration-100"
    >
      {/* Barra principal de formatação flutuante */}
      <div className="flex items-center gap-0.5 px-1.5 py-1 bg-[#FEFDFA] border border-[#D9C5B2] rounded-lg shadow-lg text-[#3D352E]">
        {/* Negrito */}
        <button
          type="button"
          title="Negrito (Ctrl+B)"
          onMouseDown={(e) => {
            e.preventDefault();
            editor.chain().focus().toggleBold().run();
          }}
          className={`p-1.5 rounded transition-colors cursor-pointer ${
            editor.isActive('bold')
              ? 'bg-[#D9C5B2] text-[#3D352E] font-bold'
              : 'hover:bg-[#E3DCD2] text-[#8C7B6E]'
          }`}
        >
          <Bold className="w-3.5 h-3.5" />
        </button>

        {/* Itálico */}
        <button
          type="button"
          title="Itálico (Ctrl+I)"
          onMouseDown={(e) => {
            e.preventDefault();
            editor.chain().focus().toggleItalic().run();
          }}
          className={`p-1.5 rounded transition-colors cursor-pointer ${
            editor.isActive('italic')
              ? 'bg-[#D9C5B2] text-[#3D352E] font-bold'
              : 'hover:bg-[#E3DCD2] text-[#8C7B6E]'
          }`}
        >
          <Italic className="w-3.5 h-3.5" />
        </button>

        {/* Sublinhado */}
        <button
          type="button"
          title="Sublinhado (Ctrl+U)"
          onMouseDown={(e) => {
            e.preventDefault();
            editor.chain().focus().toggleUnderline().run();
          }}
          className={`p-1.5 rounded transition-colors cursor-pointer ${
            editor.isActive('underline')
              ? 'bg-[#D9C5B2] text-[#3D352E] font-bold'
              : 'hover:bg-[#E3DCD2] text-[#8C7B6E]'
          }`}
        >
          <UnderlineIcon className="w-3.5 h-3.5" />
        </button>

        <div className="w-px h-4 bg-[#E3DCD2] mx-0.5" />

        {/* Marca-texto Pontual */}
        <button
          type="button"
          title="Destacar com marca-texto"
          onMouseDown={(e) => {
            e.preventDefault();
            setShowColorPicker((prev) => !prev);
          }}
          className={`p-1.5 rounded transition-colors cursor-pointer flex items-center gap-1 ${
            showColorPicker || editor.isActive('highlight')
              ? 'bg-[#D9C5B2] text-[#3D352E]'
              : 'hover:bg-[#E3DCD2] text-[#8C7B6E]'
          }`}
        >
          <Highlighter className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Mini paleta flutuante com as 5 cores pastéis */}
      {showColorPicker && (
        <div className="mt-1 px-2 py-1 bg-[#FEFDFA] border border-[#D9C5B2] rounded-full shadow-md flex items-center gap-1.5 animate-in fade-in zoom-in-95 duration-75">
          {PASTEL_HIGHLIGHT_COLORS.map((color) => (
            <button
              key={color.hex}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                handleApplyHighlight(color.hex);
              }}
              title={color.name}
              aria-label={color.name}
              className="w-4 h-4 rounded-full border border-black/20 cursor-pointer transition-transform hover:scale-125 shadow-2xs"
              style={{ backgroundColor: color.hex }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
