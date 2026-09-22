import { TreeNode } from '@/types';
import { indexedDbService } from './indexedDbService';
import { syncEngine } from './syncEngine';
import { realtimeService } from './realtimeService';

export type DropPlacement = 'before' | 'inside' | 'after';

export interface ReorderResult {
  success: boolean;
  nextTree: TreeNode[];
  updatedNodes: TreeNode[];
  targetParentId: string | null;
}

export const treeReorderService = {
  /**
   * Verifica se `potentialDescendantId` é descendente de `ancestorId` ou igual a ele.
   * Usado para prevenir ciclos hierárquicos.
   */
  isDescendant(
    ancestorId: string,
    potentialDescendantId: string | null,
    allNodes: TreeNode[]
  ): boolean {
    if (!potentialDescendantId) return false;
    if (ancestorId === potentialDescendantId) return true;

    const nodeMap = new Map<string, TreeNode>();
    for (const n of allNodes) {
      nodeMap.set(n.id, n);
    }

    let cur: string | null = potentialDescendantId;
    const visited = new Set<string>();

    while (cur) {
      if (cur === ancestorId) return true;
      if (visited.has(cur)) break; // Evita loop infinito em caso de ciclo corrompido
      visited.add(cur);

      const parentNode = nodeMap.get(cur);
      cur = parentNode ? parentNode.parentId : null;
    }

    return false;
  },

  /**
   * Valida se um drop é permitido para evitar ciclos e auto-inserção.
   */
  isValidDropTarget(
    draggedIds: string[],
    targetNodeId: string,
    placement: DropPlacement,
    allNodes: TreeNode[]
  ): boolean {
    for (const draggedId of draggedIds) {
      // Não pode dropar sobre si mesmo
      if (draggedId === targetNodeId) {
        return false;
      }
      // Se for dropar dentro, antes ou depois de um descendente de qualquer nó arrastado, inválido
      if (this.isDescendant(draggedId, targetNodeId, allNodes)) {
        return false;
      }
    }
    return true;
  },

  /**
   * Filtra itens selecionados redundantes:
   * Se uma pasta e um de seus descendentes estiverem ambos selecionados,
   * move apenas a pasta ancestral no grupo raiz (o descendente já vai dentro dela).
   */
  filterTopLevelSelected(selectedIds: string[], allNodes: TreeNode[]): string[] {
    const idSet = new Set(selectedIds);
    const topLevel: string[] = [];

    for (const id of selectedIds) {
      let isChildOfSelected = false;
      // Procura se algum ancestral deste id também está no idSet
      let cur = allNodes.find((n) => n.id === id)?.parentId || null;
      const visited = new Set<string>();

      while (cur) {
        if (idSet.has(cur)) {
          isChildOfSelected = true;
          break;
        }
        if (visited.has(cur)) break;
        visited.add(cur);
        const parentNode = allNodes.find((n) => n.id === cur);
        cur = parentNode ? parentNode.parentId : null;
      }

      if (!isChildOfSelected) {
        topLevel.push(id);
      }
    }

    return topLevel;
  },

  /**
   * Achata a hierarquia da árvore em uma lista linear mantendo referências.
   */
  flattenTree(nodes: TreeNode[]): TreeNode[] {
    const result: TreeNode[] = [];
    const traverse = (list: TreeNode[]) => {
      for (const n of list) {
        result.push(n);
        if (n.children && n.children.length > 0) {
          traverse(n.children);
        }
      }
    };
    traverse(nodes);
    return result;
  },

  /**
   * Constrói a hierarquia da árvore a partir de uma lista plana ordenada por `position`.
   */
  buildHierarchy(flatNodes: TreeNode[]): TreeNode[] {
    const nodeMap = new Map<string, TreeNode>();
    const roots: TreeNode[] = [];

    for (const item of flatNodes) {
      nodeMap.set(item.id, { ...item, children: [] });
    }

    for (const item of flatNodes) {
      const current = nodeMap.get(item.id)!;
      if (item.parentId && nodeMap.has(item.parentId)) {
        const parent = nodeMap.get(item.parentId)!;
        parent.children = parent.children || [];
        parent.children.push(current);
      } else {
        roots.push(current);
      }
    }

    const sortNodes = (list: TreeNode[]) => {
      list.sort((a, b) => a.position - b.position);
      for (const node of list) {
        if (node.children && node.children.length > 0) {
          sortNodes(node.children);
        }
      }
    };

    sortNodes(roots);
    return roots;
  },

  /**
   * Cálculo central de reordenação (calculateDropPosition).
   * Determina targetParentId, posição entre irmãos, e gera o novo estado da árvore.
   */
  calculateDropPosition(params: {
    tree: TreeNode[];
    draggedIds: string[];
    targetNodeId: string | null; // null = soltar na raiz
    placement: DropPlacement;
  }): ReorderResult {
    const { tree, draggedIds, targetNodeId, placement } = params;
    const allFlat = this.flattenTree(tree);

    // 1. Filtra apenas os ancestrais dos itens selecionados
    const topLevelDraggedIds = this.filterTopLevelSelected(draggedIds, allFlat);
    if (topLevelDraggedIds.length === 0) {
      return { success: false, nextTree: tree, updatedNodes: [], targetParentId: null };
    }

    // Se o target for nulo, soltar no final da raiz
    if (!targetNodeId) {
      const targetParentId = null;
      const draggedIdSet = new Set(topLevelDraggedIds);
      const draggedNodes = topLevelDraggedIds
        .map((id) => allFlat.find((n) => n.id === id))
        .filter((n): n is TreeNode => Boolean(n));

      const existingSiblings = allFlat
        .filter((n) => n.parentId === null && !draggedIdSet.has(n.id))
        .sort((a, b) => a.position - b.position);

      const newSiblings = [...existingSiblings, ...draggedNodes];
      const now = new Date().toISOString();
      const updatedNodes: TreeNode[] = [];

      newSiblings.forEach((sibling, idx) => {
        const newPos = (idx + 1) * 1000;
        const needsUpdate =
          sibling.position !== newPos ||
          sibling.parentId !== targetParentId ||
          draggedIdSet.has(sibling.id);

        if (needsUpdate) {
          sibling.position = newPos;
          sibling.parentId = targetParentId;
          sibling.updatedAt = now;
          updatedNodes.push(sibling);
        }
      });

      const nextTree = this.buildHierarchy(allFlat);
      return { success: true, nextTree, updatedNodes, targetParentId };
    }

    // 2. Valida o nó alvo
    const targetNode = allFlat.find((n) => n.id === targetNodeId);
    if (!targetNode) {
      return { success: false, nextTree: tree, updatedNodes: [], targetParentId: null };
    }

    // Validação de ciclos
    if (!this.isValidDropTarget(topLevelDraggedIds, targetNodeId, placement, allFlat)) {
      return { success: false, nextTree: tree, updatedNodes: [], targetParentId: null };
    }

    // 3. Determina targetParentId final baseado no placement
    let finalParentId: string | null = null;
    if (placement === 'inside') {
      if (targetNode.type !== 'folder') {
        // Não é permitido colocar dentro de uma nota
        return { success: false, nextTree: tree, updatedNodes: [], targetParentId: null };
      }
      finalParentId = targetNode.id;
    } else {
      // 'before' ou 'after': o item se torna irmão do targetNode
      finalParentId = targetNode.parentId;
    }

    const draggedIdSet = new Set(topLevelDraggedIds);
    // Preserva a ordem relativa que os nós arrastados já tinham na árvore
    const draggedNodes = topLevelDraggedIds
      .map((id) => allFlat.find((n) => n.id === id))
      .filter((n): n is TreeNode => Boolean(n));

    // 4. Obter irmãos existentes no pai de destino (excluindo os nós que estão sendo movidos)
    const existingSiblings = allFlat
      .filter((n) => n.parentId === finalParentId && !draggedIdSet.has(n.id))
      .sort((a, b) => a.position - b.position);

    let newSiblings: TreeNode[] = [];

    if (placement === 'inside') {
      // Inserir ao final dos filhos da pasta
      newSiblings = [...existingSiblings, ...draggedNodes];
    } else if (placement === 'before') {
      const targetIdx = existingSiblings.findIndex((n) => n.id === targetNode.id);
      if (targetIdx === -1) {
        newSiblings = [...draggedNodes, ...existingSiblings];
      } else {
        newSiblings = [
          ...existingSiblings.slice(0, targetIdx),
          ...draggedNodes,
          ...existingSiblings.slice(targetIdx),
        ];
      }
    } else {
      // 'after'
      const targetIdx = existingSiblings.findIndex((n) => n.id === targetNode.id);
      if (targetIdx === -1) {
        newSiblings = [...existingSiblings, ...draggedNodes];
      } else {
        newSiblings = [
          ...existingSiblings.slice(0, targetIdx + 1),
          ...draggedNodes,
          ...existingSiblings.slice(targetIdx + 1),
        ];
      }
    }

    // 5. Normaliza as posições de todos os irmãos afetados
    const now = new Date().toISOString();
    const updatedNodes: TreeNode[] = [];

    newSiblings.forEach((sibling, idx) => {
      const newPos = (idx + 1) * 1000;
      const needsUpdate =
        sibling.position !== newPos ||
        sibling.parentId !== finalParentId ||
        draggedIdSet.has(sibling.id);

      if (needsUpdate) {
        sibling.position = newPos;
        sibling.parentId = finalParentId;
        sibling.updatedAt = now;
        updatedNodes.push(sibling);
      }
    });

    // 6. Reconstrói a árvore completa
    const nextTree = this.buildHierarchy(allFlat);

    return {
      success: true,
      nextTree,
      updatedNodes,
      targetParentId: finalParentId,
    };
  },

  /**
   * Persiste uma reordenação em lote no IndexedDB, fila sync_queue e Supabase.
   */
  async persistReorderBatch(userId: string, updatedNodes: TreeNode[]): Promise<boolean> {
    if (updatedNodes.length === 0) return true;

    const now = new Date().toISOString();

    // 1. Registra mutações no Realtime para blindar contra eco local
    for (const node of updatedNodes) {
      node.updatedAt = now;
      realtimeService.registerLocalNodeUpdate(node.id, now);
    }

    // 2. Salva em lote no IndexedDB em transação atômica
    await indexedDbService.saveNodesBatch(updatedNodes);

    // 3. Enfileira na sync_queue para sincronização remota sem travar a UI
    for (const node of updatedNodes) {
      syncEngine.enqueueNode(node).catch((err) => {
        console.warn('[treeReorderService] Falha ao enfileirar reordenação do nó:', err);
      });
    }

    return true;
  },
};
