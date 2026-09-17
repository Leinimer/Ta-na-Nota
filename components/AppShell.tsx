'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { TreeNode, NoteRecord, TagRecord, AppUser, SyncStatus } from '@/types';
import { authService } from '@/services/authService';
import { nodeService } from '@/services/nodeService';
import { noteService } from '@/services/noteService';
import { tagService } from '@/services/tagService';
import { exportService } from '@/services/exportService';
import { Sidebar } from './sidebar/Sidebar';
import { NoteEditor } from './editor/NoteEditor';
import { CommandPalette } from './command-palette/CommandPalette';
import { AuthModal } from './auth/AuthModal';
import {
  Menu,
  FilePlus,
  FolderPlus,
  BookOpen,
  Sparkles,
  Layers,
  Search,
} from 'lucide-react';

export function AppShell() {
  const [currentUser, setCurrentUser] = useState<AppUser | null>(null);
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [tags, setTags] = useState<TagRecord[]>([]);
  const [activeNode, setActiveNode] = useState<TreeNode | null>(null);
  const [activeNote, setActiveNote] = useState<NoteRecord | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    new Set(['folder-estudos', 'folder-direito', 'folder-constitucional', 'folder-financas'])
  );
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('saved');
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window !== 'undefined') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return 'light';
  });

  // UI state
  const [isMobileDrawerOpen, setIsMobileDrawerOpen] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const [isDraggingSidebar, setIsDraggingSidebar] = useState(false);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'));
  };

  // 1. Select Note & Load Content
  const selectNode = useCallback(async (node: TreeNode) => {
    if (node.type === 'folder') return;
    setActiveNode(node);

    try {
      const noteData = await noteService.getNoteByNodeId(node.id);
      if (noteData) {
        setActiveNote(noteData.note);
      }
    } catch (err) {
      console.warn('Error loading note:', err);
    }
  }, []);

  const selectNodeById = useCallback(async (nodeId: string, customTree?: TreeNode[]) => {
    const nodes = customTree || tree;
    const findNode = (list: TreeNode[]): TreeNode | null => {
      for (const item of list) {
        if (item.id === nodeId) return item;
        if (item.children) {
          const found = findNode(item.children);
          if (found) return found;
        }
      }
      return null;
    };
    const found = findNode(nodes);
    if (found && found.type === 'note') {
      selectNode(found);
    }
  }, [tree, selectNode]);

  // 2. Initial Load: User, Tree, Tags
  const refreshAppData = useCallback(async (userId: string, targetNodeId?: string) => {
    try {
      const [newTree, newTags] = await Promise.all([
        nodeService.getTree(userId),
        tagService.getTagsWithCount(userId),
      ]);
      setTree(newTree);
      setTags(newTags);

      // Select initial note if none selected
      if (targetNodeId) {
        selectNodeById(targetNodeId, newTree);
      } else if (!activeNode && newTree.length > 0) {
        // Find first note
        const findFirstNote = (nodes: TreeNode[]): TreeNode | null => {
          for (const n of nodes) {
            if (n.type === 'note') return n;
            if (n.children && n.children.length > 0) {
              const child = findFirstNote(n.children);
              if (child) return child;
            }
          }
          return null;
        };
        const first = findFirstNote(newTree);
        if (first) {
          selectNode(first);
        }
      }
    } catch (err) {
      console.warn('Error refreshing app data:', err);
    }
  }, [activeNode, selectNode, selectNodeById]);

  useEffect(() => {
    async function initUser() {
      const user = await authService.getCurrentUser();
      setCurrentUser(user);
      if (user) {
        await refreshAppData(user.id);
      }
    }
    initUser();
  }, [refreshAppData]);

  // 3. Tree expansion
  const toggleFolderExpand = (folderId: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  };

  // 4. Create Folder
  const handleCreateFolder = async (parentId?: string | null) => {
    if (!currentUser) return;
    const name = prompt('Nome da nova pasta:');
    if (!name || !name.trim()) return;

    try {
      await nodeService.createFolder(currentUser.id, name.trim(), parentId || null);
      if (parentId) {
        setExpandedFolders((prev) => new Set(prev).add(parentId));
      }
      await refreshAppData(currentUser.id);
    } catch (err) {
      console.warn('Error creating folder:', err);
    }
  };

  // 5. Create Note
  const handleCreateNote = async (parentId?: string | null) => {
    if (!currentUser) return;
    const name = prompt('Título da nova anotação:', 'Sem título');
    if (name === null) return;

    try {
      const res = await nodeService.createNote(currentUser.id, name.trim(), parentId || null);
      if (parentId) {
        setExpandedFolders((prev) => new Set(prev).add(parentId));
      }
      await refreshAppData(currentUser.id, res.node.id);
      selectNode(res.node);
    } catch (err) {
      console.warn('Error creating note:', err);
    }
  };

  // 6. Rename Node
  const handleRenameNode = async (nodeId: string, newName: string) => {
    if (!currentUser) return;
    try {
      await nodeService.renameNode(nodeId, newName);
      if (activeNode && activeNode.id === nodeId) {
        setActiveNode((prev) => (prev ? { ...prev, name: newName } : null));
      }
      await refreshAppData(currentUser.id);
    } catch (err) {
      console.warn('Error renaming node:', err);
    }
  };

  // 7. Delete Node
  const handleDeleteNode = async (nodeId: string) => {
    if (!currentUser) return;
    try {
      await nodeService.deleteNode(nodeId);
      if (activeNode && activeNode.id === nodeId) {
        setActiveNode(null);
        setActiveNote(null);
      }
      await refreshAppData(currentUser.id);
    } catch (err) {
      console.warn('Error deleting node:', err);
    }
  };

  // 8. Duplicate Note
  const handleDuplicateNote = async (nodeId: string) => {
    if (!currentUser) return;
    try {
      const res = await nodeService.duplicateNote(nodeId, currentUser.id);
      if (res) {
        await refreshAppData(currentUser.id, res.node.id);
        selectNode(res.node);
      }
    } catch (err) {
      console.warn('Error duplicating note:', err);
    }
  };

  // 9. Move Node
  const handleMoveNode = async (draggedId: string, targetParentId: string | null) => {
    if (!currentUser) return;
    try {
      const success = await nodeService.moveNode(draggedId, targetParentId);
      if (success) {
        if (targetParentId) {
          setExpandedFolders((prev) => new Set(prev).add(targetParentId));
        }
        await refreshAppData(currentUser.id);
      }
    } catch (err) {
      console.warn('Error moving node:', err);
    }
  };

  // 10. Toggle Favorite
  const handleToggleFavorite = async (nodeId: string) => {
    if (!currentUser) return;
    try {
      const isFav = await noteService.toggleFavorite(nodeId);
      if (activeNode && activeNode.id === nodeId) {
        setActiveNode((prev) => (prev ? { ...prev, isFavorite: isFav } : null));
      }
      await refreshAppData(currentUser.id);
    } catch (err) {
      console.warn('Error toggling favorite:', err);
    }
  };

  // 11. Save Content (from Editor)
  const handleSaveContent = async (nodeId: string, md: string, json: any) => {
    setSyncStatus('saving');
    try {
      await noteService.saveNote(nodeId, md, json);
      setSyncStatus('saved');
      // refresh tags count in sidebar
      if (currentUser) {
        const updatedTags = await tagService.getTagsWithCount(currentUser.id);
        setTags(updatedTags);
      }
    } catch (err) {
      console.warn('Error saving note:', err);
      setSyncStatus('error');
    }
  };

  // 12. Export
  const handleExportNote = async (nodeId: string) => {
    await exportService.exportNoteMarkdown(nodeId);
  };

  const handleExportAll = async () => {
    if (!currentUser) return;
    await exportService.exportAllToZip(currentUser.id);
  };

  // Keyboard shortcut: Cmd+K / Ctrl+K
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsCommandPaletteOpen((prev) => !prev);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        // Browser save intercepted, editor already autosaves
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Resizable sidebar mouse event handlers
  const handleMouseDownResize = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDraggingSidebar(true);
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingSidebar) return;
      const newWidth = Math.min(Math.max(220, e.clientX), 480);
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      if (isDraggingSidebar) setIsDraggingSidebar(false);
    };

    if (isDraggingSidebar) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDraggingSidebar]);

  return (
    <div
      id="app-shell"
      className="flex h-screen w-screen overflow-hidden bg-[#fbf9f4] dark:bg-[#191816] text-[#1b1c19] dark:text-[#f2f1ec] font-sans paper-texture"
    >
      {/* Mobile Drawer Backdrop */}
      {isMobileDrawerOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-xs md:hidden"
          onClick={() => setIsMobileDrawerOpen(false)}
        />
      )}

      {/* Desktop Sidebar */}
      <div
        style={{ width: `${sidebarWidth}px` }}
        className="hidden md:flex shrink-0 h-full relative"
      >
        <Sidebar
          tree={tree}
          activeNodeId={activeNode?.id || null}
          expandedFolders={expandedFolders}
          tags={tags}
          currentUser={currentUser}
          syncStatus={syncStatus}
          theme={theme}
          onToggleTheme={toggleTheme}
          onOpenAuth={() => setIsAuthModalOpen(true)}
          onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
          onToggleExpand={toggleFolderExpand}
          onSelectNode={selectNode}
          onCreateFolder={handleCreateFolder}
          onCreateNote={handleCreateNote}
          onRenameNode={handleRenameNode}
          onDeleteNode={handleDeleteNode}
          onDuplicateNote={handleDuplicateNote}
          onToggleFavorite={handleToggleFavorite}
          onExportNote={handleExportNote}
          onExportAll={handleExportAll}
          onMoveNode={handleMoveNode}
        />

        {/* Resizer Handle */}
        <div
          onMouseDown={handleMouseDownResize}
          className={`absolute top-0 right-0 w-1.5 h-full cursor-col-resize hover:bg-[#68594d]/40 transition-colors ${
            isDraggingSidebar ? 'bg-[#68594d]' : ''
          }`}
        />
      </div>

      {/* Mobile Drawer Sidebar */}
      <div
        className={`fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] transform transition-transform duration-200 ease-in-out md:hidden ${
          isMobileDrawerOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full'
        }`}
      >
        <Sidebar
          tree={tree}
          activeNodeId={activeNode?.id || null}
          expandedFolders={expandedFolders}
          tags={tags}
          currentUser={currentUser}
          syncStatus={syncStatus}
          theme={theme}
          onToggleTheme={toggleTheme}
          onOpenAuth={() => setIsAuthModalOpen(true)}
          onOpenCommandPalette={() => {
            setIsMobileDrawerOpen(false);
            setIsCommandPaletteOpen(true);
          }}
          onToggleExpand={toggleFolderExpand}
          onSelectNode={selectNode}
          onCreateFolder={handleCreateFolder}
          onCreateNote={handleCreateNote}
          onRenameNode={handleRenameNode}
          onDeleteNode={handleDeleteNode}
          onDuplicateNote={handleDuplicateNote}
          onToggleFavorite={handleToggleFavorite}
          onExportNote={handleExportNote}
          onExportAll={handleExportAll}
          onMoveNode={handleMoveNode}
          onCloseMobileDrawer={() => setIsMobileDrawerOpen(false)}
        />
      </div>

      {/* Main Content Area */}
      <main id="main-content-canvas" className="flex-1 flex flex-col h-full overflow-hidden relative">
        {/* Mobile Header Toggle */}
        <div className="md:hidden flex items-center justify-between px-4 py-2.5 bg-[#ffffff] dark:bg-[#201f1c] border-b border-[#eae8e3] dark:border-[#2f2d29]">
          <button
            onClick={() => setIsMobileDrawerOpen(true)}
            className="p-1.5 text-[#7f756e] hover:text-[#1b1c19] rounded-md hover:bg-[#f5f3ee] dark:hover:bg-[#2c2a26]"
            aria-label="Abrir Menu de Pastas"
          >
            <Menu className="w-5 h-5" />
          </button>
          <span className="font-serif font-semibold text-sm">Digital Tactility</span>
          <button
            onClick={() => setIsCommandPaletteOpen(true)}
            className="p-1.5 text-[#7f756e] hover:text-[#1b1c19] rounded-md hover:bg-[#f5f3ee] dark:hover:bg-[#2c2a26]"
            aria-label="Buscar"
          >
            <Search className="w-5 h-5" />
          </button>
        </div>

        {/* Note Editor or Empty Selection State */}
        {activeNode && activeNote ? (
          <NoteEditor
            key={activeNode.id}
            node={activeNode}
            note={activeNote}
            syncStatus={syncStatus}
            onUpdateTitle={handleRenameNode}
            onSaveContent={handleSaveContent}
            onToggleFavorite={handleToggleFavorite}
            onDeleteNote={handleDeleteNode}
            onDuplicateNote={handleDuplicateNote}
            onExportNote={handleExportNote}
            onNavigateToNote={selectNodeById}
          />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-[#fbf9f4] dark:bg-[#191816]">
            <div className="max-w-md space-y-4">
              <div className="w-16 h-16 rounded-2xl bg-[#f4dfcb] dark:bg-[#3c3328] text-[#68594d] dark:text-[#d7c3b4] flex items-center justify-center mx-auto shadow-sm">
                <BookOpen className="w-8 h-8" />
              </div>
              <h2 className="text-2xl font-serif font-semibold text-[#1b1c19] dark:text-[#f2f1ec] tracking-tight">
                Seu Segundo Cérebro Digital
              </h2>
              <p className="text-sm text-[#7f756e] leading-relaxed">
                A árvore organiza. A nota armazena. Os links conectam. As tags categorizam. A busca encontra.
              </p>
              <div className="pt-2 flex flex-wrap justify-center gap-2">
                <button
                  onClick={() => handleCreateNote(null)}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#68594d] hover:bg-[#574a3f] text-white text-xs font-medium transition-colors cursor-pointer shadow-xs"
                >
                  <FilePlus className="w-4 h-4" /> Criar Primeira Nota
                </button>
                <button
                  onClick={() => handleCreateFolder(null)}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-[#d1c4bc] dark:border-[#44403a] bg-white dark:bg-[#282724] hover:bg-[#eae8e3] dark:hover:bg-[#36342f] text-xs font-medium text-[#1b1c19] dark:text-[#f2f1ec] transition-colors cursor-pointer"
                >
                  <FolderPlus className="w-4 h-4" /> Criar Pasta
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Command Palette Modal */}
      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        userId={currentUser?.id || 'demo-user-tactility-1'}
        onSelectNote={selectNodeById}
        onSelectFolder={(fId) => setExpandedFolders((prev) => new Set(prev).add(fId))}
        onCreateNote={() => handleCreateNote(null)}
        onCreateFolder={() => handleCreateFolder(null)}
        onExportAll={handleExportAll}
        onToggleTheme={toggleTheme}
      />

      {/* Auth & Sync Modal */}
      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        currentUser={currentUser}
        onUserChanged={(user) => {
          setCurrentUser(user);
          if (user) refreshAppData(user.id);
        }}
      />
    </div>
  );
}
