'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { TreeNode, NoteRecord, TagRecord, AppUser, SyncStatus } from '@/types';
import { authService } from '@/services/authService';
import { nodeService } from '@/services/nodeService';
import { noteService } from '@/services/noteService';
import { tagService } from '@/services/tagService';
import { exportService } from '@/services/exportService';
import { syncEngine } from '@/services/syncEngine';
import { realtimeService } from '@/services/realtimeService';
import { indexedDbService } from '@/services/indexedDbService';
import { Sidebar } from './sidebar/Sidebar';
import { NoteEditor } from './editor/NoteEditor';
import { EditorErrorBoundary } from './editor/EditorErrorBoundary';
import { CommandPalette } from './command-palette/CommandPalette';
import { AuthModal } from './auth/AuthModal';
import { AuthScreen } from './auth/AuthScreen';
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

// Helper para atualizar propriedades de um nó na árvore
function updateNodeInTree(nodes: TreeNode[], updatedNode: Partial<TreeNode> & { id: string }): TreeNode[] {
  return nodes.map((node) => {
    if (node.id === updatedNode.id) {
      return { ...node, ...updatedNode };
    }
    if (node.children && node.children.length > 0) {
      return { ...node, children: updateNodeInTree(node.children, updatedNode) };
    }
    return node;
  });
}

// Helper para remover nó da árvore recursivamente
function removeNodeFromTree(nodes: TreeNode[], targetId: string): TreeNode[] {
  const nextList: TreeNode[] = [];
  for (const node of nodes) {
    if (node.id === targetId) {
      continue;
    }
    if (node.children && node.children.length > 0) {
      nextList.push({ ...node, children: removeNodeFromTree(node.children, targetId) });
    } else {
      nextList.push(node);
    }
  }
  return nextList;
}

// Helper para buscar nó na árvore
function findNodeInTree(list: TreeNode[], targetId: string): TreeNode | null {
  for (const item of list) {
    if (item.id === targetId) return item;
    if (item.children && item.children.length > 0) {
      const found = findNodeInTree(item.children, targetId);
      if (found) return found;
    }
  }
  return null;
}

// Helper para inserir novo nó na árvore
function insertNodeIntoTree(nodes: TreeNode[], newNode: TreeNode): TreeNode[] {
  const exists = findNodeInTree(nodes, newNode.id);
  if (exists) {
    return updateNodeInTree(nodes, newNode);
  }

  const nodeWithChildren: TreeNode = {
    ...newNode,
    children: newNode.children || [],
  };

  if (!newNode.parentId) {
    return [...nodes, nodeWithChildren].sort((a, b) => a.position - b.position);
  }

  function insertRecursive(list: TreeNode[]): TreeNode[] {
    return list.map((item) => {
      if (item.id === newNode.parentId) {
        const children = [...(item.children || []), nodeWithChildren].sort((a, b) => a.position - b.position);
        return { ...item, children };
      }
      if (item.children && item.children.length > 0) {
        return { ...item, children: insertRecursive(item.children) };
      }
      return item;
    });
  }

  return insertRecursive(nodes);
}

// Helper para atualizar nome de nó na árvore sem recarregar tudo do IndexedDB durante digitação
function updateNodeNameInTree(nodes: TreeNode[], targetId: string, newName: string): TreeNode[] {
  return updateNodeInTree(nodes, { id: targetId, name: newName });
}

// Helper incremental para processar evento Realtime de nó sem chamar getTree()
function applyNodeChangeToTree(
  tree: TreeNode[],
  event: { eventType: string; node?: TreeNode; nodeId: string }
): TreeNode[] {
  if (event.eventType === 'DELETE') {
    return removeNodeFromTree(tree, event.nodeId);
  }

  if (!event.node) {
    return tree;
  }

  const node = event.node;
  if (node.deletedAt) {
    return removeNodeFromTree(tree, node.id);
  }

  // Verifica se o nó já existe na árvore
  const existingNode = findNodeInTree(tree, node.id);

  if (!existingNode) {
    return insertNodeIntoTree(tree, node);
  }

  // Se mudou de parentId, move
  if (existingNode.parentId !== node.parentId) {
    const moved = moveNodeInTree(tree, node.id, node.parentId);
    return updateNodeInTree(moved, node);
  }

  // Apenas atualização de propriedades (nome, posição, etc.)
  return updateNodeInTree(tree, node);
}

// Helper para mover nó na árvore mantendo imutabilidade, preservando filhos e profundidade arbitrária
function moveNodeInTree(nodes: TreeNode[], targetId: string, newParentId: string | null): TreeNode[] {
  let extractedNode: TreeNode | null = null;

  // 1. Remove recursivamente o nó da sua localização atual preservando seus filhos
  function removeRecursive(list: TreeNode[]): TreeNode[] {
    const nextList: TreeNode[] = [];
    for (const item of list) {
      if (item.id === targetId) {
        extractedNode = { ...item, parentId: newParentId };
      } else {
        if (item.children && item.children.length > 0) {
          const newChildren = removeRecursive(item.children);
          nextList.push({ ...item, children: newChildren });
        } else {
          nextList.push(item);
        }
      }
    }
    return nextList;
  }

  const listWithoutNode = removeRecursive(nodes);

  if (!extractedNode) {
    return nodes; // Se não encontrou, retorna lista sem modificações
  }

  // 2. Se for para a raiz (newParentId === null), adiciona na lista raiz
  if (!newParentId) {
    return [...listWithoutNode, extractedNode];
  }

  // 3. Insere recursivamente dentro da pasta de destino
  function insertRecursive(list: TreeNode[]): TreeNode[] {
    return list.map((item) => {
      if (item.id === newParentId) {
        return {
          ...item,
          children: [...(item.children || []), extractedNode!],
        };
      }
      if (item.children && item.children.length > 0) {
        return {
          ...item,
          children: insertRecursive(item.children),
        };
      }
      return item;
    });
  }

  return insertRecursive(listWithoutNode);
}

export function AppShell() {
  const [currentUser, setCurrentUser] = useState<AppUser | null>(null);
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [tags, setTags] = useState<TagRecord[]>([]);
  const [activeNode, setActiveNode] = useState<TreeNode | null>(null);
  const [activeNote, setActiveNote] = useState<NoteRecord | null>(null);
  const [remoteNoteUpdate, setRemoteNoteUpdate] = useState<NoteRecord | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    new Set(['folder-estudos', 'folder-direito', 'folder-constitucional', 'folder-financas'])
  );
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('saved');
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);

  // UI state
  const [isMobileDrawerOpen, setIsMobileDrawerOpen] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const [isDraggingSidebar, setIsDraggingSidebar] = useState(false);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      document.documentElement.classList.remove('dark');
      try {
        localStorage.removeItem('theme');
      } catch {
        // ignore
      }
    }
  }, []);

  // 1. Select Note & Load Content
  const selectNode = useCallback(async (node: TreeNode) => {
    if (node.type === 'folder') return;
    setActiveNode(node);
    setRemoteNoteUpdate(null);

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
      try {
        const user = await authService.getCurrentUser();
        setCurrentUser(user);
        if (user) {
          syncEngine.setAuthenticatedUserId(user.id);
          await indexedDbService.migrateLegacyIds(user.id);
          await syncEngine.hydrateFromRemote(user.id);
          await refreshAppData(user.id);
        }
      } catch (err) {
        console.warn('Erro ao inicializar sessão do usuário:', err);
      } finally {
        setIsCheckingAuth(false);
      }
    }
    initUser();
  }, [refreshAppData]);

  // Escuta status de sincronização emitido pelo syncEngine
  useEffect(() => {
    const unsub = syncEngine.onStatusChange((status) => {
      setSyncStatus(status);
    });
    return unsub;
  }, []);

  // Mantém refs atualizadas para evitar re-execução desnecessária do canal Realtime
  const activeNodeRef = useRef<TreeNode | null>(activeNode);
  const activeNoteRef = useRef<NoteRecord | null>(activeNote);

  useEffect(() => {
    activeNodeRef.current = activeNode;
  }, [activeNode]);

  useEffect(() => {
    activeNoteRef.current = activeNote;
  }, [activeNote]);

  // Assinatura única de sincronização remota via Supabase Realtime por sessão de usuário
  // NUNCA recria a conexão quando activeNode ou activeNote mudam
  useEffect(() => {
    if (!currentUser?.id) return;

    const userId = currentUser.id;
    realtimeService.subscribe(userId);

    const unsubRealtime = realtimeService.addListener(async (event) => {
      try {
        const currentActiveNode = activeNodeRef.current;
        const currentActiveNote = activeNoteRef.current;

        if (event.type === 'node') {
          console.log('[REALTIME NODE TITLE]', {
            nodeId: event.nodeId || event.node?.id,
            name: event.node?.name,
            eventType: event.eventType,
          });

          // Atualização cirúrgica e incremental da árvore sem recarregar tudo com getTree()
          setTree((prevTree) => applyNodeChangeToTree(prevTree, event));

          if (event.eventType === 'DELETE' && currentActiveNode && currentActiveNode.id === event.nodeId) {
            setActiveNode(null);
            setActiveNote(null);
          } else if (event.node && currentActiveNode && currentActiveNode.id === event.node.id) {
            if (activeNodeRef.current) {
              activeNodeRef.current = { ...activeNodeRef.current, ...event.node };
            }
            setActiveNode((prev) => (prev ? { ...prev, ...event.node } : null));
          }
        } else if (event.type === 'note') {
          console.log('[REALTIME EVENT]', {
            noteId: event.note?.id,
            version: event.note?.version,
            updatedAt: event.note?.updatedAt,
            eventType: event.eventType,
          });

          if (currentActiveNote && currentActiveNote.id === event.note?.id && event.note) {
            const incomingVersion = Number(event.note.version || 1);
            const knownVersion = Number(activeNoteRef.current?.version || 1);

            // Se for menor ou igual à versão conhecida em memória, é eco da nossa própria sessão
            if (incomingVersion <= knownVersion) {
              console.log('[REALTIME LOCAL ECHO]', {
                noteId: event.note.id,
                version: incomingVersion,
                knownVersion,
              });
              if (activeNoteRef.current) {
                activeNoteRef.current.updatedAt = event.note.updatedAt;
              }
              return;
            }

            console.log('[REALTIME REMOTE CHANGE]', {
              noteId: event.note.id,
              incomingVersion,
              knownVersion,
            });

            // Envia para o NoteEditor através de canal não-destrutivo preservando o cursor
            setRemoteNoteUpdate({ ...event.note });
          }
        } else if (event.type === 'tag' || event.type === 'relation') {
          const updatedTags = await tagService.getTagsWithCount(userId);
          setTags(updatedTags);
        }
      } catch (err) {
        console.warn('[AppShell] Erro no processamento de evento realtime:', err);
      }
    });

    return () => {
      unsubRealtime();
      realtimeService.unsubscribe();
    };
  }, [currentUser?.id]);

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

  // 4. Create Folder - Imediatamente sem pop-up/prompt: cria e ativa edição inline na Sidebar
  const handleCreateFolder = async (parentId?: string | null) => {
    if (!currentUser) return;
    try {
      if (parentId) {
        setExpandedFolders((prev) => new Set(prev).add(parentId));
      }
      const newFolder = await nodeService.createFolder(currentUser.id, 'Nova pasta', parentId || null);
      setTree((prev) => insertNodeIntoTree(prev, newFolder));
      setEditingNodeId(newFolder.id);
    } catch (err) {
      console.warn('Error creating folder:', err);
    }
  };

  // 5. Create Note - Imediatamente sem pop-up/prompt: cria e abre na Página da Nota
  const handleCreateNote = async (parentId?: string | null) => {
    if (!currentUser) return;
    try {
      if (parentId) {
        setExpandedFolders((prev) => new Set(prev).add(parentId));
      }
      const defaultTitle = 'Nova nota';
      const initialMd = `# ${defaultTitle}\n\n`;
      const res = await nodeService.createNote(currentUser.id, defaultTitle, parentId || null, initialMd);
      setTree((prev) => insertNodeIntoTree(prev, res.node));
      selectNode(res.node);
    } catch (err) {
      console.warn('Error creating note:', err);
    }
  };

  // 6. Rename Node (via Sidebar inline edit ou menu)
  const handleRenameNode = (nodeId: string, newName: string) => {
    if (!currentUser) return;
    const finalName = newName.trim();

    // 1. Atualização otimista imediata na árvore da Sidebar (0ms)
    setTree((prevTree) => updateNodeNameInTree(prevTree, nodeId, finalName));

    // 2. Atualiza nó ativo se for o mesmo (passado ao NoteEditor)
    if (activeNodeRef.current && activeNodeRef.current.id === nodeId) {
      activeNodeRef.current.name = finalName;
      setActiveNode((prev) => (prev && prev.id === nodeId ? { ...prev, name: finalName } : prev));
    }

    // 3. Persistência no IndexedDB e sincronização em background (não bloqueia UI)
    nodeService.renameNode(nodeId, finalName).catch((err) => {
      console.warn('Error renaming node:', err);
    });
  };

  // 6b. Live Title Update (digitação no título da nota com resposta visual instantânea e 0 recriações de nó)
  const handleUpdateTitleLive = (nodeId: string, newTitle: string) => {
    const displayName = newTitle;

    // 1. Atualização imediata em memória na árvore (Sidebar atualiza em 0ms)
    setTree((prevTree) => updateNodeNameInTree(prevTree, nodeId, displayName));

    // Atualiza activeNodeRef em memória sem recriar activeNode React state a cada tecla digitada
    if (activeNodeRef.current && activeNodeRef.current.id === nodeId) {
      activeNodeRef.current.name = displayName;
    }
  };

  // 7. Delete Node
  const handleDeleteNode = (nodeId: string) => {
    if (!currentUser) return;
    // 1. Atualização imediata na árvore da UI (0ms)
    setTree((prevTree) => removeNodeFromTree(prevTree, nodeId));
    if (activeNode && activeNode.id === nodeId) {
      setActiveNode(null);
      setActiveNote(null);
    }
    // 2. Persistência no IndexedDB e sincronização em background (não bloqueia UI)
    nodeService.deleteNode(nodeId).catch((err) => {
      console.warn('Error deleting node:', err);
    });
  };

  // 8. Duplicate Note
  const handleDuplicateNote = async (nodeId: string) => {
    if (!currentUser) return;
    try {
      const res = await nodeService.duplicateNote(nodeId, currentUser.id);
      if (res) {
        setTree((prevTree) => insertNodeIntoTree(prevTree, res.node));
        selectNode(res.node);
      }
    } catch (err) {
      console.warn('Error duplicating note:', err);
    }
  };

  // 9. Move Node - Local-first com atualização otimista imediata na UI
  const handleMoveNode = (draggedId: string, targetParentId: string | null) => {
    if (!currentUser || draggedId === targetParentId) return;

    // Guarda estado anterior para possível rollback
    const previousTree = tree;

    // Se o destino for uma pasta, expande ela imediatamente na UI para ver o item inserido
    if (targetParentId) {
      setExpandedFolders((prev) => new Set(prev).add(targetParentId));
    }

    // 1. Atualização otimista imediata da árvore na Sidebar (0ms de latência)
    const optimisticTree = moveNodeInTree(tree, draggedId, targetParentId);
    setTree(optimisticTree);

    // Se o nó movido for o nó ativo, atualiza seu parentId
    if (activeNodeRef.current && activeNodeRef.current.id === draggedId) {
      setActiveNode((prev) => (prev ? { ...prev, parentId: targetParentId } : null));
    }

    // 2. Persiste no IndexedDB e sincroniza em background (não bloqueia a UI)
    nodeService.moveNode(draggedId, targetParentId).then((success) => {
      if (!success) {
        // Rollback se a operação for inválida (ex: ciclo)
        setTree(previousTree);
      }
    }).catch((err) => {
      console.warn('Error moving node:', err);
      setTree(previousTree);
    });
  };

  // 10. Toggle Favorite
  const handleToggleFavorite = (nodeId: string) => {
    if (!currentUser) return;
    const currentFav = activeNode && activeNode.id === nodeId ? !!activeNode.isFavorite : false;
    const nextFav = !currentFav;

    // 1. Atualização imediata do estado React
    setTree((prevTree) => updateNodeInTree(prevTree, { id: nodeId, isFavorite: nextFav }));
    if (activeNode && activeNode.id === nodeId) {
      setActiveNode((prev) => (prev ? { ...prev, isFavorite: nextFav } : null));
    }

    // 2. Persistência local e background sync
    noteService.toggleFavorite(nodeId).catch((err) => {
      console.warn('Error toggling favorite:', err);
    });
  };

  // 11. Save Content (from Editor)
  const handleSaveContent = async (nodeId: string, md: string, json: any): Promise<NoteRecord | null> => {
    try {
      const savedNote = await noteService.saveNote(nodeId, md, json);
      // REGRA DE OURO: NÃO fazer setActiveNote(savedNote) após save LOCAL originado pelo editor!
      // O editor já possui o conteúdo atualizado localmente.
      // Atualizamos apenas o activeNoteRef em memória para manter metadados sincronizados sem re-renderizar o NoteEditor
      if (savedNote && activeNoteRef.current && (activeNoteRef.current.nodeId === nodeId || activeNoteRef.current.id === savedNote.id)) {
        activeNoteRef.current.version = savedNote.version;
        activeNoteRef.current.updatedAt = savedNote.updatedAt;
      }
      // Atualização de contagem de tags DESACOPLADA (fora do caminho crítico)
      if (currentUser) {
        tagService.getTagsWithCount(currentUser.id).then((updatedTags) => {
          setTags(updatedTags);
        }).catch((err) => {
          console.warn('Error updating tags in background:', err);
        });
      }
      return savedNote;
    } catch (err) {
      console.warn('Error saving note:', err);
      setSyncStatus('error');
      return null;
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

  // 1. Loading screen while checking existing session
  if (isCheckingAuth) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[#F9F7F2]">
        <div className="flex flex-col items-center gap-3 text-[#8C7B6E]">
          <div className="w-8 h-8 border-2 border-[#8C7B6E] border-t-transparent rounded-full animate-spin" />
          <span className="font-serif text-sm font-medium tracking-wide">Tá na nota</span>
        </div>
      </div>
    );
  }

  // 2. Authentication Screen when no active session exists
  if (!currentUser) {
    return (
      <AuthScreen
        onAuthenticated={async (user) => {
          setCurrentUser(user);
          await indexedDbService.migrateLegacyIds(user.id);
          await syncEngine.hydrateFromRemote(user.id);
          await refreshAppData(user.id);
        }}
      />
    );
  }

  return (
    <div
      id="app-shell"
      className="flex h-screen w-screen overflow-hidden bg-[#F9F7F2] text-[#3D352E] font-sans paper-texture"
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
          editingNodeId={editingNodeId}
          onFinishInlineEdit={() => setEditingNodeId(null)}
          tags={tags}
          currentUser={currentUser}
          syncStatus={syncStatus}
          onOpenAuth={() => setIsAuthModalOpen(true)}
          onOpenSettings={() => setIsAuthModalOpen(true)}
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
          onFilterByTag={handleTagClick}
        />

        {/* Resizer Handle */}
        <div
          onMouseDown={handleMouseDownResize}
          className={`absolute top-0 right-0 w-1.5 h-full cursor-col-resize hover:bg-[#8C7B6E]/40 transition-colors ${
            isDraggingSidebar ? 'bg-[#8C7B6E]' : ''
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
          editingNodeId={editingNodeId}
          onFinishInlineEdit={() => setEditingNodeId(null)}
          tags={tags}
          currentUser={currentUser}
          syncStatus={syncStatus}
          onOpenAuth={() => setIsAuthModalOpen(true)}
          onOpenSettings={() => setIsAuthModalOpen(true)}
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
      <main id="main-content-canvas" className="flex-1 flex flex-col h-full w-full max-w-[100vw] overflow-hidden relative">
        {/* Mobile Header Toggle: [☰] Tá na nota [🔍] */}
        <div className="md:hidden flex items-center justify-between px-4 py-2.5 bg-[#F9F7F2] border-b border-[#E3DCD2] shrink-0 select-none">
          <button
            onClick={() => setIsMobileDrawerOpen(true)}
            className="p-1.5 text-[#8C7B6E] hover:text-[#3D352E] rounded-md hover:bg-[#E3DCD2] cursor-pointer"
            aria-label="Abrir Menu de Pastas"
          >
            <Menu className="w-5 h-5" />
          </button>
          <span className="font-handwritten font-bold text-2xl text-[#8C7B6E] tracking-normal">
            Tá na nota
          </span>
          <button
            onClick={() => setIsCommandPaletteOpen(true)}
            className="p-1.5 text-[#8C7B6E] hover:text-[#3D352E] rounded-md hover:bg-[#E3DCD2] cursor-pointer"
            aria-label="Buscar"
          >
            <Search className="w-5 h-5" />
          </button>
        </div>

        {/* Note Editor or Empty Selection State */}
        {activeNode && activeNote ? (
          <EditorErrorBoundary key={activeNode.id} fallbackTitle={activeNode.name}>
            <NoteEditor
              node={activeNode}
              note={activeNote}
              syncStatus={syncStatus}
              remoteNoteUpdate={remoteNoteUpdate}
              onRemoteUpdateHandled={() => setRemoteNoteUpdate(null)}
              onUpdateTitle={handleUpdateTitleLive}
              onSaveContent={handleSaveContent}
              onToggleFavorite={handleToggleFavorite}
              onDeleteNote={handleDeleteNode}
              onDuplicateNote={handleDuplicateNote}
              onExportNote={handleExportNote}
              onNavigateToNote={selectNodeById}
              onTagClick={handleTagClick}
            />
          </EditorErrorBoundary>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-[#F9F7F2]">
            <div className="max-w-md space-y-4">
              <div className="w-16 h-16 rounded-2xl bg-[#D9C5B2] text-[#8C7B6E] flex items-center justify-center mx-auto shadow-2xs border border-[#E3DCD2]">
                <BookOpen className="w-8 h-8" />
              </div>
              <h2 className="text-2xl font-serif font-semibold text-[#8C7B6E] tracking-tight">
                Seu Segundo Cérebro Digital
              </h2>
              <p className="text-sm text-[#8C7B6E]/80 leading-relaxed">
                A árvore organiza. A nota armazena. Os links conectam. As tags categorizam. A busca encontra.
              </p>
              <div className="pt-2 flex flex-wrap justify-center gap-2">
                <button
                  onClick={() => handleCreateNote(null)}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#8C7B6E] hover:bg-[#796A5E] text-[#F9F7F2] text-xs font-medium transition-colors cursor-pointer shadow-xs"
                >
                  <FilePlus className="w-4 h-4" /> Criar Primeira Nota
                </button>
                <button
                  onClick={() => handleCreateFolder(null)}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-[#E3DCD2] bg-[#FFFFFF] hover:bg-[#E3DCD2] text-xs font-medium text-[#3D352E] transition-colors cursor-pointer"
                >
                  <FolderPlus className="w-4 h-4 text-[#8C7B6E]" /> Criar Pasta
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
      />

      {/* Auth & Settings Modal */}
      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        currentUser={currentUser}
        syncStatus={syncStatus}
        onExportAll={handleExportAll}
        onUserChanged={async (user) => {
          setCurrentUser(user);
          if (user) {
            await indexedDbService.migrateLegacyIds(user.id);
            await syncEngine.hydrateFromRemote(user.id);
            await refreshAppData(user.id);
          } else {
            setActiveNode(null);
            setActiveNote(null);
            setTree([]);
            setTags([]);
          }
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
            className="w-full max-w-md bg-[#FEFDFA] border border-[#E3DCD2] rounded-xl shadow-xl p-6 text-[#3D352E] relative animate-in fade-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-[#E3DCD2] mb-4">
              <div className="flex items-center gap-2">
                <span className="font-mono font-medium text-xs text-[#8C7B6E] bg-[#E3DCD2] px-2.5 py-0.5 rounded-full border border-[#D9C5B2]">
                  #{selectedTagNotesModal.tagName}
                </span>
                <span className="text-xs text-[#8C7B6E]">
                  ({selectedTagNotesModal.notes.length} {selectedTagNotesModal.notes.length === 1 ? 'nota' : 'notas'})
                </span>
              </div>
              <button
                onClick={() => setSelectedTagNotesModal(null)}
                className="text-[#8C7B6E] hover:text-[#3D352E] p-1 rounded-md transition-colors cursor-pointer"
                aria-label="Fechar"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="text-xs font-semibold text-[#8C7B6E] uppercase tracking-wider mb-2">
              Notas associadas
            </div>

            {selectedTagNotesModal.notes.length === 0 ? (
              <div className="py-6 text-center text-xs text-[#8C7B6E]/70 italic">
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
                    className="w-full flex items-center justify-between p-2.5 rounded-lg bg-[#F9F7F2] hover:bg-[#E3DCD2] border border-[#E3DCD2] text-left transition-colors cursor-pointer group"
                  >
                    <div className="flex items-center gap-2.5 truncate">
                      <FileText className="w-4 h-4 text-[#8C7B6E] shrink-0" />
                      <span className="text-sm font-medium truncate text-[#3D352E]">
                        {n.name}
                      </span>
                    </div>
                    <span className="text-[11px] text-[#8C7B6E] group-hover:text-[#3D352E] shrink-0">
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
