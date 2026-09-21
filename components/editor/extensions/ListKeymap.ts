import { Extension } from '@tiptap/core';

/**
 * ListKeymap Extension
 * Gerencia navegação e hierarquia de listas usando Tab e Shift+Tab:
 * - Tab: aumenta indentação / nível hierárquico (sinkListItem)
 * - Shift+Tab: diminui indentação / nível hierárquico (liftListItem)
 * Compatível com bulletList, orderedList (listItem) e taskList (taskItem).
 * Preserva cursor e conteúdo sem quebrar texto.
 */
export const ListKeymap = Extension.create({
  name: 'listKeymap',

  addKeyboardShortcuts() {
    return {
      Tab: ({ editor }) => {
        if (editor.can().sinkListItem('listItem')) {
          return editor.chain().sinkListItem('listItem').run();
        }
        if (editor.can().sinkListItem('taskItem')) {
          return editor.chain().sinkListItem('taskItem').run();
        }
        return false;
      },
      'Shift-Tab': ({ editor }) => {
        if (editor.can().liftListItem('listItem')) {
          return editor.chain().liftListItem('listItem').run();
        }
        if (editor.can().liftListItem('taskItem')) {
          return editor.chain().liftListItem('taskItem').run();
        }
        return false;
      },
    };
  },
});
