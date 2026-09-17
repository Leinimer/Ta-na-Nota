'use client';

import React from 'react';

interface MarkdownEditorProps {
  content: string;
  onChange: (value: string) => void;
}

export function MarkdownEditor({ content, onChange }: MarkdownEditorProps) {
  const lineCount = content.split('\n').length;
  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0;
  const charCount = content.length;

  return (
    <div id="markdown-raw-container" className="flex flex-col flex-1 h-full bg-[#F9F7F2]">
      {/* Editor stats subheader */}
      <div className="flex items-center justify-between px-6 py-2 bg-[#F9F7F2] border-b border-[#E3DCD2] text-[11px] text-[#8C7B6E] font-mono">
        <div className="flex items-center gap-3">
          <span>{lineCount} linhas</span>
          <span>{wordCount} palavras</span>
          <span>{charCount} caracteres</span>
        </div>
        <span className="text-[#8C7B6E] font-medium">Modo Markdown Bruto</span>
      </div>

      {/* Textarea */}
      <div className="flex-1 p-6 md:p-8 flex justify-center overflow-y-auto custom-scrollbar">
        <textarea
          id="markdown-textarea"
          value={content}
          onChange={(e) => onChange(e.target.value)}
          placeholder="# Digite seu Markdown aqui..."
          spellCheck={false}
          className="w-full max-w-[820px] h-full min-h-[500px] p-6 bg-[#FFFFFF] border border-[#E3DCD2] rounded-lg font-mono text-sm leading-relaxed text-[#3D352E] outline-none focus:border-[#8C7B6E] focus:ring-1 focus:ring-[#8C7B6E] placeholder:text-[#8C7B6E]/50 resize-none custom-scrollbar shadow-xs"
        />
      </div>
    </div>
  );
}
