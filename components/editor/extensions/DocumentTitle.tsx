'use client';

import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper, NodeViewContent, NodeViewProps } from '@tiptap/react';
import React from 'react';
import { NoteTagsBar } from '../NoteTagsBar';

export const DocumentTitleContext = React.createContext<{
  userId: string;
  noteId: string;
  onTagClick?: (tag: string) => void;
}>({
  userId: '',
  noteId: '',
});

function DocumentTitleView({}: NodeViewProps) {
  const { userId, noteId, onTagClick } = React.useContext(DocumentTitleContext);

  return (
    <NodeViewWrapper className="document-title-wrapper flex flex-col items-center w-full mb-4 select-none">
      <NodeViewContent
        as="div"
        className="w-full text-center text-3xl sm:text-4xl font-serif font-bold text-[#8C7B6E] outline-none tracking-tight py-1 px-2 border-b border-transparent hover:border-[#E3DCD2] focus:border-[#8C7B6E] transition-colors"
      />
      {noteId && userId && (
        <div className="mt-2.5 flex justify-center w-full" contentEditable={false}>
          <NoteTagsBar
            userId={userId}
            noteId={noteId}
            onTagClick={(tag) => onTagClick && onTagClick(tag.name)}
          />
        </div>
      )}
    </NodeViewWrapper>
  );
}

export const DocumentTitle = Node.create({
  name: 'documentTitle',
  group: 'block',
  content: 'inline*',
  defining: true,
  isolating: true,

  parseHTML() {
    return [
      {
        tag: 'h1.document-title',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['h1', mergeAttributes(HTMLAttributes, { class: 'document-title' }), 0];
  },

  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const { $from } = editor.state.selection;
        if ($from.parent.type.name === 'documentTitle') {
          const afterPos = $from.after();
          return editor.chain().insertContentAt(afterPos, { type: 'paragraph' }).focus(afterPos + 1).run();
        }
        return false;
      },
      Backspace: ({ editor }) => {
        const { $from } = editor.state.selection;
        if ($from.parent.type.name === 'documentTitle' && $from.parentOffset === 0) {
          // Do not delete the title block
          return true;
        }
        return false;
      },
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(DocumentTitleView);
  },
});
