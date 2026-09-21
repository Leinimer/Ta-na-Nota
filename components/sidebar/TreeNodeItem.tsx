'use client';

import React, { useState } from 'react';
import { TreeNode } from '@/types';
import {
  Folder,
  FolderOpen,
  FileText,
  ChevronRight,
  ChevronDown,
  MoreVertical,
  Plus,
  Edit2,
  Trash2,
  Copy,
  Star,
  Download,
  FolderPlus,
  Palette,
  Check,
} from 'lucide-react';

export const FOLDER_PALETTE = [
  { id: 'default', label: 'Padrão (Tema)', value: null, hex: '#8C7B6E' },
  { id: 'gray', label: 'Cinza suave', value: '#78716C', hex: '#78716C' },
  { id: 'brown', label: 'Caramelo suave', value: '#A27B5C', hex: '#A27B5C' },
  { id: 'orange', label: 'Laranja suave', value: '#EA580C', hex: '#EA580C' },
  { id: 'yellow', label: 'Amarelo suave', value: '#D97706', hex: '#D97706' },
  { id: 'green', label: 'Verde suave', value: '#16A34A', hex: '#16A34A' },
  { id: 'blue', label: 'Azul suave', value: '#2563EB', hex: '#2563EB' },
  { id: 'purple', label: 'Roxo suave', value: '#7C3AED', hex: '#7C3AED' },
  { id: 'pink', label: 'Rosa suave', value: '#DB2777', hex: '#DB2777' },
  { id: 'red', label: 'Vermelho suave', value: '#DC2626', hex: '#DC2626' },
];

interface TreeNodeItemProps {
  node: TreeNode;
  level?: number;
  parentColor?: string | null;
  activeNodeId: string | null;
  expandedFolders: Set<string>;
  editingNodeId?: string | null;
  selectedNodeIds?: Set<string>;
  onFinishInlineEdit?: () => void;
  onToggleExpand: (folderId: string) => void;
  onSelectNode: (node: TreeNode) => void;
  onNodeClick?: (node: TreeNode, e: React.MouseEvent) => void;
  onCreateChildNote: (parentId: string) => void;
  onCreateChildFolder: (parentId: string) => void;
  onRenameNode: (nodeId: string, newName: string) => void;
  onDeleteNode: (nodeId: string) => void;
  onSetNodeColor?: (nodeId: string, color: string | null) => void;
  onDuplicateNote: (nodeId: string) => void;
  onToggleFavorite: (nodeId: string) => void;
  onExportNote: (nodeId: string) => void;
  onMoveNode: (draggedId: string, targetParentId: string | null) => void;
  onMoveMultipleNodes?: (draggedIds: string[], targetParentId: string | null) => void;
}

export function TreeNodeItem({
  node,
  level = 0,
  parentColor = null,
  activeNodeId,
  expandedFolders,
  editingNodeId,
  selectedNodeIds,
  onFinishInlineEdit,
  onToggleExpand,
  onSelectNode,
  onNodeClick,
  onCreateChildNote,
  onCreateChildFolder,
  onRenameNode,
  onDeleteNode,
  onSetNodeColor,
  onDuplicateNote,
  onToggleFavorite,
  onExportNote,
  onMoveNode,
  onMoveMultipleNodes,
}: TreeNodeItemProps) {
  const [isLocalEditing, setIsLocalEditing] = useState(false);
  const isEditing = isLocalEditing || editingNodeId === node.id;
  const [editName, setEditName] = useState(node.name);
  const [showMenu, setShowMenu] = useState(false);
  const [showColorSubmenu, setShowColorSubmenu] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  // Resolução hierárquica visual: se o nó tem cor própria, prevalece; senão, herda do pai
  const effectiveColor = node.color || parentColor || null;

  // Sync editName when node.name updates and we are not currently editing
  const [prevNodeName, setPrevNodeName] = useState(node.name);
  if (node.name !== prevNodeName) {
    setPrevNodeName(node.name);
    if (!isEditing) {
      setEditName(node.name);
    }
  }

  const isFolder = node.type === 'folder';
  const isExpanded = expandedFolders.has(node.id);
  const isActive = activeNodeId === node.id;
  const isSelected = selectedNodeIds ? selectedNodeIds.has(node.id) : false;

  const handleFinishRename = () => {
    setIsLocalEditing(false);
    if (onFinishInlineEdit) onFinishInlineEdit();
    if (editName.trim() && editName.trim() !== node.name) {
      onRenameNode(node.id, editName.trim());
    } else {
      setEditName(node.name);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleFinishRename();
    if (e.key === 'Escape') {
      setIsLocalEditing(false);
      if (onFinishInlineEdit) onFinishInlineEdit();
      setEditName(node.name);
    }
  };

  // Drag and drop handlers
  const handleDragStart = (e: React.DragEvent) => {
    e.stopPropagation();
    // Se o nó arrastado fizer parte dos selecionados (e houver mais de um selecionado), move o grupo!
    if (selectedNodeIds && selectedNodeIds.has(node.id) && selectedNodeIds.size > 1) {
      const idsArray = Array.from(selectedNodeIds);
      e.dataTransfer.setData('application/json', JSON.stringify({ ids: idsArray }));
      e.dataTransfer.setData('text/plain', node.id);
    } else {
      e.dataTransfer.setData('text/plain', node.id);
    }
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isDragOver) setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    let multipleIds: string[] | null = null;
    try {
      const jsonData = e.dataTransfer.getData('application/json');
      if (jsonData) {
        const parsed = JSON.parse(jsonData);
        if (Array.isArray(parsed.ids)) {
          multipleIds = parsed.ids;
        }
      }
    } catch {
      multipleIds = null;
    }

    const targetParentId = isFolder ? node.id : node.parentId;

    if (multipleIds && multipleIds.length > 0) {
      if (onMoveMultipleNodes) {
        onMoveMultipleNodes(multipleIds, targetParentId);
      } else {
        multipleIds.forEach((id) => {
          if (id !== node.id) {
            onMoveNode(id, targetParentId);
          }
        });
      }
    } else {
      const draggedId = e.dataTransfer.getData('text/plain');
      if (draggedId && draggedId !== node.id) {
        onMoveNode(draggedId, targetParentId);
      }
    }
  };

  return (
    <div className="select-none group/item relative" data-tree-node-id={node.id}>
      <div
        id={`tree-node-${node.id}`}
        data-tree-node-id={node.id}
        draggable={!isEditing}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={(e) => {
          if (onNodeClick) {
            onNodeClick(node, e);
          } else {
            if (isFolder) {
              onToggleExpand(node.id);
            } else {
              onSelectNode(node);
            }
          }
        }}
        style={{ paddingLeft: `${Math.max(8, level * 18 + 8)}px` }}
        className={`
          flex items-center gap-1.5 py-1.5 pr-2 rounded-md text-sm transition-all cursor-pointer relative
          ${
            isActive
              ? 'bg-[#D9C5B2] font-medium text-[#3D352E] border-l-2 border-[#8C7B6E]'
              : isSelected
              ? 'bg-[#D9C5B2]/70 font-medium text-[#3D352E] ring-1 ring-[#8C7B6E]/60'
              : 'text-[#3D352E] hover:bg-[#E3DCD2]'
          }
          ${isDragOver ? 'ring-2 ring-[#8C7B6E] bg-[#D9C5B2]/60' : ''}
        `}
      >
        {/* Expansion arrow for folders or spacer for notes */}
        {isFolder ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand(node.id);
            }}
            className="w-4 h-4 flex items-center justify-center text-[#8C7B6E] hover:text-[#3D352E] p-0.5 cursor-pointer"
          >
            {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </button>
        ) : (
          <span className="w-4 h-4" />
        )}

        {/* Folder Icon with resolved effectiveColor or Note Icon */}
        <span className="shrink-0 flex items-center justify-center">
          {isFolder ? (
            isExpanded ? (
              <FolderOpen
                className="w-4 h-4 transition-colors"
                style={{ color: effectiveColor || '#8C7B6E' }}
              />
            ) : (
              <Folder
                className="w-4 h-4 transition-colors"
                style={{ color: effectiveColor || '#8C7B6E' }}
              />
            )
          ) : (
            <FileText className="w-4 h-4 text-[#8C7B6E]" />
          )}
        </span>

        {/* Title or Inline Edit */}
        {isEditing ? (
          <input
            type="text"
            autoFocus
            value={editName}
            onFocus={(e) => e.target.select()}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setEditName(e.target.value)}
            onBlur={handleFinishRename}
            onKeyDown={handleKeyDown}
            className="flex-1 bg-[#FFFFFF] px-1.5 py-0.5 rounded border border-[#8C7B6E] text-xs outline-none text-[#3D352E]"
          />
        ) : (
          <span
            onDoubleClick={(e) => {
              e.stopPropagation();
              setIsLocalEditing(true);
            }}
            className={`flex-1 truncate text-xs sm:text-sm tracking-tight ${!node.name ? 'text-[#8C7B6E]/70 italic' : ''}`}
          >
            {node.name || (isFolder ? 'Nova pasta' : 'Sem título')}
          </span>
        )}

        {/* Explicit Color Dot for folders that define their own color */}
        {isFolder && node.color && (
          <span
            className="w-2 h-2 rounded-full border border-black/10 shrink-0"
            style={{ backgroundColor: node.color }}
            title={`Cor da pasta: ${node.color}`}
          />
        )}

        {/* Favorite indicator for notes */}
        {!isFolder && node.isFavorite && (
          <Star className="w-3 h-3 fill-amber-500 text-amber-500 shrink-0" />
        )}

        {/* Action Menu Trigger: sempre visível no mobile, hover/focus no desktop */}
        <div className="opacity-100 sm:opacity-0 group-hover/item:opacity-100 group-focus-within/item:opacity-100 transition-opacity flex items-center gap-0.5">
          {isFolder && (
            <button
              title="Nova Nota Nesta Pasta"
              onClick={(e) => {
                e.stopPropagation();
                onCreateChildNote(node.id);
              }}
              className="p-1 text-[#8C7B6E] hover:text-[#3D352E] hover:bg-[#D9C5B2]/50 rounded cursor-pointer"
            >
              <Plus className="w-3 h-3" />
            </button>
          )}

          <button
            title="Mais Opções"
            aria-label="Mais ações"
            onClick={(e) => {
              e.stopPropagation();
              setShowColorSubmenu(false);
              setShowMenu(!showMenu);
            }}
            className="p-1.5 text-[#8C7B6E] hover:text-[#3D352E] hover:bg-[#D9C5B2]/50 rounded cursor-pointer min-w-[28px] min-h-[28px] flex items-center justify-center"
          >
            <MoreVertical className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Context Dropdown */}
        {showMenu && (
          <>
            <div
              className="fixed inset-0 z-30"
              onClick={() => {
                setShowMenu(false);
                setShowColorSubmenu(false);
              }}
            />
            <div
              className="absolute right-2 top-full mt-1 z-40 w-52 bg-[#FEFDFA] border border-[#E3DCD2] rounded-lg shadow-lg py-1 text-xs text-[#3D352E] animate-in fade-in zoom-in-95 duration-100"
              onClick={(e) => e.stopPropagation()}
            >
              {isFolder ? (
                <>
                  <button
                    onClick={() => {
                      setShowMenu(false);
                      setShowColorSubmenu(false);
                      onCreateChildNote(node.id);
                    }}
                    className="w-full text-left px-3 py-1.5 hover:bg-[#E3DCD2] flex items-center gap-2 cursor-pointer text-[#3D352E]"
                  >
                    <Plus className="w-3.5 h-3.5 text-[#8C7B6E]" /> Nova nota dentro da pasta
                  </button>
                  <button
                    onClick={() => {
                      setShowMenu(false);
                      setShowColorSubmenu(false);
                      onCreateChildFolder(node.id);
                    }}
                    className="w-full text-left px-3 py-1.5 hover:bg-[#E3DCD2] flex items-center gap-2 cursor-pointer text-[#3D352E]"
                  >
                    <FolderPlus className="w-3.5 h-3.5 text-[#8C7B6E]" /> Nova subpasta
                  </button>
                  <button
                    onClick={() => {
                      setShowMenu(false);
                      setShowColorSubmenu(false);
                      setIsLocalEditing(true);
                    }}
                    className="w-full text-left px-3 py-1.5 hover:bg-[#E3DCD2] flex items-center gap-2 cursor-pointer text-[#3D352E]"
                  >
                    <Edit2 className="w-3.5 h-3.5 text-[#8C7B6E]" /> Renomear
                  </button>

                  {/* Alterar cor */}
                  <button
                    onClick={() => setShowColorSubmenu((prev) => !prev)}
                    className="w-full text-left px-3 py-1.5 hover:bg-[#E3DCD2] flex items-center justify-between gap-2 cursor-pointer text-[#3D352E]"
                  >
                    <div className="flex items-center gap-2">
                      <Palette className="w-3.5 h-3.5 text-[#8C7B6E]" />
                      <span>Alterar cor</span>
                    </div>
                    {node.color && (
                      <span
                        className="w-2.5 h-2.5 rounded-full border border-black/10 shrink-0"
                        style={{ backgroundColor: node.color }}
                      />
                    )}
                  </button>

                  {/* Submenu da paleta de cores */}
                  {showColorSubmenu && (
                    <div className="px-2.5 py-2 bg-[#F9F7F2] border-y border-[#E3DCD2] space-y-1.5 my-1">
                      <div className="flex items-center justify-between text-[10px] font-semibold text-[#8C7B6E] uppercase px-0.5">
                        <span>Paleta de Cores</span>
                        {node.color && (
                          <button
                            type="button"
                            onClick={() => {
                              if (onSetNodeColor) onSetNodeColor(node.id, null);
                              setShowMenu(false);
                              setShowColorSubmenu(false);
                            }}
                            className="text-[#8C7B6E] hover:text-red-600 transition-colors font-normal lowercase cursor-pointer"
                          >
                            remover cor
                          </button>
                        )}
                      </div>
                      <div className="grid grid-cols-5 gap-1.5 py-0.5">
                        {FOLDER_PALETTE.map((pal) => {
                          const isCurrent = (node.color || null) === pal.value;
                          return (
                            <button
                              key={pal.id}
                              type="button"
                              title={pal.label}
                              onClick={() => {
                                if (onSetNodeColor) onSetNodeColor(node.id, pal.value);
                                setShowMenu(false);
                                setShowColorSubmenu(false);
                              }}
                              className={`w-6 h-6 rounded-md flex items-center justify-center border transition-all cursor-pointer ${
                                isCurrent
                                  ? 'ring-2 ring-[#3D352E] border-transparent scale-110 shadow-xs'
                                  : 'border-[#E3DCD2] hover:scale-105'
                              }`}
                              style={{ backgroundColor: pal.hex }}
                            >
                              {isCurrent && <Check className="w-3 h-3 text-white stroke-[3]" />}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div className="h-px bg-[#E3DCD2] my-1" />

                  <button
                    onClick={() => {
                      setShowMenu(false);
                      setShowColorSubmenu(false);
                      onDeleteNode(node.id);
                    }}
                    className="w-full text-left px-3 py-1.5 hover:bg-red-50 text-red-600 flex items-center gap-2 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Excluir
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => {
                      setShowMenu(false);
                      onToggleFavorite(node.id);
                    }}
                    className="w-full text-left px-3 py-1.5 hover:bg-[#E3DCD2] flex items-center gap-2 cursor-pointer text-[#3D352E]"
                  >
                    <Star
                      className={`w-3.5 h-3.5 ${node.isFavorite ? 'fill-amber-500 text-amber-500' : 'text-[#8C7B6E]'}`}
                    />
                    <span>{node.isFavorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}</span>
                  </button>
                  <button
                    onClick={() => {
                      setShowMenu(false);
                      onDuplicateNote(node.id);
                    }}
                    className="w-full text-left px-3 py-1.5 hover:bg-[#E3DCD2] flex items-center gap-2 cursor-pointer text-[#3D352E]"
                  >
                    <Copy className="w-3.5 h-3.5 text-[#8C7B6E]" /> Duplicar Nota
                  </button>
                  <button
                    onClick={() => {
                      setShowMenu(false);
                      onExportNote(node.id);
                    }}
                    className="w-full text-left px-3 py-1.5 hover:bg-[#E3DCD2] flex items-center gap-2 cursor-pointer text-[#3D352E]"
                  >
                    <Download className="w-3.5 h-3.5 text-[#8C7B6E]" /> Exportar Markdown
                  </button>
                  <button
                    onClick={() => {
                      setShowMenu(false);
                      setIsLocalEditing(true);
                    }}
                    className="w-full text-left px-3 py-1.5 hover:bg-[#E3DCD2] flex items-center gap-2 cursor-pointer text-[#3D352E]"
                  >
                    <Edit2 className="w-3.5 h-3.5 text-[#8C7B6E]" /> Renomear
                  </button>
                  <div className="h-px bg-[#E3DCD2] my-1" />
                  <button
                    onClick={() => {
                      setShowMenu(false);
                      onDeleteNode(node.id);
                    }}
                    className="w-full text-left px-3 py-1.5 hover:bg-red-50 text-red-600 flex items-center gap-2 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Excluir
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </div>

      {/* Recursive Children for expanded folders - passing effectiveColor down for visual inheritance */}
      {isFolder && isExpanded && node.children && node.children.length > 0 && (
        <div className="flex flex-col">
          {node.children.map((child) => (
            <TreeNodeItem
              key={child.id}
              node={child}
              level={level + 1}
              parentColor={effectiveColor}
              activeNodeId={activeNodeId}
              expandedFolders={expandedFolders}
              editingNodeId={editingNodeId}
              selectedNodeIds={selectedNodeIds}
              onNodeClick={onNodeClick}
              onFinishInlineEdit={onFinishInlineEdit}
              onToggleExpand={onToggleExpand}
              onSelectNode={onSelectNode}
              onCreateChildNote={onCreateChildNote}
              onCreateChildFolder={onCreateChildFolder}
              onRenameNode={onRenameNode}
              onDeleteNode={onDeleteNode}
              onSetNodeColor={onSetNodeColor}
              onDuplicateNote={onDuplicateNote}
              onToggleFavorite={onToggleFavorite}
              onExportNote={onExportNote}
              onMoveNode={onMoveNode}
              onMoveMultipleNodes={onMoveMultipleNodes}
            />
          ))}
        </div>
      )}

      {/* Empty folder placeholder */}
      {isFolder && isExpanded && (!node.children || node.children.length === 0) && (
        <div
          style={{ paddingLeft: `${(level + 1) * 18 + 16}px` }}
          className="py-1 text-[11px] text-[#8C7B6E]/70 italic"
        >
          Pasta vazia
        </div>
      )}
    </div>
  );
}
