'use client';

import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper, NodeViewProps } from '@tiptap/react';
import React, { useState, useRef, useEffect } from 'react';
import { GripVertical, Play } from 'lucide-react';
import { attachmentService, subscribeToAttachmentUpdates } from '@/services/attachmentService';

function ResizableVideoView({ node, updateAttributes, selected }: NodeViewProps) {
  const [resizing, setResizing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const initialSrc = node.attrs.src || '';
  const isDirectUrl = initialSrc.startsWith('data:') || initialSrc.startsWith('blob:') || initialSrc.startsWith('http');
  const [displaySrc, setDisplaySrc] = useState<string>(isDirectUrl ? initialSrc : '');
  const [isLoading, setIsLoading] = useState<boolean>(!isDirectUrl && Boolean(initialSrc));

  useEffect(() => {
    let isMounted = true;
    const currentSrc = node.attrs.src;
    if (!currentSrc) {
      return;
    }

    attachmentService.resolveImageUrl(currentSrc).then((resolved) => {
      if (isMounted) {
        if (resolved) {
          setDisplaySrc(resolved);
        }
        setIsLoading(false);
      }
    });

    const unsubscribe = subscribeToAttachmentUpdates(({ id, storagePath, objectUrl }) => {
      if (!isMounted) return;
      if (
        currentSrc.includes(id) ||
        currentSrc.includes(storagePath) ||
        currentSrc === `attachment:${storagePath}` ||
        currentSrc === `attachment:${id}` ||
        currentSrc === `attachment-local:${id}` ||
        storagePath.endsWith(currentSrc)
      ) {
        setDisplaySrc(objectUrl);
        setIsLoading(false);
      }
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [node.attrs.src]);

  // Default initial width is 75%
  const currentWidth = node.attrs.width || '75%';

  const handleStartResize = (e: React.MouseEvent, direction: 'se' | 'sw') => {
    e.preventDefault();
    e.stopPropagation();
    setResizing(true);

    const startX = e.clientX;
    const initialWidth = containerRef.current?.offsetWidth || 400;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = direction === 'se' ? moveEvent.clientX - startX : startX - moveEvent.clientX;
      const newWidth = Math.max(200, Math.min(850, initialWidth + deltaX));
      if (containerRef.current) {
        containerRef.current.style.width = `${newWidth}px`;
      }
    };

    const onMouseUp = (upEvent: MouseEvent) => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      setResizing(false);
      const deltaX = direction === 'se' ? upEvent.clientX - startX : startX - upEvent.clientX;
      const finalWidth = Math.max(200, Math.min(850, initialWidth + deltaX));
      updateAttributes({ width: `${Math.round(finalWidth)}px` });
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  return (
    <NodeViewWrapper
      className="resizable-video-wrapper flex justify-center my-3 select-none"
      draggable="true"
    >
      <div
        ref={containerRef}
        style={{ width: currentWidth, maxWidth: '100%' }}
        className={`relative group inline-block rounded-lg transition-shadow bg-black/5 ${
          selected || resizing ? 'ring-2 ring-[#8C7B6E] shadow-md' : ''
        }`}
      >
        {/* Block Drag Handle (⋮⋮) positioned on top-left border */}
        <div
          data-drag-handle
          draggable="true"
          title="Arrastar para reposicionar vídeo no texto"
          className={`absolute top-2 left-2 w-6 h-6 rounded-md bg-[#FEFDFA]/95 backdrop-blur-xs border border-[#D9C5B2] text-[#8C7B6E] hover:text-[#3D352E] hover:bg-[#E3DCD2] shadow-xs flex items-center justify-center cursor-grab active:cursor-grabbing z-20 transition-opacity ${
            selected || resizing ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          }`}
          contentEditable={false}
        >
          <GripVertical className="w-3.5 h-3.5" />
        </div>

        {displaySrc ? (
          <video
            src={displaySrc}
            controls
            playsInline
            preload="metadata"
            className="w-full h-auto rounded-lg object-contain block max-h-[500px]"
          />
        ) : (
          <div className="w-full min-h-[160px] bg-[#E3DCD2]/40 rounded-lg flex items-center justify-center text-xs text-[#8C7B6E] p-4 flex-col gap-1">
            <Play className="w-6 h-6 text-[#8C7B6E]/70 mb-1" />
            {isLoading ? 'Carregando vídeo...' : 'Vídeo indisponível'}
          </div>
        )}

        {/* Resize handles on bottom-right and bottom-left borders */}
        <div
          onMouseDown={(e) => handleStartResize(e, 'se')}
          title="Arrastar para redimensionar vídeo"
          className={`absolute bottom-2 right-2 w-4 h-4 bg-[#8C7B6E] border-2 border-white rounded-full shadow-md cursor-se-resize z-20 flex items-center justify-center transition-opacity ${
            selected || resizing ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          }`}
          contentEditable={false}
        >
          <div className="w-1 h-1 bg-white rounded-full" />
        </div>

        <div
          onMouseDown={(e) => handleStartResize(e, 'sw')}
          title="Arrastar para redimensionar vídeo"
          className={`absolute bottom-2 left-2 w-4 h-4 bg-[#8C7B6E] border-2 border-white rounded-full shadow-md cursor-sw-resize z-20 flex items-center justify-center transition-opacity ${
            selected || resizing ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          }`}
          contentEditable={false}
        >
          <div className="w-1 h-1 bg-white rounded-full" />
        </div>

        {/* Quick size presets toolbar positioned on the top-right border */}
        <div
          className={`absolute top-2 right-2 bg-[#3D352E]/90 backdrop-blur-xs text-white text-[10px] px-2 py-0.5 rounded-md shadow-md flex items-center gap-2 z-20 transition-opacity ${
            selected || resizing
              ? 'opacity-100 pointer-events-auto'
              : 'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto'
          }`}
          contentEditable={false}
        >
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

export const ResizableVideo = Node.create({
  name: 'video',
  group: 'block',
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      src: {
        default: null,
      },
      title: {
        default: null,
      },
      width: {
        default: '75%',
        parseHTML: (element) => element.getAttribute('width') || element.style.width || '75%',
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
        tag: 'video[src]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['video', mergeAttributes(this.options.HTMLAttributes, { controls: true }, HTMLAttributes)];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ResizableVideoView);
  },
});
