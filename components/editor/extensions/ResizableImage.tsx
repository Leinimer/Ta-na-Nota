'use client';

import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper, NodeViewProps } from '@tiptap/react';
import React, { useState, useRef } from 'react';

function ResizableImageView({ node, updateAttributes, selected }: NodeViewProps) {
  const [resizing, setResizing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const currentWidth = node.attrs.width || '100%';

  const handleStartResize = (e: React.MouseEvent, direction: 'se' | 'sw') => {
    e.preventDefault();
    e.stopPropagation();
    setResizing(true);

    const startX = e.clientX;
    const initialWidth = containerRef.current?.offsetWidth || 300;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = direction === 'se' ? moveEvent.clientX - startX : startX - moveEvent.clientX;
      const newWidth = Math.max(120, Math.min(850, initialWidth + deltaX));
      if (containerRef.current) {
        containerRef.current.style.width = `${newWidth}px`;
      }
    };

    const onMouseUp = (upEvent: MouseEvent) => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      setResizing(false);
      const deltaX = direction === 'se' ? upEvent.clientX - startX : startX - upEvent.clientX;
      const finalWidth = Math.max(120, Math.min(850, initialWidth + deltaX));
      updateAttributes({ width: `${Math.round(finalWidth)}px` });
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  return (
    <NodeViewWrapper className="resizable-image-wrapper flex justify-center my-3 select-none">
      <div
        ref={containerRef}
        style={{ width: currentWidth, maxWidth: '100%' }}
        className={`relative group inline-block rounded-lg transition-shadow ${
          selected || resizing ? 'ring-2 ring-[#8C7B6E] shadow-md' : ''
        }`}
      >
        <img
          src={node.attrs.src}
          alt={node.attrs.alt || ''}
          className="w-full h-auto rounded-lg object-contain block pointer-events-none"
        />

        {/* Word-style corner resize handles */}
        <div
          onMouseDown={(e) => handleStartResize(e, 'se')}
          title="Arrastar para redimensionar"
          className={`absolute -bottom-2 -right-2 w-4 h-4 bg-[#8C7B6E] border-2 border-white rounded-full shadow cursor-se-resize z-20 flex items-center justify-center transition-opacity ${
            selected || resizing ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          }`}
        >
          <div className="w-1 h-1 bg-white rounded-full" />
        </div>

        <div
          onMouseDown={(e) => handleStartResize(e, 'sw')}
          title="Arrastar para redimensionar"
          className={`absolute -bottom-2 -left-2 w-4 h-4 bg-[#8C7B6E] border-2 border-white rounded-full shadow cursor-sw-resize z-20 flex items-center justify-center transition-opacity ${
            selected || resizing ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          }`}
        >
          <div className="w-1 h-1 bg-white rounded-full" />
        </div>

        {/* Quick size presets toolbar on select/hover */}
        <div
          className={`absolute -top-7 left-1/2 -translate-x-1/2 bg-[#3D352E]/90 backdrop-blur-xs text-white text-[10px] px-2 py-0.5 rounded shadow-md flex items-center gap-2 z-20 transition-opacity ${
            selected || resizing
              ? 'opacity-100 pointer-events-auto'
              : 'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto'
          }`}
          contentEditable={false}
        >
          <button
            type="button"
            onClick={() => updateAttributes({ width: '25%' })}
            className="hover:text-[#D9C5B2] cursor-pointer font-medium"
          >
            25%
          </button>
          <span className="text-[#8C7B6E]">•</span>
          <button
            type="button"
            onClick={() => updateAttributes({ width: '50%' })}
            className="hover:text-[#D9C5B2] cursor-pointer font-medium"
          >
            50%
          </button>
          <span className="text-[#8C7B6E]">•</span>
          <button
            type="button"
            onClick={() => updateAttributes({ width: '75%' })}
            className="hover:text-[#D9C5B2] cursor-pointer font-medium"
          >
            75%
          </button>
          <span className="text-[#8C7B6E]">•</span>
          <button
            type="button"
            onClick={() => updateAttributes({ width: '100%' })}
            className="hover:text-[#D9C5B2] cursor-pointer font-medium"
          >
            100%
          </button>
        </div>
      </div>
    </NodeViewWrapper>
  );
}

export const ResizableImage = Node.create({
  name: 'image',
  group: 'block',
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      src: {
        default: null,
      },
      alt: {
        default: null,
      },
      title: {
        default: null,
      },
      width: {
        default: '100%',
        parseHTML: (element) => element.getAttribute('width') || element.style.width || '100%',
        renderHTML: (attributes) => {
          if (!attributes.width) return {};
          return {
            width: attributes.width,
            style: `width: ${attributes.width}; max-width: 100%;`,
          };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'img[src]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['img', mergeAttributes(HTMLAttributes)];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ResizableImageView);
  },
});
