import { Details, DetailsContent, DetailsSummary } from '@tiptap/extension-details';
import { findParentNode, findChildren, mergeAttributes } from '@tiptap/core';
import { Selection, TextSelection } from '@tiptap/pm/state';

export const CustomDetails = Details.extend({
  addAttributes() {
    return {
      open: {
        default: true,
        parseHTML: (element) => element.hasAttribute('open'),
        renderHTML: ({ open }) => (open ? { open: '' } : {}),
      },
    };
  },

  addCommands() {
    return {
      ...this.parent?.(),
      setDetails:
        () =>
        ({ state, chain }) => {
          const { schema, selection } = state;
          const { $from, $to } = selection;

          const hasSelection = !selection.empty;
          const selectedText = hasSelection ? state.doc.textBetween($from.pos, $to.pos, ' ') : '';

          const range = $from.blockRange($to);
          if (!range) return false;

          // Estrutura obrigatória:
          // details
          // ├── detailsSummary (com texto selecionado se houver)
          // └── detailsContent
          //     └── paragraph vazio
          const detailsNode = {
            type: this.name,
            attrs: { open: true },
            content: [
              {
                type: 'detailsSummary',
                content: selectedText ? [{ type: 'text', text: selectedText }] : [],
              },
              {
                type: 'detailsContent',
                content: [{ type: 'paragraph' }],
              },
            ],
          };

          // range.start é antes de details.
          // range.start + 1 é antes de detailsSummary.
          // range.start + 2 é dentro de detailsSummary.
          const cursorPositionInSummary = range.start + 2 + (selectedText ? selectedText.length : 0);

          return chain()
            .insertContentAt({ from: range.start, to: range.end }, detailsNode)
            .setTextSelection(cursorPositionInSummary)
            .scrollIntoView()
            .run();
        },
      unsetDetails:
        () =>
        ({ state, chain }) => {
          const { selection, schema } = state;
          const details = findParentNode((node) => node.type === this.type)(selection);
          if (!details) return false;

          const detailsSummaries = findChildren(
            details.node,
            (node) => node.type === schema.nodes.detailsSummary
          );
          const detailsContents = findChildren(
            details.node,
            (node) => node.type === schema.nodes.detailsContent
          );
          if (!detailsSummaries.length || !detailsContents.length) return false;

          const detailsSummary = detailsSummaries[0];
          const detailsContent = detailsContents[0];
          const from = details.pos;
          const range = {
            from,
            to: from + details.node.nodeSize,
          };

          const summaryText = detailsSummary.node.textContent;
          const contentBlocks = detailsContent.node.content.toJSON() || [];

          const summaryParagraph = {
            type: 'paragraph',
            content: summaryText ? [{ type: 'text', text: summaryText }] : [],
          };

          const merged = [summaryParagraph, ...contentBlocks];

          return chain().insertContentAt(range, merged).setTextSelection(from + 1).run();
        },
    };
  },

  addNodeView() {
    return ({ editor, getPos, node, HTMLAttributes }) => {
      let isOpen = Boolean(node.attrs.open);

      const dom = document.createElement('div');
      const attributes = mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        'data-type': this.name,
      });
      Object.entries(attributes).forEach(([key, value]) => dom.setAttribute(key, value));
      if (isOpen) {
        dom.classList.add('is-open');
      } else {
        dom.classList.remove('is-open');
      }

      // Botão independente com ícone chevron do Notion
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'details-toggle-btn';
      toggle.setAttribute('data-toggle-button', 'true');

      const updateButtonVisual = (openState: boolean) => {
        toggle.setAttribute('aria-label', openState ? 'Recolher toggle' : 'Expandir toggle');
        toggle.innerHTML = openState
          ? `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="m7 10 5 5 5-5z"/></svg>`
          : `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="m10 17 5-5-5-5z"/></svg>`;
      };

      updateButtonVisual(isOpen);

      // Impede que o clique na seta selecione texto do summary
      toggle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
      });

      // Clique na seta abre/fecha
      toggle.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();

        if (typeof getPos !== 'function') return;
        const pos = getPos();
        if (typeof pos !== 'number') return;

        const nextOpen = !isOpen;
        isOpen = nextOpen;
        dom.classList.toggle('is-open', nextOpen);
        updateButtonVisual(nextOpen);

        if (editor.isEditable) {
          const { from, to } = editor.state.selection;
          editor
            .chain()
            .command(({ tr }) => {
              const currentNode = tr.doc.nodeAt(pos);
              if (currentNode?.type !== this.type) return false;
              tr.setNodeMarkup(pos, undefined, { ...currentNode.attrs, open: nextOpen });
              return true;
            })
            .setTextSelection({ from, to })
            .focus(undefined, { scrollIntoView: false })
            .run();
        }
      });

      dom.appendChild(toggle);

      const content = document.createElement('div');
      content.className = 'details-inner-wrapper';
      dom.appendChild(content);

      return {
        dom,
        contentDOM: content,
        ignoreMutation(mutation) {
          if (mutation.type === 'selection') return false;
          const target = mutation.target as Node;
          const isInsideWrapper = dom.contains(target);
          return toggle.contains(target) || !isInsideWrapper || dom === target;
        },
        update: (updatedNode) => {
          if (updatedNode.type !== this.type) return false;
          if (updatedNode.attrs.open !== undefined && updatedNode.attrs.open !== isOpen) {
            isOpen = Boolean(updatedNode.attrs.open);
            dom.classList.toggle('is-open', isOpen);
            updateButtonVisual(isOpen);
          }
          return true;
        },
      };
    };
  },

  addKeyboardShortcuts() {
    return {
      ...this.parent?.(),
      // 1. Enter no título (Summary) -> vai para o primeiro parágrafo do detailsContent
      Enter: ({ editor }) => {
        const { state, view } = editor;
        const { schema, selection } = state;
        const { $head, empty } = selection;

        // Se o cursor estiver no detailsSummary:
        if ($head.parent.type === schema.nodes.detailsSummary) {
          // Localiza o bloco details ancestral
          let detailsDepth = -1;
          for (let d = $head.depth; d > 0; d--) {
            if ($head.node(d).type.name === this.name) {
              detailsDepth = d;
              break;
            }
          }
          if (detailsDepth === -1) return false;

          const detailsNode = $head.node(detailsDepth);
          const detailsPos = $head.before(detailsDepth);
          const tr = state.tr;

          // Se estiver fechado, abre o toggle
          if (!detailsNode.attrs.open) {
            tr.setNodeMarkup(detailsPos, undefined, { ...detailsNode.attrs, open: true });
          }

          const summaryNode = detailsNode.child(0);
          const contentNode = detailsNode.child(1);
          const contentPos = detailsPos + 1 + summaryNode.nodeSize; // posição antes de detailsContent

          // Se detailsContent estiver vazio de filhos, insere um parágrafo
          if (contentNode.childCount === 0) {
            const p = schema.nodes.paragraph.createAndFill();
            if (p) {
              tr.insert(contentPos + 1, p);
            }
          }

          // Posiciona cursor dentro do primeiro bloco de detailsContent
          // contentPos + 1 (entra no detailsContent) + 1 (entra no primeiro parágrafo)
          const targetPos = contentPos + 2;
          const $target = tr.doc.resolve(targetPos);
          const newSelection = Selection.near($target, 1);
          tr.setSelection(newSelection);
          tr.scrollIntoView();
          view.dispatch(tr);
          return true;
        }

        // Se o cursor estiver dentro de detailsContent em uma linha vazia no final:
        // Pressionar Enter sai do details e cria um parágrafo fora!
        if (empty) {
          let contentDepth = -1;
          for (let d = $head.depth; d > 0; d--) {
            if ($head.node(d).type.name === 'detailsContent') {
              contentDepth = d;
              break;
            }
          }

          if (contentDepth !== -1) {
            const contentNode = $head.node(contentDepth);
            const childIndex = $head.index(contentDepth);
            const currentChild = contentNode.child(childIndex);

            // Se o parágrafo atual estiver completamente vazio e for o último bloco filho do content:
            if (
              currentChild.type === schema.nodes.paragraph &&
              currentChild.content.size === 0 &&
              childIndex === contentNode.childCount - 1 &&
              contentNode.childCount > 1
            ) {
              const detailsDepth = contentDepth - 1;
              const detailsNode = $head.node(detailsDepth);
              const detailsPos = $head.before(detailsDepth);
              const exitPos = detailsPos + detailsNode.nodeSize;

              const tr = state.tr;
              const currentChildPos = $head.before(contentDepth + 1);
              tr.delete(currentChildPos, currentChildPos + currentChild.nodeSize);

              const mappedExitPos = tr.mapping.map(exitPos);
              const newP = schema.nodes.paragraph.createAndFill()!;
              tr.insert(mappedExitPos, newP);
              tr.setSelection(Selection.near(tr.doc.resolve(mappedExitPos + 1), 1));
              tr.scrollIntoView();
              view.dispatch(tr);
              return true;
            }
          }
        }

        return false;
      },

      // 2. Backspace
      Backspace: ({ editor }) => {
        const { state, view } = editor;
        const { selection, schema } = state;
        const { $from, empty } = selection;
        if (!empty) return false;

        // Se estiver no início do summary e o summary estiver vazio:
        if ($from.parent.type === schema.nodes.detailsSummary && $from.parentOffset === 0) {
          if ($from.parent.content.size === 0) {
            return (editor.commands as any).unsetDetails();
          }
          return false;
        }

        // Se estiver no início do primeiro parágrafo de detailsContent:
        let contentDepth = -1;
        for (let d = $from.depth; d > 0; d--) {
          if ($from.node(d).type.name === 'detailsContent') {
            contentDepth = d;
            break;
          }
        }

        if (contentDepth !== -1) {
          const childIndex = $from.index(contentDepth);
          if (childIndex === 0 && $from.parentOffset === 0) {
            // Mover o cursor para o final do summary sem apagar o bloco
            const detailsDepth = contentDepth - 1;
            const detailsNode = $from.node(detailsDepth);
            const detailsPos = $from.before(detailsDepth);
            const summaryNode = detailsNode.child(0);
            const summaryEndPos = detailsPos + 1 + summaryNode.nodeSize - 1;
            const tr = state.tr.setSelection(
              Selection.near(state.doc.resolve(summaryEndPos), -1)
            );
            view.dispatch(tr);
            return true;
          }
        }

        return false;
      },
    };
  },
});

export const CustomDetailsContent = DetailsContent.extend({
  addNodeView() {
    return ({ HTMLAttributes }) => {
      const dom = document.createElement('div');
      const attributes = mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        'data-type': this.name,
      });
      Object.entries(attributes).forEach(([key, value]) => dom.setAttribute(key, value));
      return {
        dom,
        contentDOM: dom,
      };
    };
  },
});

export { DetailsSummary };
