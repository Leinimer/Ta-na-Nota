import JSZip from 'jszip';
import { indexedDbService } from './indexedDbService';
import { TreeNode } from '@/types';

export const exportService = {
  /**
   * Exports a single note as downloadable Markdown file
   */
  async exportNoteMarkdown(nodeId: string): Promise<void> {
    const node = await indexedDbService.getNode(nodeId);
    if (!node || node.type !== 'note') return;

    const note = await indexedDbService.getNoteByNodeId(nodeId);
    const content = note?.markdownContent || `# ${node.name}\n\n`;

    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const safeTitle = node.name.replace(/[/\\?%*:|"<>]/g, '-');
    this.triggerDownload(blob, `${safeTitle}.md`);
  },

  /**
   * Exports all notes and folders organized in a ZIP archive reflecting the folder structure
   */
  async exportAllToZip(userId: string): Promise<void> {
    const zip = new JSZip();
    const [allNodes, allNotes] = await Promise.all([
      indexedDbService.getAllNodes(userId),
      indexedDbService.getAllNotes(userId),
    ]);

    const activeNodes = allNodes.filter((n) => !n.deletedAt);
    const nodeMap = new Map(activeNodes.map((n) => [n.id, n]));
    const noteMap = new Map(allNotes.map((n) => [n.nodeId, n]));

    // Helper to calculate full folder path
    const getFolderPath = (node: TreeNode): string => {
      const parts: string[] = [];
      let cur: TreeNode | undefined = node;
      while (cur && cur.parentId) {
        const parent = nodeMap.get(cur.parentId);
        if (parent) {
          parts.unshift(parent.name.replace(/[/\\?%*:|"<>]/g, '-'));
          cur = parent;
        } else {
          break;
        }
      }
      return parts.join('/');
    };

    const rootFolder = zip.folder('segundo-cerebro-export');

    for (const node of activeNodes) {
      if (node.type === 'note') {
        const note = noteMap.get(node.id);
        const mdContent = note?.markdownContent || `# ${node.name}\n\n`;
        const folderPath = getFolderPath(node);
        const fileName = `${node.name.replace(/[/\\?%*:|"<>]/g, '-')}.md`;

        if (folderPath) {
          rootFolder?.file(`${folderPath}/${fileName}`, mdContent);
        } else {
          rootFolder?.file(fileName, mdContent);
        }
      }
    }

    const zipBlob = await zip.generateAsync({ type: 'blob' });
    this.triggerDownload(zipBlob, `segundo-cerebro-export-${new Date().toISOString().slice(0, 10)}.zip`);
  },

  triggerDownload(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },
};
