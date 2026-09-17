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
  X,
  FileText,
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

  const [selectedTagNotesModal, setSelectedTagNotesModal] = useState<{ tagName: string; notes: TreeNode[] } | null>(null);

  const handleTagClick = async (tagNameOrId: string) => {
    if (!currentUser) return;
    try {
      const cleanName = tagNameOrId.replace(/^#/, '').toLowerCase();
      const tagRecord = tags.find((t) => t.id === tagNameOrId || t.name.toLowerCase() === cleanName);
      if (tagRecord) {
        const matchingNotes = await tagService.getNotesForTag(tagRecord.id, currentUser.id);
        setSelectedTagNotesModal({ tagName: tagRecord.name, notes: matchingNotes });
      } else {
        setSelectedTagNotesModal({ tagName: cleanName, notes: [] });
      }
    } catch (err) {
      console.warn('Error fetching notes for tag:', err);
    }
  };

  return (
    <div
      id="app-shell"
      className="flex h-screen w-screen overflow-hidden bg-[#f8f6f1] dark:bg-[#211e1b] text-[#2d2621] dark:text-[#f5f2eb] font-sans paper-texture"
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
          onFilterByTag={handleTagClick}
          onCloseMobileDrawer={() => setIsMobileDrawerOpen(false)}
        />
      </div>

      {/* Main Content Area */}
      <main id="main-content-canvas" className="flex-1 flex flex-col h-full overflow-hidden relative">
        {/* Mobile Header Toggle */}
        <div className="md:hidden flex items-center justify-between px-4 py-2.5 bg-[#fefdfa] dark:bg-[#282421] border-b border-[#ded7c8] dark:border-[#38322b]">
          <button
            onClick={() => setIsMobileDrawerOpen(true)}
            className="p-1.5 text-[#7d7064] hover:text-[#2d2621] rounded-md hover:bg-[#ede7dc] dark:hover:bg-[#332d28]"
            aria-label="Abrir Menu de Pastas"
          >
            <Menu className="w-5 h-5" />
          </button>
          <span className="font-serif font-semibold text-sm text-[#2d2621] dark:text-[#f5f2eb]">Tá na nota</span>
          <button
            onClick={() => setIsCommandPaletteOpen(true)}
            className="p-1.5 text-[#7d7064] hover:text-[#2d2621] rounded-md hover:bg-[#ede7dc] dark:hover:bg-[#332d28]"
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
            onTagClick={handleTagClick}
          />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-[#f8f6f1] dark:bg-[#211e1b]">
            <div className="max-w-md space-y-4">
              <div className="w-16 h-16 rounded-2xl bg-[#edd9c4] dark:bg-[#3c3328] text-[#5c4e42] dark:text-[#dfd5c8] flex items-center justify-center mx-auto shadow-2xs border border-[#ded7c8] dark:border-[#443e37]">
                <BookOpen className="w-8 h-8" />
              </div>
              <h2 className="text-2xl font-serif font-semibold text-[#2d2621] dark:text-[#f5f2eb] tracking-tight">
                Seu Segundo Cérebro Digital
              </h2>
              <p className="text-sm text-[#7d7064] leading-relaxed">
                A árvore organiza. A nota armazena. Os links conectam. As tags categorizam. A busca encontra.
              </p>
              <div className="pt-2 flex flex-wrap justify-center gap-2">
                <button
                  onClick={() => handleCreateNote(null)}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#5c4e42] hover:bg-[#483d34] text-white text-xs font-medium transition-colors cursor-pointer shadow-xs"
                >
                  <FilePlus className="w-4 h-4" /> Criar Primeira Nota
                </button>
                <button
                  onClick={() => handleCreateFolder(null)}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-[#ded7c8] dark:border-[#443e37] bg-[#fefdfa] dark:bg-[#282421] hover:bg-[#ede7dc] dark:hover:bg-[#332d28] text-xs font-medium text-[#2d2621] dark:text-[#f5f2eb] transition-colors cursor-pointer"
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

      {/* Tag Notes Listing Modal */}
      {selectedTagNotesModal && (
        <div
          id="tag-notes-modal-overlay"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4"
          onClick={() => setSelectedTagNotesModal(null)}
        >
          <div
            id="tag-notes-modal-card"
            className="w-full max-w-md bg-[#fefdfa] dark:bg-[#282421] border border-[#ded7c8] dark:border-[#443e37] rounded-xl shadow-xl p-6 text-[#2d2621] dark:text-[#f5f2eb] relative animate-in fade-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-[#ded7c8] dark:border-[#38322b] mb-4">
              <div className="flex items-center gap-2">
                <span className="font-mono font-medium text-xs text-[#5c4e42] dark:text-[#dfd5c8] bg-[#ede7dc] dark:bg-[#332d28] px-2.5 py-0.5 rounded-full border border-[#ded7c8] dark:border-[#443e37]">
                  #{selectedTagNotesModal.tagName}
                </span>
                <span className="text-xs text-[#7d7064]">
                  ({selectedTagNotesModal.notes.length} {selectedTagNotesModal.notes.length === 1 ? 'nota' : 'notas'})
                </span>
              </div>
              <button
                onClick={() => setSelectedTagNotesModal(null)}
                className="text-[#7d7064] hover:text-[#2d2621] dark:hover:text-[#ffffff] p-1 rounded-md transition-colors cursor-pointer"
                aria-label="Fechar"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="text-xs font-semibold text-[#7d7064] uppercase tracking-wider mb-2">
              Notas associadas
            </div>

            {selectedTagNotesModal.notes.length === 0 ? (
              <div className="py-6 text-center text-xs text-[#7d7064] italic">
                Nenhuma nota associada a esta etiqueta no momento.
              </div>
            ) : (
              <div className="max-h-72 overflow-y-auto space-y-1.5 custom-scrollbar pr-1">
                {selectedTagNotesModal.notes.map((n) => (
                  <button
                    key={n.id}
                    onClick={() => {
                      selectNode(n);
                      setSelectedTagNotesModal(null);
                    }}
                    className="w-full flex items-center justify-between p-2.5 rounded-lg bg-[#ede7dc]/40 hover:bg-[#ede7dc] dark:bg-[#332d28]/40 dark:hover:bg-[#332d28] border border-[#ded7c8] dark:border-[#38322b] text-left transition-colors cursor-pointer group"
                  >
                    <div className="flex items-center gap-2.5 truncate">
                      <FileText className="w-4 h-4 text-[#5c4e42] dark:text-[#dfd5c8] shrink-0" />
                      <span className="text-sm font-medium truncate text-[#2d2621] dark:text-[#f5f2eb]">
                        {n.name}
                      </span>
                    </div>
                    <span className="text-[11px] text-[#7d7064] group-hover:text-[#5c4e42] shrink-0">
                      Abrir →
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
