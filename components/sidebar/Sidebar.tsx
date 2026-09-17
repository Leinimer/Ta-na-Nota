'use client';

import React, { useState } from 'react';
import { TreeNode, TagRecord, AppUser, SyncStatus } from '@/types';
import { TreeNodeItem } from './TreeNodeItem';
import {
  FolderPlus,
  FilePlus,
  Search,
  Star,
  Clock,
  Tag as TagIcon,
  Download,
  Moon,
  Sun,
  User as UserIcon,
  Layers,
  ChevronDown,
  CheckCircle2,
  RefreshCw,
  WifiOff,
} from 'lucide-react';

interface SidebarProps {
  tree: TreeNode[];
  activeNodeId: string | null;
  expandedFolders: Set<string>;
  tags: TagRecord[];
  currentUser: AppUser | null;
  syncStatus: SyncStatus;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  onOpenAuth: () => void;
  onOpenCommandPalette: () => void;
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
  tags,
  currentUser,
  syncStatus,
  theme,
  onToggleTheme,
  onOpenAuth,
  onOpenCommandPalette,
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
  const [isRootDragOver, setIsRootDragOver] = useState(false);

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
  const recentNotes = [...allNotes].sort((a, b) => {
    const timeA = a.lastOpenedAt ? new Date(a.lastOpenedAt).getTime() : 0;
    const timeB = b.lastOpenedAt ? new Date(b.lastOpenedAt).getTime() : 0;
    return timeB - timeA;
  }).slice(0, 10);

  // Search filter
  const filteredNotes = searchQuery.trim()
    ? allNotes.filter((n) => n.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : null;

  // Root drop handler (move to root)
  const handleRootDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsRootDragOver(false);
    const draggedId = e.dataTransfer.getData('text/plain');
    if (draggedId) {
      onMoveNode(draggedId, null);
    }
  };

  return (
    <aside
      id="app-sidebar"
      className="w-full h-full flex flex-col bg-[#f5f3ee] dark:bg-[#1f1e1b] border-r border-[#d1c4bc] dark:border-[#383530] text-[#1b1c19] dark:text-[#f2f1ec] select-none"
    >
      {/* 1. Header & Identity */}
      <div className="p-3.5 border-b border-[#eae8e3] dark:border-[#2f2d29] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-md bg-[#68594d] text-white flex items-center justify-center font-serif font-bold text-sm shadow-xs">
            T
          </div>
          <div>
            <h1 className="font-serif font-semibold text-sm tracking-tight leading-none text-[#1b1c19] dark:text-[#f2f1ec]">
              Digital Tactility
            </h1>
            <div className="flex items-center gap-1.5 mt-0.5">
              {syncStatus === 'saving' && (
                <span className="flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400">
                  <RefreshCw className="w-2.5 h-2.5 animate-spin" /> Salvando...
                </span>
              )}
              {syncStatus === 'saved' && (
                <span className="flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="w-2.5 h-2.5" /> Salvo
                </span>
              )}
              {syncStatus === 'offline' && (
                <span className="flex items-center gap-1 text-[10px] text-[#7f756e]">
                  <WifiOff className="w-2.5 h-2.5" /> Local
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            id="btn-toggle-theme"
            title="Alternar Tema"
            onClick={onToggleTheme}
            className="p-1.5 text-[#7f756e] hover:text-[#1b1c19] dark:hover:text-[#ffffff] rounded-md hover:bg-[#eae8e3] dark:hover:bg-[#2c2a26] transition-colors"
          >
            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
          <button
            id="btn-open-user-profile"
            title="Conta & Sincronização"
            onClick={onOpenAuth}
            className="p-1.5 text-[#7f756e] hover:text-[#1b1c19] dark:hover:text-[#ffffff] rounded-md hover:bg-[#eae8e3] dark:hover:bg-[#2c2a26] transition-colors"
          >
            <UserIcon className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 2. Search & Command Palette Trigger */}
      <div className="p-3 border-b border-[#eae8e3] dark:border-[#2f2d29]">
        <div
          onClick={onOpenCommandPalette}
          className="w-full flex items-center justify-between px-2.5 py-1.5 bg-[#ffffff] dark:bg-[#282724] border border-[#d1c4bc] dark:border-[#44403a] rounded-lg text-xs text-[#7f756e] hover:border-[#68594d] transition-colors cursor-pointer shadow-2xs"
        >
          <div className="flex items-center gap-2">
            <Search className="w-3.5 h-3.5 text-[#7f756e]" />
            <span>Buscar notas, tags...</span>
          </div>
          <kbd className="px-1.5 py-0.5 text-[10px] bg-[#eae8e3] dark:bg-[#36342f] rounded border border-[#d1c4bc] dark:border-[#44403a] text-[#7f756e] font-mono">
            ⌘K
          </kbd>
        </div>
      </div>

      {/* 3. Quick Section Tabs */}
      <div className="px-2 pt-2 grid grid-cols-4 gap-1 text-xs">
        <button
          onClick={() => {
            setActiveTab('tree');
            setSearchQuery('');
          }}
          className={`py-1.5 px-2 rounded-md font-medium flex items-center justify-center gap-1 transition-all ${
            activeTab === 'tree'
              ? 'bg-[#f4dfcb] dark:bg-[#3c3328] text-[#68594d] dark:text-[#d7c3b4] shadow-2xs'
              : 'text-[#7f756e] hover:bg-[#eae8e3] dark:hover:bg-[#2c2a26]'
          }`}
          title="Árvore de Pastas"
        >
          <Layers className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Pastas</span>
        </button>

        <button
          onClick={() => {
            setActiveTab('favorites');
            setSearchQuery('');
          }}
          className={`py-1.5 px-2 rounded-md font-medium flex items-center justify-center gap-1 transition-all ${
            activeTab === 'favorites'
              ? 'bg-[#f4dfcb] dark:bg-[#3c3328] text-[#68594d] dark:text-[#d7c3b4] shadow-2xs'
              : 'text-[#7f756e] hover:bg-[#eae8e3] dark:hover:bg-[#2c2a26]'
          }`}
          title="Favoritos"
        >
          <Star className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">({favoriteNotes.length})</span>
        </button>

        <button
          onClick={() => {
            setActiveTab('recent');
            setSearchQuery('');
          }}
          className={`py-1.5 px-2 rounded-md font-medium flex items-center justify-center gap-1 transition-all ${
            activeTab === 'recent'
              ? 'bg-[#f4dfcb] dark:bg-[#3c3328] text-[#68594d] dark:text-[#d7c3b4] shadow-2xs'
              : 'text-[#7f756e] hover:bg-[#eae8e3] dark:hover:bg-[#2c2a26]'
          }`}
          title="Recentes"
        >
          <Clock className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Recentes</span>
        </button>

        <button
          onClick={() => {
            setActiveTab('tags');
            setSearchQuery('');
          }}
          className={`py-1.5 px-2 rounded-md font-medium flex items-center justify-center gap-1 transition-all ${
            activeTab === 'tags'
              ? 'bg-[#f4dfcb] dark:bg-[#3c3328] text-[#68594d] dark:text-[#d7c3b4] shadow-2xs'
              : 'text-[#7f756e] hover:bg-[#eae8e3] dark:hover:bg-[#2c2a26]'
          }`}
          title="Etiquetas e Tags"
        >
          <TagIcon className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Tags</span>
        </button>
      </div>

      {/* 4. Action Buttons: Nova Pasta & Nova Nota */}
      <div className="p-2 grid grid-cols-2 gap-1.5">
        <button
          id="btn-sidebar-create-folder"
          onClick={() => onCreateFolder(null)}
          className="flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md border border-[#d1c4bc] dark:border-[#44403a] bg-[#ffffff] dark:bg-[#282724] hover:bg-[#eae8e3] dark:hover:bg-[#36342f] text-xs font-medium text-[#1b1c19] dark:text-[#f2f1ec] transition-colors cursor-pointer"
        >
          <FolderPlus className="w-3.5 h-3.5 text-[#68594d] dark:text-[#d7c3b4]" />
          <span>Nova Pasta</span>
        </button>
        <button
          id="btn-sidebar-create-note"
          onClick={() => onCreateNote(null)}
          className="flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md bg-[#68594d] hover:bg-[#574a3f] text-white text-xs font-medium transition-colors cursor-pointer shadow-xs"
        >
          <FilePlus className="w-3.5 h-3.5" />
          <span>Nova Nota</span>
        </button>
      </div>

      {/* 5. Scrollable Content Area */}
      <div
        id="sidebar-tree-container"
        onDragOver={(e) => {
          e.preventDefault();
          setIsRootDragOver(true);
        }}
        onDragLeave={() => setIsRootDragOver(false)}
        onDrop={handleRootDrop}
        className={`flex-1 overflow-y-auto px-2 py-1 custom-scrollbar ${
          isRootDragOver ? 'bg-[#f4dfcb]/30 ring-2 ring-dashed ring-[#68594d]' : ''
        }`}
      >
        {/* Filtered Search Results */}
        {filteredNotes && (
          <div className="space-y-1">
            <div className="px-2 py-1 text-[11px] font-semibold tracking-wider text-[#7f756e] uppercase">
              Resultados da busca ({filteredNotes.length})
            </div>
            {filteredNotes.map((note) => (
              <div
                key={note.id}
                onClick={() => {
                  onSelectNode(note);
                  if (onCloseMobileDrawer) onCloseMobileDrawer();
                }}
                className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs cursor-pointer transition-colors ${
                  activeNodeId === note.id
                    ? 'bg-[#f4dfcb] dark:bg-[#3c3328] font-medium text-[#68594d] dark:text-[#d7c3b4]'
                    : 'hover:bg-[#eae8e3] dark:hover:bg-[#2c2a26]'
                }`}
              >
                <span className="w-2 h-2 rounded-full bg-[#68594d]" />
                <span className="truncate">{note.name}</span>
              </div>
            ))}
          </div>
        )}

        {/* Tab 1: Tree View */}
        {!filteredNotes && activeTab === 'tree' && (
          <div className="space-y-0.5">
            {tree.length === 0 ? (
              <div className="py-8 text-center text-xs text-[#7f756e] italic">
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
        {!filteredNotes && activeTab === 'favorites' && (
          <div className="space-y-1">
            <div className="px-2 py-1 text-[11px] font-semibold tracking-wider text-[#7f756e] uppercase">
              Notas Favoritas
            </div>
            {favoriteNotes.length === 0 ? (
              <div className="py-6 text-center text-xs text-[#7f756e] italic">
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
                      ? 'bg-[#f4dfcb] dark:bg-[#3c3328] font-medium text-[#68594d] dark:text-[#d7c3b4]'
                      : 'hover:bg-[#eae8e3] dark:hover:bg-[#2c2a26]'
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
        {!filteredNotes && activeTab === 'recent' && (
          <div className="space-y-1">
            <div className="px-2 py-1 text-[11px] font-semibold tracking-wider text-[#7f756e] uppercase">
              Abertas Recentemente
            </div>
            {recentNotes.length === 0 ? (
              <div className="py-6 text-center text-xs text-[#7f756e] italic">
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
                      ? 'bg-[#f4dfcb] dark:bg-[#3c3328] font-medium text-[#68594d] dark:text-[#d7c3b4]'
                      : 'hover:bg-[#eae8e3] dark:hover:bg-[#2c2a26]'
                  }`}
                >
                  <span className="truncate">{note.name}</span>
                  <span className="text-[10px] text-[#7f756e]">
                    {note.lastOpenedAt ? new Date(note.lastOpenedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                  </span>
                </div>
              ))
            )}
          </div>
        )}

        {/* Tab 4: Tags */}
        {!filteredNotes && activeTab === 'tags' && (
          <div className="space-y-2 p-1">
            <div className="px-1 py-1 text-[11px] font-semibold tracking-wider text-[#7f756e] uppercase">
              Etiquetas do Sistema ({tags.length})
            </div>
            {tags.length === 0 ? (
              <div className="py-6 text-center text-xs text-[#7f756e] italic">
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
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs bg-[#ffffff] dark:bg-[#282724] border border-[#d1c4bc] dark:border-[#44403a] hover:border-[#68594d] hover:bg-[#f4dfcb]/30 transition-colors"
                  >
                    <span className="font-mono text-[#68594d] dark:text-[#d7c3b4]">#{tag.name}</span>
                    {typeof tag.count === 'number' && (
                      <span className="text-[10px] text-[#7f756e] bg-[#eae8e3] dark:bg-[#36342f] px-1 rounded-full">
                        {tag.count}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 6. Footer: Export & Local Storage status */}
      <div className="p-3 border-t border-[#eae8e3] dark:border-[#2f2d29] flex items-center justify-between text-xs text-[#7f756e]">
        <button
          id="btn-sidebar-export-all"
          onClick={onExportAll}
          title="Exportar todas as pastas e notas em arquivo ZIP"
          className="flex items-center gap-1.5 hover:text-[#1b1c19] dark:hover:text-[#ffffff] transition-colors cursor-pointer"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Exportar Tudo (.ZIP)</span>
        </button>
        <span className="text-[10px] font-mono text-[#7f756e]/80">v1.0</span>
      </div>
    </aside>
  );
}
