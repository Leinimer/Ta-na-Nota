'use client';

import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper, NodeViewProps } from '@tiptap/react';
import React, { useState, useEffect } from 'react';
import { FileText, Download, ExternalLink, Trash2, GripVertical, Paperclip } from 'lucide-react';
import { attachmentService, subscribeToAttachmentUpdates } from '@/services/attachmentService';

function formatBytes(bytes?: number): string {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function FileAttachmentView({ node, deleteNode, selected }: NodeViewProps) {
  const initialSrc = node.attrs.src || '';
  const isDirectUrl = initialSrc.startsWith('data:') || initialSrc.startsWith('blob:') || initialSrc.startsWith('http');
  const [resolvedUrl, setResolvedUrl] = useState<string>(isDirectUrl ? initialSrc : '');
  const [isLoading, setIsLoading] = useState<boolean>(!isDirectUrl && Boolean(initialSrc));

  const fileName = node.attrs.fileName || node.attrs.title || 'Anexo';
  const fileSize = node.attrs.fileSize;
  const mimeType = node.attrs.mimeType || 'application/octet-stream';
  const isPdf = mimeType === 'application/pdf' || fileName.toLowerCase().endsWith('.pdf');

  useEffect(() => {
    let isMounted = true;
    const currentSrc = node.attrs.src;
    if (!currentSrc) return;

    attachmentService.resolveImageUrl(currentSrc).then((url) => {
      if (isMounted) {
        if (url) setResolvedUrl(url);
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
        setResolvedUrl(objectUrl);
        setIsLoading(false);
      }
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [node.attrs.src]);

  const handleOpen = () => {
    if (resolvedUrl) {
      window.open(resolvedUrl, '_blank', 'noopener,noreferrer');
    }
  };

  const handleDownload = () => {
    if (!resolvedUrl) return;
    const link = document.createElement('a');
    link.href = resolvedUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <NodeViewWrapper className="file-attachment-wrapper my-2 select-none" draggable="true">
      <div
        className={`relative group max-w-md w-full border rounded-lg p-3 bg-[#FEFDFA] transition-all flex items-center justify-between gap-3 ${
          selected
            ? 'border-[#8C7B6E] ring-2 ring-[#8C7B6E]/40 shadow-sm'
            : 'border-[#E3DCD2] hover:border-[#D9C5B2] hover:shadow-xs'
        }`}
      >
        {/* Drag handle */}
        <div
          data-drag-handle
          draggable="true"
          title="Arrastar para reposicionar anexo"
          className="cursor-grab active:cursor-grabbing text-[#8C7B6E] hover:text-[#3D352E] p-0.5 rounded transition-opacity opacity-40 group-hover:opacity-100 shrink-0"
        >
          <GripVertical className="w-4 h-4" />
        </div>

        {/* Icon & File info */}
        <div
          onClick={handleOpen}
          className="flex items-center gap-2.5 min-w-0 flex-1 cursor-pointer"
          title="Clique para abrir ou visualizar anexo"
        >
          <div
            className={`w-9 h-9 rounded-md flex items-center justify-center shrink-0 ${
              isPdf ? 'bg-red-50 text-red-600 border border-red-100' : 'bg-[#E3DCD2]/50 text-[#8C7B6E]'
            }`}
          >
            {isPdf ? <FileText className="w-5 h-5" /> : <Paperclip className="w-5 h-5" />}
          </div>

          <div className="flex flex-col min-w-0">
            <span className="text-xs font-medium text-[#3D352E] truncate hover:text-[#8C7B6E]">
              {fileName}
            </span>
            <div className="flex items-center gap-1.5 text-[11px] text-[#8C7B6E]">
              {isPdf && (
                <span className="font-semibold text-red-600 bg-red-50 px-1 py-0.2 rounded text-[10px]">
                  PDF
                </span>
              )}
              {fileSize ? <span>{formatBytes(fileSize)}</span> : null}
              {isLoading && <span className="italic">carregando...</span>}
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={handleOpen}
            title="Abrir / Visualizar"
            disabled={!resolvedUrl}
            className="p-1.5 rounded-md text-[#8C7B6E] hover:text-[#3D352E] hover:bg-[#E3DCD2] disabled:opacity-40 transition-colors cursor-pointer"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={handleDownload}
            title="Baixar arquivo"
            disabled={!resolvedUrl}
            className="p-1.5 rounded-md text-[#8C7B6E] hover:text-[#3D352E] hover:bg-[#E3DCD2] disabled:opacity-40 transition-colors cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={deleteNode}
            title="Remover anexo da nota"
            className="p-1.5 rounded-md text-[#8C7B6E] hover:text-red-600 hover:bg-red-50 transition-colors cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </NodeViewWrapper>
  );
}

export const FileAttachment = Node.create({
  name: 'fileAttachment',
  group: 'block',
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      src: {
        default: null,
      },
      fileName: {
        default: 'Anexo',
      },
      fileSize: {
        default: null,
      },
      mimeType: {
        default: null,
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="file-attachment"]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes({ 'data-type': 'file-attachment' }, HTMLAttributes)];
  },

  addNodeView() {
    return ReactNodeViewRenderer(FileAttachmentView);
  },
});
