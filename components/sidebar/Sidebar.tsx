'use client';

import React, { useState, useEffect, useRef } from 'react';
import { TreeNode, TagRecord, AppUser, SyncStatus, SearchResults } from '@/types';
import { TreeNodeItem } from './TreeNodeItem';
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
} from 'lucide-react';
import { usePwaInstall } from '@/components/pwa/usePwaInstall';

type SearchSource = 'folders' | 'notes' | 'tags' | 'content';

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
  onDuplicateNote: (nodeId: string) => void;
  onToggleFavorite: (nodeId: string) => void;
  onExportNote: (nodeId: string) => void;
  onExportAll: () => void;
  onMoveNode: (draggedId: string, targetParentId: string | null) => void;
  onFilterByTag?: (tagId: string) => void;
  onCloseMobileDrawer?: () => void;
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
  onDuplicateNote,
  onToggleFavorite,
  onExportNote,
  onExportAll,
  onMoveNode,
  onFilterByTag,
  onCloseMobileDrawer,
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
  const sourceMenuRef = useRef<HTMLDivElement>(null);
  const { canInstall, installApp } = usePwaInstall();

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

  // Root drop handler (move to root)
  const handleRootDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsRootDragOver(false);
    const draggedId = e.dataTransfer.getData('text/plain');
    if (draggedId) {
      onMoveNode(draggedId, null);
    }
  };

  const handleOpenSettingsPanel = onOpenSettings || onOpenAuth;

  return (
    <aside
      id="app-sidebar"
      className="w-full h-full flex flex-col bg-[#F9F7F2] border-r border-[#E3DCD2] text-[#3D352E] select-none"
    >
      {/* 1. Topo da Sidebar: [logo] Tá na nota */}
      <div className="p-3.5 border-b border-[#E3DCD2] shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-[#8C7B6E] text-[#F9F7F2] flex items-center justify-center font-handwritten text-xl font-bold shadow-xs">
            T
          </div>
          <h1 className="font-handwritten text-2xl font-bold tracking-normal leading-none text-[#8C7B6E]">
            Tá na nota
          </h1>
        </div>
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
                        if (onFilterByTag) onFilterByTag(tag.id);
                        handleClearSearch();
                        setActiveTab('tags');
                        if (onCloseMobileDrawer) onCloseMobileDrawer();
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
                      onDuplicateNote={onDuplicateNote}
                      onToggleFavorite={onToggleFavorite}
                      onExportNote={onExportNote}
                      onMoveNode={onMoveNode}
                    />
                  ))
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

            {/* Tab 4: Tags */}
            {activeTab === 'tags' && (
              <div className="space-y-2 p-1">
                <div className="px-1 py-1 text-[11px] font-semibold tracking-wider text-[#8C7B6E] uppercase">
                  Etiquetas do Sistema ({tags.length})
                </div>
                {tags.length === 0 ? (
                  <div className="py-6 text-center text-xs text-[#8C7B6E]/70 italic">
                    Nenhuma tag encontrada. Digite #tag no texto da nota para criar tags automaticamente.
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {tags.map((tag) => (
                      <button
                        key={tag.id}
                        onClick={() => {
                          if (onFilterByTag) onFilterByTag(tag.id);
                        }}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs bg-[#E3DCD2] border border-[#D9C5B2] hover:bg-[#D9C5B2] transition-colors cursor-pointer"
                      >
                        <span className="font-mono text-[#8C7B6E] font-medium">#{tag.name}</span>
                        {typeof tag.count === 'number' && (
                          <span className="text-[10px] text-[#8C7B6E] bg-[#D9C5B2]/60 px-1 rounded">
                            {tag.count}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* 4. Controles fixados na parte inferior da Sidebar */}
      <div className="shrink-0 mt-auto border-t border-[#E3DCD2] bg-[#F9F7F2] select-none">
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
              setActiveTab('tags');
              handleClearSearch();
            }}
            className={`py-1.5 px-1.5 rounded-md font-medium flex items-center justify-center gap-1 transition-all cursor-pointer ${
              activeTab === 'tags' && !searchQuery.trim()
                ? 'bg-[#D9C5B2] text-[#3D352E] shadow-2xs'
                : 'text-[#8C7B6E] hover:bg-[#E3DCD2]'
            }`}
            title="Etiquetas e Tags"
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
                <WifiOff className="w-3.5 h-3.5" /> Offline — salvo neste dispositivo
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
    </aside>
  );
}
