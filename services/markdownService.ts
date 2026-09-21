/**
 * MarkdownService
 * Centralized, bidirectional converter between Tiptap JSON schema and clean, portable Markdown.
 * Supports:
 * - Headings (H1-H4)
 * - Lists (bullet, numbered, task/checklists)
 * - Blockquotes
 * - Code blocks & inline code
 * - Tables (Markdown tables)
 * - Media & Attachments (Images, YouTube, Audio, Video, PDF)
 * - LaTeX / Math equations ($$ E = mc^2 $$)
 * - Internal Note Links ([[Note Name]])
 * - Tags (#tag)
 * - Formatting (Bold, Italic, Underline, Strike, Highlight, Sub/Superscript)
 */

export class MarkdownService {
  /**
   * Extrai o título textual de um conteúdo em Markdown
   */
  static extractTitle(markdown: string): string {
    if (!markdown) return '';
    const match = markdown.match(/^#\s*(.*)$/m);
    if (match && match[1]?.trim()) {
      return match[1].trim();
    }
    const firstLine = markdown.split('\n').find((l) => l.trim().length > 0);
    return firstLine ? firstLine.trim().slice(0, 50) : '';
  }

  /**
   * Converts Tiptap JSON document to generic portable Markdown string.
   */
  static visualToMarkdown(json: any): string {
    if (!json || !json.content || !Array.isArray(json.content)) {
      return '';
    }
    return this.renderNodes(json.content).trim();
  }

  /**
   * Converts generic Markdown string into Tiptap JSON document.
   * Ensures the very first element is always the documentTitle.
   */
  static markdownToVisual(markdown: string, defaultTitle: string = ''): any {
    if (!markdown || !markdown.trim()) {
      return {
        type: 'doc',
        content: [
          {
            type: 'documentTitle',
            content: this.parseInlineText(defaultTitle),
          },
          { type: 'paragraph' },
        ],
      };
    }

    const lines = markdown.split('\n');
    const content: any[] = [];
    let i = 0;
    let hasTitle = false;

    // Check if first non-empty line starts with #
    while (i < lines.length && !lines[i].trim()) {
      i++;
    }

    if (i < lines.length) {
      const rawFirstLine = lines[i];
      if (/^#\s*/.test(rawFirstLine.trimStart())) {
        const titleText = rawFirstLine.trimStart().replace(/^#\s*/, '');
        content.push({
          type: 'documentTitle',
          content: this.parseInlineText(titleText),
        });
        hasTitle = true;
        i++;
      } else {
        // Did not start with #, add default title as first element
        content.push({
          type: 'documentTitle',
          content: this.parseInlineText(defaultTitle),
        });
        hasTitle = true;
      }
    } else {
      content.push({
        type: 'documentTitle',
        content: this.parseInlineText(defaultTitle),
      });
      hasTitle = true;
    }

    while (i < lines.length) {
      const line = lines[i];

      // Empty line
      if (!line.trim()) {
        i++;
        continue;
      }

      // 1. Math block: $$ ... $$
      if (line.trim().startsWith('$$')) {
        let mathCode = line.trim().slice(2);
        if (mathCode.endsWith('$$') && mathCode.length > 2) {
          content.push({
            type: 'codeBlock',
            attrs: { language: 'latex' },
            content: [{ type: 'text', text: mathCode.slice(0, -2).trim() }],
          });
          i++;
          continue;
        }
        const mathLines: string[] = [];
        if (mathCode) mathLines.push(mathCode);
        i++;
        while (i < lines.length && !lines[i].trim().endsWith('$$')) {
          mathLines.push(lines[i]);
          i++;
        }
        if (i < lines.length && lines[i].trim().endsWith('$$')) {
          const last = lines[i].trim().replace(/\$\$$/, '');
          if (last) mathLines.push(last);
          i++;
        }
        content.push({
          type: 'codeBlock',
          attrs: { language: 'latex' },
          content: [{ type: 'text', text: mathLines.join('\n').trim() }],
        });
        continue;
      }

      // 2. Code block: ```lang ... ```
      if (line.trim().startsWith('```')) {
        const lang = line.trim().slice(3).trim();
        const codeLines: string[] = [];
        i++;
        while (i < lines.length && !lines[i].trim().startsWith('```')) {
          codeLines.push(lines[i]);
          i++;
        }
        if (i < lines.length) i++; // skip closing ```
        content.push({
          type: 'codeBlock',
          attrs: { language: lang || 'text' },
          content: [{ type: 'text', text: codeLines.join('\n') }],
        });
        continue;
      }

      // 3. Headings: #, ##, ###, ####
      const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
      if (headingMatch) {
        const level = Math.min(headingMatch[1].length, 4);
        content.push({
          type: 'heading',
          attrs: { level },
          content: this.parseInlineText(headingMatch[2]),
        });
        i++;
        continue;
      }

      // 4. Horizontal rule: --- or ***
      if (/^(\*{3,}|-{3,}|_{3,})$/.test(line.trim())) {
        content.push({ type: 'horizontalRule' });
        i++;
        continue;
      }

      // 5. Blockquote: >
      if (line.trim().startsWith('>')) {
        const quoteLines: string[] = [];
        while (i < lines.length && lines[i].trim().startsWith('>')) {
          quoteLines.push(lines[i].replace(/^>\s?/, ''));
          i++;
        }
        content.push({
          type: 'blockquote',
          content: [{
            type: 'paragraph',
            content: this.parseInlineText(quoteLines.join(' ')),
          }],
        });
        continue;
      }

      // 6. Task List / Checklist: - [ ] or - [x]
      if (/^[-*+]\s+\[([ xX])\]\s+(.*)$/.test(line.trim())) {
        const taskItems: any[] = [];
        while (i < lines.length && /^[-*+]\s+\[([ xX])\]\s+(.*)$/.test(lines[i].trim())) {
          const match = lines[i].trim().match(/^[-*+]\s+\[([ xX])\]\s+(.*)$/);
          if (match) {
            const checked = match[1].toLowerCase() === 'x';
            taskItems.push({
              type: 'taskItem',
              attrs: { checked },
              content: [{
                type: 'paragraph',
                content: this.parseInlineText(match[2]),
              }],
            });
          }
          i++;
        }
        content.push({
          type: 'taskList',
          content: taskItems,
        });
        continue;
      }

      // 7. Bullet List: - or *
      if (/^[-*+]\s+(.*)$/.test(line.trim()) && !/^[-*+]\s+\[([ xX])\]/.test(line.trim())) {
        const listItems: any[] = [];
        while (
          i < lines.length &&
          /^[-*+]\s+(.*)$/.test(lines[i].trim()) &&
          !/^[-*+]\s+\[([ xX])\]/.test(lines[i].trim())
        ) {
          const match = lines[i].trim().match(/^[-*+]\s+(.*)$/);
          if (match) {
            listItems.push({
              type: 'listItem',
              content: [{
                type: 'paragraph',
                content: this.parseInlineText(match[1]),
              }],
            });
          }
          i++;
        }
        content.push({
          type: 'bulletList',
          content: listItems,
        });
        continue;
      }

      // 8. Ordered List: 1. 2.
      if (/^\d+\.\s+(.*)$/.test(line.trim())) {
        const listItems: any[] = [];
        while (i < lines.length && /^\d+\.\s+(.*)$/.test(lines[i].trim())) {
          const match = lines[i].trim().match(/^\d+\.\s+(.*)$/);
          if (match) {
            listItems.push({
              type: 'listItem',
              content: [{
                type: 'paragraph',
                content: this.parseInlineText(match[1]),
              }],
            });
          }
          i++;
        }
        content.push({
          type: 'orderedList',
          content: listItems,
        });
        continue;
      }

      // 9. Markdown Table: | col1 | col2 |
      if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
        const tableRows: any[] = [];
        let isFirstRow = true;
        while (i < lines.length && lines[i].trim().startsWith('|') && lines[i].trim().endsWith('|')) {
          const rawRow = lines[i].trim();
          // Check if it's separator row |---|---|
          if (/^\|(\s*[-:]+[-|\s:]*)\|$/.test(rawRow)) {
            i++;
            continue;
          }
          const cells = rawRow
            .slice(1, -1)
            .split('|')
            .map((c) => c.trim());

          const cellNodes = cells.map((cellText) => ({
            type: isFirstRow ? 'tableHeader' : 'tableCell',
            content: [{
              type: 'paragraph',
              content: this.parseInlineText(cellText),
            }],
          }));

          tableRows.push({
            type: 'tableRow',
            content: cellNodes,
          });

          isFirstRow = false;
          i++;
        }

        if (tableRows.length > 0) {
          content.push({
            type: 'table',
            content: tableRows,
          });
          continue;
        }
      }

      // 10. Details / Toggle Block: <details ...> ... </details>
      if (line.trim().startsWith('<details')) {
        const hasOpen = /<details\s+[^>]*open/i.test(line.trim()) || /<details\s+open>/i.test(line.trim());
        const detailLines: string[] = [];
        i++;
        while (i < lines.length && !lines[i].trim().startsWith('</details>')) {
          detailLines.push(lines[i]);
          i++;
        }
        if (i < lines.length && lines[i].trim().startsWith('</details>')) {
          i++;
        }

        let summaryText = 'Toggle';
        const innerLines: string[] = [];
        for (const dLine of detailLines) {
          const sumMatch = dLine.match(/<summary>(.*?)<\/summary>/i);
          if (sumMatch) {
            summaryText = sumMatch[1];
          } else if (dLine.trim()) {
            innerLines.push(dLine);
          }
        }

        const innerContent = innerLines.length > 0
          ? innerLines.map((txt) => ({
              type: 'paragraph',
              content: this.parseInlineText(txt),
            }))
          : [{ type: 'paragraph' }];

        content.push({
          type: 'details',
          attrs: { open: hasOpen },
          content: [
            {
              type: 'detailsSummary',
              content: this.parseInlineText(summaryText),
            },
            {
              type: 'detailsContent',
              content: innerContent,
            },
          ],
        });
        continue;
      }

      // 11. YouTube Embed Line: [YouTube](url) or direct youtube URL
      const ytMatch = line.trim().match(/^\[YouTube\]\((https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be)\/[^\)]+)\)$/i) ||
                      line.trim().match(/^(https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)[\w-]+)$/i);
      if (ytMatch) {
        content.push({
          type: 'youtube',
          attrs: { src: ytMatch[1] },
        });
        i++;
        continue;
      }

      // 11. Image: ![alt](url) - garante extração como nó de imagem mesmo com espaços ou títulos
      const trimmedLine = line.trim();

      // Video: [Vídeo](url)
      const videoMatch = trimmedLine.match(/^\[(?:Vídeo|Video)\]\(([^)\s]+)\)$/i);
      if (videoMatch) {
        content.push({
          type: 'video',
          attrs: { src: videoMatch[1], width: '75%' },
        });
        i++;
        continue;
      }

      // Attachment: [Anexo: nome](url)
      const attachmentMatch = trimmedLine.match(/^\[Anexo:\s*([^\]]*)\]\(([^)\s]+)\)$/i);
      if (attachmentMatch) {
        content.push({
          type: 'fileAttachment',
          attrs: {
            src: attachmentMatch[2],
            fileName: attachmentMatch[1],
            mimeType: attachmentMatch[1].toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream',
          },
        });
        i++;
        continue;
      }

      const imgOnlyMatch = trimmedLine.match(/^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)$/);
      if (imgOnlyMatch) {
        content.push({
          type: 'image',
          attrs: { src: imgOnlyMatch[2], alt: imgOnlyMatch[1] },
        });
        i++;
        continue;
      }

      // Se a linha contiver uma ou mais imagens Markdown misturadas no texto
      if (trimmedLine.includes('![') && trimmedLine.includes('](')) {
        const parts = trimmedLine.split(/(!\[[^\]]*\]\([^)]+\))/g);
        for (const part of parts) {
          const m = part.match(/^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)$/);
          if (m) {
            content.push({
              type: 'image',
              attrs: { src: m[2], alt: m[1] },
            });
          } else if (part.trim()) {
            content.push({
              type: 'paragraph',
              content: this.parseInlineText(part),
            });
          }
        }
        i++;
        continue;
      }

      // 12. Standard Paragraph
      content.push({
        type: 'paragraph',
        content: this.parseInlineText(line),
      });
      i++;
    }

    return {
      type: 'doc',
      content: content.length > 0 ? content : [{ type: 'paragraph' }],
    };
  }

  /**
   * Helper: Render an array of nodes to Markdown text
   */
  private static renderNodes(nodes: any[]): string {
    return nodes
      .map((node) => this.renderNode(node))
      .filter((text) => text !== null && text !== undefined)
      .join('\n\n');
  }

  /**
   * Helper: Render a single node to Markdown
   */
  private static renderNode(node: any): string {
    if (!node) return '';

    switch (node.type) {
      case 'documentTitle': {
        const text = this.renderInlineContent(node.content);
        return `# ${text || ''}`;
      }

      case 'heading': {
        const level = node.attrs?.level || 1;
        const prefix = '#'.repeat(level);
        const text = this.renderInlineContent(node.content);
        return `${prefix} ${text}`;
      }

      case 'paragraph': {
        const text = this.renderInlineContent(node.content);
        return text || '';
      }

      case 'blockquote': {
        const inner = this.renderNodes(node.content || []);
        return inner
          .split('\n')
          .map((l) => `> ${l}`)
          .join('\n');
      }

      case 'codeBlock': {
        const lang = node.attrs?.language || '';
        const code = node.content?.map((c: any) => c.text).join('') || '';
        if (lang === 'latex') {
          return `$$\n${code}\n$$`;
        }
        return `\`\`\`${lang}\n${code}\n\`\`\``;
      }

      case 'bulletList': {
        return (node.content || [])
          .map((item: any) => {
            const itemText = this.renderNodes(item.content || []);
            return `- ${itemText}`;
          })
          .join('\n');
      }

      case 'orderedList': {
        return (node.content || [])
          .map((item: any, idx: number) => {
            const itemText = this.renderNodes(item.content || []);
            return `${idx + 1}. ${itemText}`;
          })
          .join('\n');
      }

      case 'taskList': {
        return (node.content || [])
          .map((item: any) => {
            const checked = item.attrs?.checked ? '[x]' : '[ ]';
            const itemText = this.renderNodes(item.content || []);
            return `- ${checked} ${itemText}`;
          })
          .join('\n');
      }

      case 'taskItem': {
        const checked = node.attrs?.checked ? '[x]' : '[ ]';
        const itemText = this.renderNodes(node.content || []);
        return `- ${checked} ${itemText}`;
      }

      case 'horizontalRule':
        return '---';

      case 'image': {
        const src = node.attrs?.src || '';
        const alt = node.attrs?.alt || 'Imagem';
        return `![${alt}](${src})`;
      }

      case 'video': {
        const src = node.attrs?.src || '';
        return `[Vídeo](${src})`;
      }

      case 'fileAttachment': {
        const src = node.attrs?.src || '';
        const name = node.attrs?.fileName || 'Anexo';
        return `[Anexo: ${name}](${src})`;
      }

      case 'details': {
        const openAttr = node.attrs?.open ? ' open' : '';
        const inner = this.renderNodes(node.content || []);
        return `<details${openAttr}>\n${inner}\n</details>`;
      }

      case 'detailsSummary': {
        const text = this.renderInlineContent(node.content);
        return `<summary>${text}</summary>`;
      }

      case 'detailsContent': {
        return this.renderNodes(node.content || []);
      }

      case 'youtube': {
        const src = node.attrs?.src || '';
        return `[YouTube](${src})`;
      }

      case 'table': {
        const rows = node.content || [];
        if (rows.length === 0) return '';
        const outputRows: string[] = [];

        rows.forEach((row: any, rIdx: number) => {
          const cells = (row.content || []).map((cell: any) => {
            return this.renderNodes(cell.content || []).replace(/\n/g, ' ').replace(/\|/g, '\\|');
          });
          outputRows.push(`| ${cells.join(' | ')} |`);

          if (rIdx === 0) {
            const separator = cells.map(() => '---').join(' | ');
            outputRows.push(`| ${separator} |`);
          }
        });

        return outputRows.join('\n');
      }

      default:
        if (node.content) {
          return this.renderNodes(node.content);
        }
        return '';
    }
  }

  /**
   * Render inline marks (bold, italic, strike, highlight, link, code)
   */
  private static renderInlineContent(content?: any[]): string {
    if (!content || !Array.isArray(content)) return '';

    return content
      .map((item) => {
        let text = item.text || '';
        if (!item.marks || item.marks.length === 0) {
          return text;
        }

        for (const mark of item.marks) {
          switch (mark.type) {
            case 'bold':
              text = `**${text}**`;
              break;
            case 'italic':
              text = `*${text}*`;
              break;
            case 'underline':
              text = `<u>${text}</u>`;
              break;
            case 'strike':
              text = `~~${text}~~`;
              break;
            case 'code':
              text = `\`${text}\``;
              break;
            case 'highlight':
              text = `==${text}==`;
              break;
            case 'link': {
              const href = mark.attrs?.href || '';
              // Internal link convention: [[Note Title]]
              if (href.startsWith('note:')) {
                text = `[[${text}]]`;
              } else {
                text = `[${text}](${href})`;
              }
              break;
            }
          }
        }
        return text;
      })
      .join('');
  }

  /**
   * Helper: Parse inline Markdown formatting to Tiptap inline text nodes with marks.
   */
  private static parseInlineText(text: string): any[] {
    if (!text) return [];

    // Simple tokenizer for bold, italic, code, wiki links [[Note]], markdown links [text](url), and tags #tag
    const nodes: any[] = [];
    let remaining = text;

    while (remaining.length > 0) {
      // 0. Imagens ![alt](url) não devem ser tokenizadas como links de texto com o nome do arquivo
      const imgMatch = remaining.match(/^!\[([^\]]*)\]\(([^)]+)\)/);
      if (imgMatch) {
        remaining = remaining.slice(imgMatch[0].length);
        continue;
      }

      // 1. Wiki-link: [[Target Note]]
      const wikiMatch = remaining.match(/^\[\[([^\]]+)\]\]/);
      if (wikiMatch) {
        const noteTitle = wikiMatch[1];
        nodes.push({
          type: 'text',
          text: noteTitle,
          marks: [{ type: 'link', attrs: { href: `note:${encodeURIComponent(noteTitle)}` } }],
        });
        remaining = remaining.slice(wikiMatch[0].length);
        continue;
      }

      // 2. Markdown Link: [text](url)
      const linkMatch = remaining.match(/^\[([^\]]+)\]\(([^)]+)\)/);
      if (linkMatch) {
        nodes.push({
          type: 'text',
          text: linkMatch[1],
          marks: [{ type: 'link', attrs: { href: linkMatch[2] } }],
        });
        remaining = remaining.slice(linkMatch[0].length);
        continue;
      }

      // 3. Bold: **text**
      const boldMatch = remaining.match(/^\*\*([^*]+)\*\*/);
      if (boldMatch) {
        nodes.push({
          type: 'text',
          text: boldMatch[1],
          marks: [{ type: 'bold' }],
        });
        remaining = remaining.slice(boldMatch[0].length);
        continue;
      }

      // 4. Italic: *text*
      const italicMatch = remaining.match(/^\*([^*]+)\*/);
      if (italicMatch) {
        nodes.push({
          type: 'text',
          text: italicMatch[1],
          marks: [{ type: 'italic' }],
        });
        remaining = remaining.slice(italicMatch[0].length);
        continue;
      }

      // 5. Strikethrough: ~~text~~
      const strikeMatch = remaining.match(/^~~([^~]+)~~/);
      if (strikeMatch) {
        nodes.push({
          type: 'text',
          text: strikeMatch[1],
          marks: [{ type: 'strike' }],
        });
        remaining = remaining.slice(strikeMatch[0].length);
        continue;
      }

      // 6. Highlight: ==text==
      const highlightMatch = remaining.match(/^==([^=]+)==/);
      if (highlightMatch) {
        nodes.push({
          type: 'text',
          text: highlightMatch[1],
          marks: [{ type: 'highlight' }],
        });
        remaining = remaining.slice(highlightMatch[0].length);
        continue;
      }

      // 7. Inline code: `code`
      const codeMatch = remaining.match(/^`([^`]+)`/);
      if (codeMatch) {
        nodes.push({
          type: 'text',
          text: codeMatch[1],
          marks: [{ type: 'code' }],
        });
        remaining = remaining.slice(codeMatch[0].length);
        continue;
      }

      // Plain text up to next special char
      const nextSpecialIdx = remaining.search(/(\[\[|\[|\*\*|\*|~~|==|`)/);
      if (nextSpecialIdx === -1) {
        nodes.push({ type: 'text', text: remaining });
        break;
      } else if (nextSpecialIdx === 0) {
        // Just take 1 char
        nodes.push({ type: 'text', text: remaining[0] });
        remaining = remaining.slice(1);
      } else {
        nodes.push({ type: 'text', text: remaining.slice(0, nextSpecialIdx) });
        remaining = remaining.slice(nextSpecialIdx);
      }
    }

    return nodes.length > 0 ? nodes : [{ type: 'text', text }];
  }

  /**
   * Helper: Extract all internal note titles referenced like [[Title]] from markdown
   */
  static extractWikiLinks(markdown: string): string[] {
    const matches = markdown.matchAll(/\[\[([^\]]+)\]\]/g);
    const titles: string[] = [];
    for (const match of matches) {
      const clean = match[1].trim();
      if (clean && !titles.includes(clean)) {
        titles.push(clean);
      }
    }
    return titles;
  }

  /**
   * Helper: Extract all hashtags from markdown (#estudo, #livros)
   */
  static extractTags(markdown: string): string[] {
    // Match hashtags not in URL or heading
    const matches = markdown.matchAll(/(?:^|\s)#([a-zA-Z0-9_\u00C0-\u00FF-]+)/g);
    const tags: string[] = [];
    for (const match of matches) {
      const tag = match[1].trim();
      if (tag && !tags.includes(tag)) {
        tags.push(tag);
      }
    }
    return tags;
  }
}
