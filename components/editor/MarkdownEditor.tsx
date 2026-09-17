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
    <div id="markdown-raw-container" className="flex flex-col flex-1 h-full">
      {/* Editor stats subheader */}
      <div className="flex items-center justify-between px-6 py-2 bg-[#f5f3ee] dark:bg-[#201f1c] border-b border-[#eae8e3] dark:border-[#2f2d29] text-[11px] text-[#7f756e] font-mono">
        <div className="flex items-center gap-3">
          <span>{lineCount} linhas</span>
          <span>{wordCount} palavras</span>
          <span>{charCount} caracteres</span>
        </div>
        <span className="text-[#68594d] dark:text-[#d7c3b4]">Modo Markdown Bruto</span>
      </div>

      {/* Textarea */}
      <div className="flex-1 p-6 md:p-8 flex justify-center overflow-y-auto custom-scrollbar">
        <textarea
          id="markdown-textarea"
          value={content}
          onChange={(e) => onChange(e.target.value)}
          placeholder="# Digite seu Markdown aqui..."
          spellCheck={false}
          className="w-full max-w-[820px] h-full min-h-[500px] p-4 bg-[#ffffff] dark:bg-[#23221e] border border-[#d1c4bc] dark:border-[#44403a] rounded-lg font-mono text-sm leading-relaxed text-[#1b1c19] dark:text-[#f2f1ec] outline-none focus:ring-1 focus:ring-[#68594d] resize-none custom-scrollbar"
        />
      </div>
    </div>
  );
}
