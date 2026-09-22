'use client';

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { TreeNode, TagRecord, AppUser, SyncStatus, SearchResults } from '@/types';
import { TreeNodeItem, DropPlacement } from './TreeNodeItem';
import { searchService } from '@/services/searchService';
import {
  FolderPlus,
  FilePlus,
  Search,
  Star,
  Clock,
  Tag as TagIcon,
  Layers,
  CheckCircle2,
  RefreshCw,
  WifiOff,
  AlertCircle,
  Settings,
  ChevronDown,
  X,
  FileText,
  Folder,
  Download,
  ArrowLeft,
  Check,
  PanelLeftClose,
} from 'lucide-react';
import { tagService } from '@/services/tagService';
import { usePwaInstall } from '@/components/pwa/usePwaInstall';

type SearchSource = 'folders' | 'notes' | 'tags' | 'content';

// Helper recursivo para encontrar caminho de pastas pais de um nó
function findParentFolderIds(nodes: TreeNode[], targetId: string, currentPath: string[] = []): string[] | null {
  for (const n of nodes) {
    if (n.id === targetId) return currentPath;
    if (n.children && n.children.length > 0) {
      const res = findParentFolderIds(n.children, targetId, [...currentPath, n.id]);
      if (res) return res;
    }
  }
  return null;
}

interface SidebarProps {
  tree: TreeNode[];
  activeNodeId: string | null;
  expandedFolders: Set<string>;
  editingNodeId?: string | null;
  onFinishInlineEdit?: () => void;
  tags: TagRecord[];
  currentUser: AppUser | null;
  syncStatus: SyncStatus;
  onOpenAuth: () => void;
  onOpenSettings?: () => void;
  onOpenCommandPalette?: () => void;
  onToggleExpand: (folderId: string) => void;
  onSelectNode: (node: TreeNode) => void;
  onCreateFolder: (parentId?: string | null) => void;
  onCreateNote: (parentId?: string | null) => void;
  onRenameNode: (nodeId: string, newName: string) => void;
  onDeleteNode: (nodeId: string) => void;
  onSetNodeColor?: (nodeId: string, color: string | null) => void;
  onDuplicateNote: (nodeId: string) => void;
  onToggleFavorite: (nodeId: string) => void;
  onExportNote: (nodeId: string) => void;
  onExportAll: () => void;
  onMoveNode: (draggedId: string, targetParentId: string | null) => void;
  onReorderNodes?: (draggedIds: string[], targetNodeId: string | null, placement: DropPlacement) => void;
  onFilterByTag?: (tagId: string) => void;
  onCloseMobileDrawer?: () => void;
  onToggleCollapse?: () => void;
}

export function Sidebar({
  tree,
  activeNodeId,
  expandedFolders,
  editingNodeId,
  onFinishInlineEdit,
  tags,
  currentUser,
  syncStatus,
  onOpenAuth,
  onOpenSettings,
  onToggleExpand,
  onSelectNode,
  onCreateFolder,
  onCreateNote,
  onRenameNode,
  onDeleteNode,
  onSetNodeColor,
  onDuplicateNote,
  onToggleFavorite,
  onExportNote,
  onExportAll,
  onMoveNode,
  onReorderNodes,
  onFilterByTag,
  onCloseMobileDrawer,
  onToggleCollapse,
}: SidebarProps) {
  const [activeTab, setActiveTab] = useState<'tree' | 'favorites' | 'recent' | 'tags'>('tree');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSources, setSelectedSources] = useState<Set<SearchSource>>(new Set());
  const [isSourceMenuOpen, setIsSourceMenuOpen] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResults>({
    folders: [],
    notes: [],
    contentMatches: [],
    tags: [],
  });
  const [isSearching, setIsSearching] = useState(false);
  const [isRootDragOver, setIsRootDragOver] = useState(false);
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set());
  const [lastClickedNodeId, setLastClickedNodeId] = useState<string | null>(null);
  const [selectionBox, setSelectionBox] = useState<{
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
  } | null>(null);
  const isDraggingSelectionRef = useRef(false);
  const justFinishedDragRef = useRef(false);
  const treeContainerRef = useRef<HTMLDivElement>(null);
  const sourceMenuRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const { canInstall, installApp } = usePwaInstall();

  // Estado do Painel Inferior de Tags e Seleção Múltipla de Tags
  const [isTagsPanelOpen, setIsTagsPanelOpen] = useState(false);
  const [selectedTagIds, setSelectedTagIds] = useState<Set<string>>(new Set());
  const [tagNotes, setTagNotes] = useState<TreeNode[]>([]);
  const [isLoadingTagNotes, setIsLoadingTagNotes] = useState(false);
  const [showAllTagsExpanded, setShowAllTagsExpanded] = useState(false);

  // Alterna a seleção de uma tag no painel inferior
  const handleToggleTag = (tagId: string) => {
    setSelectedTagIds((prev) => {
      const next = new Set(prev);
      if (next.has(tagId)) {
        next.delete(tagId);
      } else {
        next.add(tagId);
      }
      return next;
    });
  };

  // Carrega união das notas associadas às tags selecionadas (sem duplicação)
  useEffect(() => {
    let isMounted = true;
    const loadTagNotes = async () => {
      if (selectedTagIds.size === 0 || !currentUser?.id) {
        setTagNotes([]);
        setIsLoadingTagNotes(false);
        return;
      }
      setIsLoadingTagNotes(true);
      try {
        const notes = await tagService.getNotesForMultipleTags(
          Array.from(selectedTagIds),
          currentUser.id
        );
        if (isMounted) {
          setTagNotes(notes);
        }
      } catch (err) {
        console.warn('Erro ao carregar notas das tags:', err);
        if (isMounted) setTagNotes([]);
      } finally {
        if (isMounted) setIsLoadingTagNotes(false);
      }
    };

    loadTagNotes();
    return () => {
      isMounted = false;
    };
  }, [selectedTagIds, currentUser?.id]);

  // Ao clicar em uma nota resultante de tag:
  // 1. Abre a nota normalmente
  // 2. Localiza na árvore real, expande todos os pais necessários e destaca a nota
  const handleSelectTagNote = (note: TreeNode) => {
    const parentFolderIds = findParentFolderIds(tree, note.id);
    if (parentFolderIds && parentFolderIds.length > 0) {
      parentFolderIds.forEach((parentId) => {
        if (!expandedFolders.has(parentId)) {
          onToggleExpand(parentId);
        }
      });
    }

    if (activeTab !== 'tree') {
      setActiveTab('tree');
    }

    setSelectedNodeIds(new Set([note.id]));
    setLastClickedNodeId(note.id);

    const targetNode = findNodeInTree(note.id, tree) || note;
    onSelectNode(targetNode);
    if (onCloseMobileDrawer) onCloseMobileDrawer();
  };

  const handleOpenTagInPanel = (tag: { id: string; name: string }) => {
    setIsTagsPanelOpen(true);
    setSelectedTagIds((prev) => new Set(prev).add(tag.id));
    if (activeTab !== 'tree') {
      setActiveTab('tree');
    }
  };

  // Tecla Escape para deselecionar itens múltiplos
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedNodeIds(new Set());
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Limpa a seleção quando o usuário clica fora (editor, topbar, área vazia da sidebar/árvore)
  // Mas ignora cliques em nós da árvore, barra de seleção, controles e botões
  useEffect(() => {
    if (selectedNodeIds.size === 0) return;

    const handlePointerDown = (event: PointerEvent) => {
      // Se acabou de fazer um drag de seleção ou está arrastando, não limpar
      if (isDraggingSelectionRef.current || justFinishedDragRef.current) return;

      const target = event.target as HTMLElement | null;
      if (!target) return;

      // 1. Não limpar se clicar em item da árvore (deixa handleNodeClick gerenciar)
      if (target.closest('[data-tree-node-id]') || target.closest('[id^="tree-node-"]')) {
        return;
      }

      // 2. Não limpar se clicar na barra de seleção ou no botão "Limpar seleção"
      if (target.closest('[data-selection-toolbar]')) {
        return;
      }

      // 3. Não limpar se clicar em controles da sidebar, inputs, menus contextuais ou botões
      if (
        target.closest('[data-sidebar-control]') ||
        target.closest('button') ||
        target.closest('input') ||
        target.closest('[role="menu"]') ||
        target.closest('.context-menu')
      ) {
        return;
      }

      // Se clicou em qualquer outro lugar (no editor, fora da sidebar, ou em espaço vazio da árvore):
      setSelectedNodeIds(new Set());
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [selectedNodeIds.size]);

  // Fecha menu de fontes se clicar fora
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (sourceMenuRef.current && !sourceMenuRef.current.contains(e.target as Node)) {
        setIsSourceMenuOpen(false);
      }
    };
    if (isSourceMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isSourceMenuOpen]);

  const handleClearSearch = () => {
    setSearchQuery('');
    setSearchResults({ folders: [], notes: [], contentMatches: [], tags: [] });
    setIsSearching(false);
  };

  // Busca rápida e reativa no IndexedDB
  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) {
      return;
    }

    let isCurrent = true;
    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const res = await searchService.search(q, currentUser?.id || '');
        if (isCurrent) {
          setSearchResults(res);
          setIsSearching(false);
        }
      } catch (err) {
        console.warn('[Sidebar] Erro na busca:', err);
        if (isCurrent) {
          setIsSearching(false);
        }
      }
    }, 100);

    return () => {
      isCurrent = false;
      clearTimeout(timer);
    };
  }, [searchQuery, currentUser?.id]);

  const toggleSource = (source: SearchSource) => {
    setSelectedSources((prev) => {
      const next = new Set(prev);
      if (next.has(source)) {
        next.delete(source);
      } else {
        next.add(source);
      }
      return next;
    });
  };

  // Helper para buscar qualquer nó na árvore
  const findNodeInTree = (nodeId: string, list: TreeNode[]): TreeNode | null => {
    for (const item of list) {
      if (item.id === nodeId) return item;
      if (item.children && item.children.length > 0) {
        const found = findNodeInTree(nodeId, item.children);
        if (found) return found;
      }
    }
    return null;
  };

  // Collect flat list of notes for favorites and recent
  const getAllNotesFlat = (nodes: TreeNode[]): TreeNode[] => {
    let result: TreeNode[] = [];
    for (const node of nodes) {
      if (node.type === 'note' && !node.deletedAt) {
        result.push(node);
      }
      if (node.children) {
        result = result.concat(getAllNotesFlat(node.children));
      }
    }
    return result;
  };

  const allNotes = getAllNotesFlat(tree);
  const favoriteNotes = allNotes.filter((n) => n.isFavorite);
  const recentNotes = [...allNotes]
    .sort((a, b) => {
      const timeA = a.lastOpenedAt ? new Date(a.lastOpenedAt).getTime() : 0;
      const timeB = b.lastOpenedAt ? new Date(b.lastOpenedAt).getTime() : 0;
      return timeB - timeA;
    })
    .slice(0, 10);

  // Determina quais fontes exibir
  const showAllSources = selectedSources.size === 0;
  const showFolders = showAllSources || selectedSources.has('folders');
  const showNotes = showAllSources || selectedSources.has('notes');
  const showTags = showAllSources || selectedSources.has('tags');
  const showContent = showAllSources || selectedSources.has('content');

  const visibleFolders = showFolders ? searchResults.folders : [];
  const visibleNotes = showNotes ? searchResults.notes : [];
  const visibleTags = showTags ? searchResults.tags : [];
  const visibleContent = showContent ? searchResults.contentMatches : [];

  const totalMatches =
    visibleFolders.length + visibleNotes.length + visibleTags.length + visibleContent.length;

  // Lista plana de nós visíveis na árvore (para seleção por intervalo e colisão do marquee)
  const visibleTreeNodes = useMemo(() => {
    const result: TreeNode[] = [];
    const traverse = (nodes: TreeNode[]) => {
      for (const n of nodes) {
        result.push(n);
        if (n.type === 'folder' && expandedFolders.has(n.id) && n.children && n.children.length > 0) {
          traverse(n.children);
        }
      }
    };
    traverse(tree);
    return result;
  }, [tree, expandedFolders]);

  // Helper para verificar se um nó é descendente de outro (evita ciclos de hierarquia)
  const isDescendant = useCallback(
    (ancestorId: string, potentialDescendantId: string | null, nodes: TreeNode[]): boolean => {
      if (!potentialDescendantId) return false;
      if (ancestorId === potentialDescendantId) return true;

      const findNode = (list: TreeNode[], id: string): TreeNode | null => {
        for (const n of list) {
          if (n.id === id) return n;
          if (n.children && n.children.length > 0) {
            const found = findNode(n.children, id);
            if (found) return found;
          }
        }
        return null;
      };

      const targetNode = findNode(nodes, potentialDescendantId);
      if (!targetNode) return false;

      let currParent = targetNode.parentId;
      while (currParent) {
        if (currParent === ancestorId) return true;
        const pNode = findNode(nodes, currParent);
        currParent = pNode ? pNode.parentId : null;
      }
      return false;
    },
    []
  );

  // Filtra itens redundantes da seleção: se uma pasta pai e seus filhos estão ambos selecionados,
  // move apenas a pasta pai para evitar inconsistências de hierarquia.
  const filterTopLevelSelected = useCallback((ids: string[], nodes: TreeNode[]): string[] => {
    const idSet = new Set(ids);
    return ids.filter((id) => {
      const findNode = (list: TreeNode[], targetId: string): TreeNode | null => {
        for (const n of list) {
          if (n.id === targetId) return n;
          if (n.children && n.children.length > 0) {
            const f = findNode(n.children, targetId);
            if (f) return f;
          }
        }
        return null;
      };
      const n = findNode(nodes, id);
      let p = n ? n.parentId : null;
      while (p) {
        if (idSet.has(p)) return false; // Um ancestral já está no grupo a mover!
        const pNode = findNode(nodes, p);
        p = pNode ? pNode.parentId : null;
      }
      return true;
    });
  }, []);

  // Move múltiplos nós selecionados juntos
  const handleMoveMultipleNodes = useCallback(
    (draggedIds: string[], targetParentId: string | null) => {
      const topLevelIds = filterTopLevelSelected(draggedIds, tree);
      for (const id of topLevelIds) {
        if (id === targetParentId) continue;
        if (targetParentId && isDescendant(id, targetParentId, tree)) continue;
        onMoveNode(id, targetParentId);
      }
    },
    [filterTopLevelSelected, isDescendant, onMoveNode, tree]
  );

  // Reordena nós suportando Before, Inside e After com preservação hierárquica e posicional
  const handleReorderNodes = useCallback(
    (draggedIds: string[], targetNodeId: string | null, placement: DropPlacement) => {
      if (onReorderNodes) {
        onReorderNodes(draggedIds, targetNodeId, placement);
      } else {
        if (placement === 'inside') {
          handleMoveMultipleNodes(draggedIds, targetNodeId);
        } else {
          const targetNode = visibleTreeNodes.find((n) => n.id === targetNodeId);
          const parentId = targetNode ? targetNode.parentId : null;
          handleMoveMultipleNodes(draggedIds, parentId);
        }
      }
    },
    [onReorderNodes, handleMoveMultipleNodes, visibleTreeNodes]
  );

  // Clique em um nó da árvore (suporta Ctrl/Cmd para toggle, Shift para range, e clique simples para seleção/navegação)
  const handleNodeClick = (node: TreeNode, e: React.MouseEvent) => {
    // 1. Ctrl / Cmd + clique: toggle de seleção em qualquer posição da árvore
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      e.stopPropagation();
      setSelectedNodeIds((prev) => {
        const next = new Set(prev);
        if (next.has(node.id)) {
          next.delete(node.id);
        } else {
          next.add(node.id);
        }
        return next;
      });
      setLastClickedNodeId(node.id);
      return;
    }

    // 2. Shift + clique: seleção por intervalo entre último clicado e o item atual
    if (e.shiftKey && lastClickedNodeId) {
      e.preventDefault();
      e.stopPropagation();
      const startIdx = visibleTreeNodes.findIndex((n) => n.id === lastClickedNodeId);
      const endIdx = visibleTreeNodes.findIndex((n) => n.id === node.id);
      if (startIdx !== -1 && endIdx !== -1) {
        const min = Math.min(startIdx, endIdx);
        const max = Math.max(startIdx, endIdx);
        const rangeNodes = visibleTreeNodes.slice(min, max + 1);
        setSelectedNodeIds((prev) => {
          const next = new Set(prev);
          rangeNodes.forEach((n) => next.add(n.id));
          return next;
        });
      }
      return;
    }

    // 3. Clique simples: seleciona o item e abre nota ou expande pasta
    setSelectedNodeIds(new Set([node.id]));
    setLastClickedNodeId(node.id);
    if (node.type === 'folder') {
      onToggleExpand(node.id);
    } else {
      onSelectNode(node);
      if (onCloseMobileDrawer) onCloseMobileDrawer();
    }
  };

  // Arraste com o mouse em áreas vazias ou sobre itens para criar o retângulo de seleção visual
  const handleTreeContainerMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return; // Apenas botão principal (esquerdo)
    const target = e.target as HTMLElement;
    // Não iniciar seleção de caixa se clicar em botões, chevrons, inputs, menus, barra de seleção ou controles
    if (
      target.closest('button') ||
      target.closest('input') ||
      target.closest('[role="menu"]') ||
      target.closest('.context-menu') ||
      target.closest('[data-selection-toolbar]') ||
      target.closest('[data-sidebar-control]') ||
      target.closest('[title="Arrastar para mover"]')
    ) {
      return;
    }

    const clickedNodeElement =
      target.closest('[data-tree-node-id]') || target.closest('[id^="tree-node-"]');

    const startX = e.clientX;
    const startY = e.clientY;
    let hasMoved = false;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const dx = Math.abs(moveEvent.clientX - startX);
      const dy = Math.abs(moveEvent.clientY - startY);
      if (!hasMoved && (dx > 5 || dy > 5)) {
        hasMoved = true;
        isDraggingSelectionRef.current = true;
      }
      if (!hasMoved) return;

      const currentX = moveEvent.clientX;
      const currentY = moveEvent.clientY;

      setSelectionBox({
        startX,
        startY,
        currentX,
        currentY,
      });

      const boxL = Math.min(startX, currentX);
      const boxR = Math.max(startX, currentX);
      const boxT = Math.min(startY, currentY);
      const boxB = Math.max(startY, currentY);

      const newlySelected = new Set<string>();
      for (const n of visibleTreeNodes) {
        const el = document.getElementById(`tree-node-${n.id}`);
        if (el) {
          const r = el.getBoundingClientRect();
          const overlaps = !(boxR < r.left || boxL > r.right || boxB < r.top || boxT > r.bottom);
          if (overlaps) {
            newlySelected.add(n.id);
          }
        }
      }

      setSelectedNodeIds((prev) => {
        if (moveEvent.ctrlKey || moveEvent.metaKey) {
          const combined = new Set(prev);
          newlySelected.forEach((id) => combined.add(id));
          return combined;
        }
        return newlySelected;
      });
    };

    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      setSelectionBox(null);

      if (hasMoved) {
        // Ao soltar o mouse após arrastar:
        // A SELEÇÃO CONTINUA! Não limpar selectedNodeIds no mouseup!
        isDraggingSelectionRef.current = false;
        justFinishedDragRef.current = true;
        setTimeout(() => {
          justFinishedDragRef.current = false;
        }, 150);
        return;
      }

      // Se não houve movimento e o clique ocorreu em espaço vazio da árvore:
      // limpa a seleção
      if (!clickedNodeElement) {
        setSelectedNodeIds(new Set());
        setLastClickedNodeId(null);
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  // Root drop handler (move para a raiz, suportando nó único ou múltiplos)
  const handleRootDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsRootDragOver(false);

    let multipleIds: string[] = [];
    try {
      const jsonData = e.dataTransfer.getData('application/json');
      if (jsonData) {
        const parsed = JSON.parse(jsonData);
        if (Array.isArray(parsed.ids) && parsed.ids.length > 0) {
          multipleIds = parsed.ids;
        }
      }
    } catch {
      multipleIds = [];
    }

    if (multipleIds.length === 0) {
      const singleId = e.dataTransfer.getData('text/plain');
      if (singleId) multipleIds = [singleId];
    }

    if (multipleIds.length > 0) {
      handleReorderNodes(multipleIds, null, 'after');
    }
  };

  const handleOpenSettingsPanel = onOpenSettings || onOpenAuth;

  return (
    <aside
      id="app-sidebar"
      ref={sidebarRef}
      className="w-full h-full flex flex-col bg-[#F9F7F2] border-r border-[#E3DCD2] text-[#3D352E] select-none"
    >
      {/* 1. Topo da Sidebar: [logo] Tá na nota */}
      <div className="p-3.5 border-b border-[#E3DCD2] shrink-0 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-[#8C7B6E] text-[#F9F7F2] flex items-center justify-center font-handwritten text-xl font-bold shadow-xs">
            T
          </div>
          <h1 className="font-handwritten text-2xl font-bold tracking-normal leading-none text-[#8C7B6E]">
            Tá na nota
          </h1>
        </div>
        {onToggleCollapse && (
          <button
            type="button"
            id="btn-collapse-sidebar"
            onClick={onToggleCollapse}
            className="hidden md:flex items-center justify-center p-1.5 rounded-lg text-[#8C7B6E] hover:text-[#3D352E] hover:bg-[#E3DCD2]/60 transition-colors cursor-pointer"
            aria-label="Recolher sidebar"
            title="Recolher sidebar"
          >
            <PanelLeftClose className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* 2. Barra de Busca com Botão de Filtro de Fonte Integrado */}
      <div ref={sourceMenuRef} className="p-2.5 border-b border-[#E3DCD2] shrink-0 relative">
        <div className="flex items-center gap-1.5 bg-[#FEFDFA] border border-[#E3DCD2] rounded-lg px-2.5 py-1.5 text-xs focus-within:border-[#8C7B6E] focus-within:ring-1 focus-within:ring-[#8C7B6E]/30 transition-all shadow-2xs">
          <Search className="w-3.5 h-3.5 text-[#8C7B6E] shrink-0" />
          <input
            id="sidebar-search-input"
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar notas, tags..."
            className="w-full bg-transparent border-none outline-none text-[#3D352E] placeholder-[#8C7B6E]/70 text-xs py-0.5"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={handleClearSearch}
              className="p-0.5 text-[#8C7B6E] hover:text-[#3D352E] rounded transition-colors shrink-0 cursor-pointer"
              title="Limpar busca"
              aria-label="Limpar busca"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            id="btn-sidebar-search-source"
            type="button"
            onClick={() => setIsSourceMenuOpen((prev) => !prev)}
            className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium transition-colors shrink-0 cursor-pointer ${
              selectedSources.size > 0
                ? 'bg-[#8C7B6E] text-[#F9F7F2]'
                : 'bg-[#E3DCD2] text-[#8C7B6E] hover:text-[#3D352E]'
            }`}
            title="Filtrar fonte de busca"
            aria-label="Filtrar fonte de busca"
          >
            <span>Fonte</span>
            <ChevronDown
              className={`w-3 h-3 transition-transform duration-150 ${
                isSourceMenuOpen ? 'rotate-180' : ''
              }`}
            />
          </button>
        </div>

        {/* Dropdown compacto e integrado à barra de pesquisa (sem modal / sem popup) */}
        {isSourceMenuOpen && (
          <div
            id="sidebar-search-sources-panel"
            className="mt-1.5 p-2.5 bg-[#FEFDFA] border border-[#E3DCD2] rounded-lg shadow-sm text-xs space-y-1.5 z-20"
          >
            <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-[#8C7B6E] pb-1 border-b border-[#E3DCD2]">
              <span>Fonte de busca</span>
              {selectedSources.size > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedSources(new Set())}
                  className="text-[10px] text-[#8C7B6E] hover:text-[#3D352E] lowercase underline font-normal cursor-pointer"
                >
                  limpar filtros
                </button>
              )}
            </div>

            <label className="flex items-center gap-2 cursor-pointer text-[#3D352E] hover:text-[#8C7B6E] text-xs py-0.5 select-none">
              <input
                type="checkbox"
                checked={selectedSources.has('folders')}
                onChange={() => toggleSource('folders')}
                className="w-3.5 h-3.5 rounded border-[#D9C5B2] text-[#8C7B6E] focus:ring-[#8C7B6E] accent-[#8C7B6E] cursor-pointer"
              />
              <span>Pastas</span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer text-[#3D352E] hover:text-[#8C7B6E] text-xs py-0.5 select-none">
              <input
                type="checkbox"
                checked={selectedSources.has('notes')}
                onChange={() => toggleSource('notes')}
                className="w-3.5 h-3.5 rounded border-[#D9C5B2] text-[#8C7B6E] focus:ring-[#8C7B6E] accent-[#8C7B6E] cursor-pointer"
              />
              <span>Notas</span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer text-[#3D352E] hover:text-[#8C7B6E] text-xs py-0.5 select-none">
              <input
                type="checkbox"
                checked={selectedSources.has('tags')}
                onChange={() => toggleSource('tags')}
                className="w-3.5 h-3.5 rounded border-[#D9C5B2] text-[#8C7B6E] focus:ring-[#8C7B6E] accent-[#8C7B6E] cursor-pointer"
              />
              <span>Tags</span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer text-[#3D352E] hover:text-[#8C7B6E] text-xs py-0.5 select-none">
              <input
                type="checkbox"
                checked={selectedSources.has('content')}
                onChange={() => toggleSource('content')}
                className="w-3.5 h-3.5 rounded border-[#D9C5B2] text-[#8C7B6E] focus:ring-[#8C7B6E] accent-[#8C7B6E] cursor-pointer"
              />
              <span>Conteúdo</span>
            </label>
          </div>
        )}
      </div>

      {/* 3. Área Central Rolável (Resultados da Busca OU Árvore/Abas) */}
      <div
        id="sidebar-tree-container"
        ref={treeContainerRef}
        onMouseDown={handleTreeContainerMouseDown}
        onDragOver={(e) => {
          e.preventDefault();
          setIsRootDragOver(true);
        }}
        onDragLeave={() => setIsRootDragOver(false)}
        onDrop={handleRootDrop}
        className={`flex-1 overflow-y-auto px-2 py-1 custom-scrollbar min-h-0 ${
          isRootDragOver ? 'bg-[#D9C5B2]/30 ring-2 ring-dashed ring-[#8C7B6E]' : ''
        }`}
      >
        {/* Se houver texto de busca: exibe resultados reativos diretamente na Sidebar */}
        {searchQuery.trim() ? (
          <div className="space-y-3 py-1">
            <div className="px-2 py-0.5 text-[11px] font-semibold tracking-wider text-[#8C7B6E] uppercase flex items-center justify-between">
              <span>Resultados da busca</span>
              <span className="text-[10px] font-normal text-[#8C7B6E]/80">
                {totalMatches} {totalMatches === 1 ? 'encontrado' : 'encontrados'}
              </span>
            </div>

            {totalMatches === 0 && !isSearching && (
              <div className="py-8 text-center text-xs text-[#8C7B6E]/70 italic">
                Nenhum resultado para &quot;{searchQuery}&quot;.
              </div>
            )}

            {/* Pastas */}
            {visibleFolders.length > 0 && (
              <div className="space-y-1">
                <div className="px-2 text-[10px] font-semibold uppercase tracking-wider text-[#8C7B6E]/90 flex items-center gap-1.5">
                  <Folder className="w-3 h-3 text-[#8C7B6E]" />
                  <span>Pastas ({visibleFolders.length})</span>
                </div>
                {visibleFolders.map((folder) => (
                  <div
                    key={`search-folder-${folder.id}`}
                    onClick={() => {
                      onToggleExpand(folder.id);
                      if (onCloseMobileDrawer) onCloseMobileDrawer();
                    }}
                    className="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs cursor-pointer hover:bg-[#E3DCD2] text-[#3D352E] transition-colors"
                  >
                    <Folder className="w-3.5 h-3.5 text-[#8C7B6E] shrink-0" />
                    <span className="truncate font-medium">{folder.name}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Notas */}
            {visibleNotes.length > 0 && (
              <div className="space-y-1">
                <div className="px-2 text-[10px] font-semibold uppercase tracking-wider text-[#8C7B6E]/90 flex items-center gap-1.5">
                  <FileText className="w-3 h-3 text-[#8C7B6E]" />
                  <span>Notas ({visibleNotes.length})</span>
                </div>
                {visibleNotes.map((note) => (
                  <div
                    key={`search-note-${note.id}`}
                    onClick={() => {
                      const target = findNodeInTree(note.nodeId, tree);
                      if (target) {
                        onSelectNode(target);
                      } else {
                        onSelectNode({
                          id: note.nodeId,
                          userId: currentUser?.id || '',
                          parentId: null,
                          type: 'note',
                          name: note.name,
                          position: 0,
                          createdAt: '',
                          updatedAt: '',
                        });
                      }
                      if (onCloseMobileDrawer) onCloseMobileDrawer();
                    }}
                    className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs cursor-pointer transition-colors ${
                      activeNodeId === note.nodeId
                        ? 'bg-[#D9C5B2] font-medium text-[#3D352E]'
                        : 'hover:bg-[#E3DCD2] text-[#3D352E]'
                    }`}
                  >
                    <FileText className="w-3.5 h-3.5 text-[#8C7B6E] shrink-0" />
                    <span className="truncate">{note.name}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Conteúdo das Notas */}
            {visibleContent.length > 0 && (
              <div className="space-y-1">
                <div className="px-2 text-[10px] font-semibold uppercase tracking-wider text-[#8C7B6E]/90 flex items-center gap-1.5">
                  <FileText className="w-3 h-3 text-[#8C7B6E]" />
                  <span>Conteúdo ({visibleContent.length})</span>
                </div>
                {visibleContent.map((match) => (
                  <div
                    key={`search-content-${match.id}`}
                    onClick={() => {
                      const target = findNodeInTree(match.nodeId, tree);
                      if (target) {
                        onSelectNode(target);
                      } else {
                        onSelectNode({
                          id: match.nodeId,
                          userId: currentUser?.id || '',
                          parentId: null,
                          type: 'note',
                          name: match.name,
                          position: 0,
                          createdAt: '',
                          updatedAt: '',
                        });
                      }
                      if (onCloseMobileDrawer) onCloseMobileDrawer();
                    }}
                    className={`flex flex-col gap-0.5 px-2.5 py-1.5 rounded-md text-xs cursor-pointer transition-colors ${
                      activeNodeId === match.nodeId
                        ? 'bg-[#D9C5B2] text-[#3D352E]'
                        : 'hover:bg-[#E3DCD2] text-[#3D352E]'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 font-medium truncate">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#8C7B6E] shrink-0" />
                      <span className="truncate">{match.name}</span>
                    </div>
                    <p className="text-[11px] text-[#8C7B6E] line-clamp-2 pl-3 italic">
                      {match.snippet}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {/* Tags */}
            {visibleTags.length > 0 && (
              <div className="space-y-1">
                <div className="px-2 text-[10px] font-semibold uppercase tracking-wider text-[#8C7B6E]/90 flex items-center gap-1.5">
                  <TagIcon className="w-3 h-3 text-[#8C7B6E]" />
                  <span>Tags ({visibleTags.length})</span>
                </div>
                <div className="flex flex-wrap gap-1 px-2 pt-0.5">
                  {visibleTags.map((tag) => (
                    <button
                      key={`search-tag-${tag.id}`}
                      onClick={() => {
                        handleOpenTagInPanel(tag);
                        handleClearSearch();
                      }}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-[#E3DCD2] border border-[#D9C5B2] hover:bg-[#D9C5B2] transition-colors cursor-pointer text-[#3D352E]"
                    >
                      <span className="font-mono font-medium text-[#8C7B6E]">#{tag.name}</span>
                      {typeof tag.noteCount === 'number' && (
                        <span className="text-[10px] text-[#8C7B6E] bg-[#D9C5B2]/60 px-1 rounded">
                          {tag.noteCount}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <>
            {/* Tab 1: Tree View */}
            {activeTab === 'tree' && (
              <div className="space-y-0.5">
                {selectedTagIds.size > 0 ? (
                  /* Modo Temporário: Exibe Notas das Tags Selecionadas */
                  <div className="space-y-2 py-1 select-none animate-in fade-in duration-100">
                    <div className="flex items-center justify-between pb-1.5 border-b border-[#E3DCD2]">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-[#5C5046]">
                        <TagIcon className="w-3.5 h-3.5 text-[#8C7B6E]" />
                        <span>NOTAS DAS TAGS</span>
                        <span className="text-[10px] text-[#8C7B6E] bg-[#E3DCD2] px-1.5 py-0.2 rounded-full font-medium">
                          {tagNotes.length}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSelectedTagIds(new Set())}
                        className="inline-flex items-center gap-1 text-[11px] text-[#8C7B6E] hover:text-[#3D352E] px-1.5 py-0.5 rounded hover:bg-[#E3DCD2] transition-colors cursor-pointer"
                        title="Limpar filtro de tags e voltar para a árvore"
                      >
                        <X className="w-3 h-3" />
                        <span>Limpar</span>
                      </button>
                    </div>

                    {/* Badges das tags selecionadas */}
                    <div className="flex flex-wrap gap-1">
                      {Array.from(selectedTagIds).map((tId) => {
                        const tag = tags.find((t) => t.id === tId);
                        if (!tag) return null;
                        return (
                          <button
                            key={tag.id}
                            type="button"
                            onClick={() => handleToggleTag(tag.id)}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono bg-[#D9C5B2] text-[#3D352E] hover:bg-[#D9C5B2]/80 transition-colors cursor-pointer shadow-2xs group"
                            title="Clique para desmarcar tag"
                          >
                            <span>#{tag.name}</span>
                            <X className="w-2.5 h-2.5 opacity-60 group-hover:opacity-100" />
                          </button>
                        );
                      })}
                    </div>

                    {/* Lista das Notas da União das Tags */}
                    {isLoadingTagNotes ? (
                      <div className="py-8 text-center text-xs text-[#8C7B6E] animate-pulse">
                        Carregando notas...
                      </div>
                    ) : tagNotes.length === 0 ? (
                      <div className="py-8 text-center text-xs text-[#8C7B6E]/70 italic px-2">
                        Nenhuma nota associada às tags selecionadas.
                      </div>
                    ) : (
                      <div className="space-y-0.5">
                        {tagNotes.map((note) => {
                          const isNoteActive = activeNodeId === note.id;
                          return (
                            <div
                              key={note.id}
                              onClick={() => handleSelectTagNote(note)}
                              className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs cursor-pointer transition-colors ${
                                isNoteActive
                                  ? 'bg-[#D9C5B2] font-semibold text-[#3D352E]'
                                  : 'text-[#3D352E] hover:bg-[#E3DCD2]'
                              }`}
                            >
                              <FileText className="w-3.5 h-3.5 text-[#8C7B6E] shrink-0" />
                              <span className="truncate flex-1">{note.name || 'Sem título'}</span>
                              {note.isFavorite && (
                                <Star className="w-3 h-3 fill-amber-500 text-amber-500 shrink-0" />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    {selectedNodeIds.size > 0 && (
                      <div
                        data-selection-toolbar="true"
                        className="mx-1 mb-2 px-2.5 py-1 bg-[#E3DCD2] border border-[#D9C5B2] rounded-md text-xs text-[#3D352E] flex items-center justify-between animate-in fade-in select-none shadow-2xs"
                      >
                        <span className="font-medium text-[11px] text-[#5C5046]">
                          {selectedNodeIds.size} {selectedNodeIds.size === 1 ? 'selecionado' : 'selecionados'}
                        </span>
                        <button
                          type="button"
                          data-selection-toolbar="true"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedNodeIds(new Set());
                          }}
                          className="inline-flex items-center gap-1 text-[#8C7B6E] hover:text-[#3D352E] font-medium text-[11px] transition-colors cursor-pointer px-1.5 py-0.5 rounded hover:bg-[#D9C5B2]/50"
                          title="Limpar seleção"
                          aria-label="Limpar seleção"
                        >
                          <span>Limpar</span>
                          <span className="text-xs font-bold leading-none">×</span>
                        </button>
                      </div>
                    )}

                    {tree.length === 0 ? (
                      <div className="py-8 text-center text-xs text-[#8C7B6E]/70 italic">
                        Nenhuma pasta ou nota criada ainda.
                      </div>
                    ) : (
                      tree.map((node) => (
                        <TreeNodeItem
                          key={node.id}
                          node={node}
                          level={0}
                          activeNodeId={activeNodeId}
                          expandedFolders={expandedFolders}
                          editingNodeId={editingNodeId}
                          selectedNodeIds={selectedNodeIds}
                          onNodeClick={handleNodeClick}
                          onFinishInlineEdit={onFinishInlineEdit}
                          onToggleExpand={onToggleExpand}
                          onSelectNode={(n) => {
                            onSelectNode(n);
                            if (onCloseMobileDrawer) onCloseMobileDrawer();
                          }}
                          onCreateChildNote={onCreateNote}
                          onCreateChildFolder={onCreateFolder}
                          onRenameNode={onRenameNode}
                          onDeleteNode={onDeleteNode}
                          onSetNodeColor={onSetNodeColor}
                          onDuplicateNote={onDuplicateNote}
                          onToggleFavorite={onToggleFavorite}
                          onExportNote={onExportNote}
                          onMoveNode={onMoveNode}
                          onMoveMultipleNodes={handleMoveMultipleNodes}
                          onReorderNodes={handleReorderNodes}
                        />
                      ))
                    )}
                  </>
                )}
              </div>
            )}

            {/* Tab 2: Favorites */}
            {activeTab === 'favorites' && (
              <div className="space-y-1">
                <div className="px-2 py-1 text-[11px] font-semibold tracking-wider text-[#8C7B6E] uppercase">
                  Notas Favoritas
                </div>
                {favoriteNotes.length === 0 ? (
                  <div className="py-6 text-center text-xs text-[#8C7B6E]/70 italic">
                    Nenhuma nota favoritada. Clique na estrela em qualquer nota para fixá-la aqui.
                  </div>
                ) : (
                  favoriteNotes.map((note) => (
                    <div
                      key={note.id}
                      onClick={() => {
                        onSelectNode(note);
                        if (onCloseMobileDrawer) onCloseMobileDrawer();
                      }}
                      className={`flex items-center justify-between px-2.5 py-1.5 rounded-md text-xs cursor-pointer transition-colors ${
                        activeNodeId === note.id
                          ? 'bg-[#D9C5B2] font-medium text-[#3D352E]'
                          : 'hover:bg-[#E3DCD2] text-[#3D352E]'
                      }`}
                    >
                      <span className="truncate">{note.name}</span>
                      <Star className="w-3.5 h-3.5 fill-amber-500 text-amber-500 shrink-0" />
                    </div>
                  ))
                )}
              </div>
            )}

            {/* Tab 3: Recents */}
            {activeTab === 'recent' && (
              <div className="space-y-1">
                <div className="px-2 py-1 text-[11px] font-semibold tracking-wider text-[#8C7B6E] uppercase">
                  Abertas Recentemente
                </div>
                {recentNotes.length === 0 ? (
                  <div className="py-6 text-center text-xs text-[#8C7B6E]/70 italic">
                    Nenhuma nota visualizada recentemente.
                  </div>
                ) : (
                  recentNotes.map((note) => (
                    <div
                      key={note.id}
                      onClick={() => {
                        onSelectNode(note);
                        if (onCloseMobileDrawer) onCloseMobileDrawer();
                      }}
                      className={`flex items-center justify-between px-2.5 py-1.5 rounded-md text-xs cursor-pointer transition-colors ${
                        activeNodeId === note.id
                          ? 'bg-[#D9C5B2] font-medium text-[#3D352E]'
                          : 'hover:bg-[#E3DCD2] text-[#3D352E]'
                      }`}
                    >
                      <span className="truncate">{note.name}</span>
                      <span className="text-[10px] text-[#8C7B6E]">
                        {note.lastOpenedAt
                          ? new Date(note.lastOpenedAt).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })
                          : ''}
                      </span>
                    </div>
                  ))
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* 3b. PAINEL INFERIOR DE TAGS (quando isTagsPanelOpen for true) */}
      {isTagsPanelOpen && (
        <div
          id="sidebar-tags-bottom-panel"
          className={`shrink-0 border-t border-[#D9C5B2] bg-[#F9F7F2] flex flex-col transition-all duration-200 shadow-xs select-none ${
            showAllTagsExpanded ? 'h-[270px] max-h-[48%]' : 'h-[165px] max-h-[35%]'
          }`}
        >
          {/* Cabeçalho do painel inferior de tags */}
          <div className="px-2.5 py-1.5 border-b border-[#E3DCD2] flex items-center justify-between shrink-0 bg-[#F4EFEB]">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-[#5C5046]">
              <TagIcon className="w-3.5 h-3.5 text-[#8C7B6E]" />
              <span>TAGS ({tags.length})</span>
              {selectedTagIds.size > 0 && (
                <span className="text-[10px] bg-[#8C7B6E] text-white px-1.5 py-0.2 rounded-full font-medium">
                  {selectedTagIds.size} selecionada{selectedTagIds.size > 1 ? 's' : ''}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {selectedTagIds.size > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedTagIds(new Set())}
                  className="text-[11px] text-[#8C7B6E] hover:text-[#3D352E] px-1.5 py-0.5 rounded hover:bg-[#E3DCD2] transition-colors cursor-pointer"
                  title="Desmarcar todas as tags"
                >
                  Limpar
                </button>
              )}
              <button
                type="button"
                onClick={() => setIsTagsPanelOpen(false)}
                className="text-[#8C7B6E] hover:text-[#3D352E] p-1 rounded hover:bg-[#E3DCD2] transition-colors cursor-pointer"
                title="Fechar painel de tags"
                aria-label="Fechar painel de tags"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Lista de tags com rolagem vertical */}
          <div className="flex-1 overflow-y-auto p-2 custom-scrollbar">
            {tags.length === 0 ? (
              <div className="py-4 text-center text-xs text-[#8C7B6E]/70 italic px-2">
                Nenhuma tag criada ainda. Digite <span className="font-mono font-medium text-[#5C5046]">#tag</span> no texto de uma nota para criar automaticamente.
              </div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {tags.map((tag) => {
                  const isSelected = selectedTagIds.has(tag.id);
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      onClick={() => handleToggleTag(tag.id)}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs transition-all cursor-pointer shadow-2xs ${
                        isSelected
                          ? 'bg-[#D9C5B2] font-semibold text-[#3D352E] ring-1 ring-[#8C7B6E] shadow-xs'
                          : 'bg-[#FEFDFA] border border-[#D9C5B2] hover:bg-[#E3DCD2] hover:border-[#8C7B6E] text-[#3D352E]'
                      }`}
                    >
                      <span className="font-mono font-medium">#{tag.name}</span>
                      {isSelected && <Check className="w-3 h-3 text-[#3D352E] stroke-[2.5]" />}
                      {typeof tag.count === 'number' && !isSelected && (
                        <span className="text-[10px] text-[#8C7B6E] bg-[#E3DCD2] px-1 py-0.2 rounded font-normal">
                          {tag.count}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Rodapé: "Visualizar todas as tags" / expandir */}
          {tags.length > 6 && (
            <div className="px-2 py-1 border-t border-[#E3DCD2] bg-[#F4EFEB]/60 shrink-0 text-center">
              <button
                type="button"
                onClick={() => setShowAllTagsExpanded(!showAllTagsExpanded)}
                className="text-[11px] font-medium text-[#8C7B6E] hover:text-[#3D352E] transition-colors cursor-pointer"
              >
                {showAllTagsExpanded ? '▲ Recolher painel de tags' : `▼ Visualizar todas as tags (${tags.length})`}
              </button>
            </div>
          )}
        </div>
      )}

      {/* 4. Controles fixados na parte inferior da Sidebar */}
      <div data-sidebar-control="true" className="shrink-0 mt-auto border-t border-[#E3DCD2] bg-[#F9F7F2] select-none">
        {/* Linha 1: [ Pastas ] [ Favoritos ] [ Recentes ] [ Tags ] */}
        <div className="p-2 pb-1.5 grid grid-cols-4 gap-1 text-xs">
          <button
            id="tab-sidebar-tree"
            onClick={() => {
              setActiveTab('tree');
              handleClearSearch();
            }}
            className={`py-1.5 px-1.5 rounded-md font-medium flex items-center justify-center gap-1 transition-all cursor-pointer ${
              activeTab === 'tree' && !searchQuery.trim()
                ? 'bg-[#D9C5B2] text-[#3D352E] shadow-2xs'
                : 'text-[#8C7B6E] hover:bg-[#E3DCD2]'
            }`}
            title="Árvore de Pastas"
          >
            <Layers className="w-3.5 h-3.5 shrink-0" />
            <span className="hidden sm:inline">Pastas</span>
          </button>

          <button
            id="tab-sidebar-favorites"
            onClick={() => {
              setActiveTab('favorites');
              handleClearSearch();
            }}
            className={`py-1.5 px-1.5 rounded-md font-medium flex items-center justify-center gap-1 transition-all cursor-pointer ${
              activeTab === 'favorites' && !searchQuery.trim()
                ? 'bg-[#D9C5B2] text-[#3D352E] shadow-2xs'
                : 'text-[#8C7B6E] hover:bg-[#E3DCD2]'
            }`}
            title="Favoritos"
          >
            <Star className="w-3.5 h-3.5 shrink-0" />
            <span className="hidden sm:inline">({favoriteNotes.length})</span>
          </button>

          <button
            id="tab-sidebar-recent"
            onClick={() => {
              setActiveTab('recent');
              handleClearSearch();
            }}
            className={`py-1.5 px-1.5 rounded-md font-medium flex items-center justify-center gap-1 transition-all cursor-pointer ${
              activeTab === 'recent' && !searchQuery.trim()
                ? 'bg-[#D9C5B2] text-[#3D352E] shadow-2xs'
                : 'text-[#8C7B6E] hover:bg-[#E3DCD2]'
            }`}
            title="Recentes"
          >
            <Clock className="w-3.5 h-3.5 shrink-0" />
            <span className="hidden sm:inline">Recentes</span>
          </button>

          <button
            id="tab-sidebar-tags"
            onClick={() => {
              setIsTagsPanelOpen((prev) => !prev);
              handleClearSearch();
            }}
            className={`py-1.5 px-1.5 rounded-md font-medium flex items-center justify-center gap-1 transition-all cursor-pointer ${
              isTagsPanelOpen
                ? 'bg-[#D9C5B2] text-[#3D352E] shadow-2xs font-semibold'
                : 'text-[#8C7B6E] hover:bg-[#E3DCD2]'
            }`}
            title="Painel de Tags"
          >
            <TagIcon className="w-3.5 h-3.5 shrink-0" />
            <span className="hidden sm:inline">Tags</span>
          </button>
        </div>

        {/* Linha 2: [ Nova Pasta ] [ Nova Nota ] */}
        <div className="px-2 pb-2 grid grid-cols-2 gap-1.5">
          <button
            id="btn-sidebar-create-folder"
            onClick={() => onCreateFolder(null)}
            className="flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md border border-[#E3DCD2] bg-[#FEFDFA] hover:bg-[#E3DCD2] text-xs font-medium text-[#3D352E] transition-colors cursor-pointer"
          >
            <FolderPlus className="w-3.5 h-3.5 text-[#8C7B6E]" />
            <span>Nova Pasta</span>
          </button>
          <button
            id="btn-sidebar-create-note"
            onClick={() => onCreateNote(null)}
            className="flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md bg-[#8C7B6E] hover:bg-[#796A5E] text-white text-xs font-medium transition-colors cursor-pointer shadow-xs"
          >
            <FilePlus className="w-3.5 h-3.5" />
            <span>Nova Nota</span>
          </button>
        </div>

        {/* Linha 3: Status de Sincronização + Ajustes (último elemento) */}
        <div className="p-3 pt-2 border-t border-[#E3DCD2]/70 flex items-center justify-between text-xs text-[#8C7B6E]">
          <div className="flex items-center gap-1.5 truncate">
            {syncStatus === 'saving' && (
              <span className="flex items-center gap-1.5 text-[11px] text-amber-700 font-medium">
                <RefreshCw className="w-3 h-3 animate-spin" /> Sincronizando...
              </span>
            )}
            {syncStatus === 'saved' && (
              <span className="flex items-center gap-1.5 text-[11px] text-emerald-700 font-medium">
                <CheckCircle2 className="w-3.5 h-3.5" /> Sincronizado
              </span>
            )}
            {syncStatus === 'offline' && (
              <span className="flex items-center gap-1.5 text-[11px] text-[#8C7B6E]" title="Suas alterações continuam sendo salvas neste dispositivo">
                <WifiOff className="w-3.5 h-3.5" /> Offline (salvo localmente)
              </span>
            )}
            {syncStatus === 'error' && (
              <span className="flex items-center gap-1.5 text-[11px] text-rose-700 font-medium">
                <AlertCircle className="w-3.5 h-3.5" /> Erro de sincronização
              </span>
            )}
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {canInstall && (
              <button
                id="btn-sidebar-pwa-install"
                onClick={installApp}
                title="Instalar aplicativo"
                aria-label="Instalar aplicativo"
                className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-[#8C7B6E] hover:text-[#3D352E] hover:bg-[#E3DCD2] rounded-md transition-colors cursor-pointer border border-[#E3DCD2]/80 bg-[#FEFDFA]"
              >
                <Download className="w-3.5 h-3.5 text-[#8C7B6E]" />
                <span>Instalar</span>
              </button>
            )}

            <button
              id="btn-sidebar-settings"
              onClick={handleOpenSettingsPanel}
              title="Ajustes"
              aria-label="Ajustes"
              className="p-1.5 text-[#8C7B6E] hover:text-[#3D352E] hover:bg-[#E3DCD2] rounded-md transition-colors cursor-pointer"
            >
              <Settings className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Retângulo de seleção visual por arraste (Marquee) */}
      {selectionBox && (
        <div
          style={{
            position: 'fixed',
            left: `${Math.min(selectionBox.startX, selectionBox.currentX)}px`,
            top: `${Math.min(selectionBox.startY, selectionBox.currentY)}px`,
            width: `${Math.abs(selectionBox.currentX - selectionBox.startX)}px`,
            height: `${Math.abs(selectionBox.currentY - selectionBox.startY)}px`,
            pointerEvents: 'none',
            zIndex: 9999,
          }}
          className="border border-[#8C7B6E] bg-[#8C7B6E]/15 rounded-xs"
        />
      )}
    </aside>
  );
}
