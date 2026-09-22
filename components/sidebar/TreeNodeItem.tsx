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

export const FOLDER_PASTEL_PALETTE = [
  { id: 'red', label: 'Vermelho pastel', hex: '#FCA5A5' },
  { id: 'orange', label: 'Laranja pastel', hex: '#FDBA74' },
  { id: 'yellow', label: 'Amarelo pastel', hex: '#FDE047' },
  { id: 'green', label: 'Verde pastel', hex: '#86EFAC' },
  { id: 'cyan', label: 'Ciano pastel', hex: '#67E8F9' },
  { id: 'blue', label: 'Azul pastel', hex: '#93C5FD' },
  { id: 'purple', label: 'Roxo pastel', hex: '#C4B5FD' },
  { id: 'lilac', label: 'Lilás pastel', hex: '#E9D5FF' },
  { id: 'pink', label: 'Rosa pastel', hex: '#F9A8D4' },
  { id: 'brown', label: 'Marrom pastel', hex: '#D7CCC8' },
  { id: 'beige', label: 'Bege pastel', hex: '#E6D5B8' },
  { id: 'gray', label: 'Cinza pastel', hex: '#D1D5DB' },
  { id: 'soft-black', label: 'Preto suave', hex: '#4B5563' },
  { id: 'off-white', label: 'Branco / Off-white', hex: '#F3F4F6' },
];

export const FOLDER_PALETTE = FOLDER_PASTEL_PALETTE;

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
            (() => {
              const isCustomColor = Boolean(effectiveColor);
              const folderColor = effectiveColor || '#8C7B6E';
              const lowerColor = effectiveColor?.toLowerCase();
              const isVeryLight = Boolean(
                lowerColor &&
                  (lowerColor === '#f9f7f2' ||
                    lowerColor === '#ffffff' ||
                    lowerColor === '#f3f4f6')
              );
              const strokeColor = isVeryLight
                ? '#8C7B6E'
                : isCustomColor
                ? folderColor
                : 'currentColor';

              return isExpanded ? (
                <FolderOpen
                  className="w-4 h-4 transition-colors"
                  style={{
                    color: strokeColor,
                    fill: isCustomColor ? folderColor : 'transparent',
                  }}
                />
              ) : (
                <Folder
                  className="w-4 h-4 transition-colors"
                  style={{
                    color: strokeColor,
                    fill: isCustomColor ? folderColor : 'transparent',
                  }}
                />
              );
            })()
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
                        className="w-3 h-3 rounded border border-black/10 shrink-0"
                        style={{ backgroundColor: node.color }}
                      />
                    )}
                  </button>

                  {/* Submenu da paleta de cores */}
                  {showColorSubmenu && (
                    <div className="px-2.5 py-2 bg-[#F9F7F2] border-y border-[#E3DCD2] space-y-2 my-1 max-w-[240px]">
                      <div className="flex items-center justify-between text-[10px] font-semibold text-[#8C7B6E] uppercase px-0.5">
                        <span>Cores Pastéis</span>
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
                      <div className="grid grid-cols-7 gap-1 py-0.5">
                        {FOLDER_PASTEL_PALETTE.map((pal) => {
                          const isCurrent = (node.color || '').toLowerCase() === pal.hex.toLowerCase();
                          return (
                            <button
                              key={pal.id}
                              type="button"
                              title={pal.label}
                              onClick={() => {
                                if (onSetNodeColor) onSetNodeColor(node.id, pal.hex);
                                setShowMenu(false);
                                setShowColorSubmenu(false);
                              }}
                              className={`w-5 h-5 rounded-md flex items-center justify-center border transition-all cursor-pointer ${
                                isCurrent
                                  ? 'ring-2 ring-[#3D352E] border-transparent scale-110 shadow-xs'
                                  : 'border-black/15 hover:scale-110'
                              }`}
                              style={{ backgroundColor: pal.hex }}
                            >
                              {isCurrent && <Check className="w-3 h-3 text-[#3D352E] stroke-[3]" />}
                            </button>
                          );
                        })}
                      </div>

                      {/* Escolher outra cor (Color Picker HTML real <input type="color">) */}
                      <label className="flex items-center gap-2 px-2 py-1.5 rounded-md text-xs cursor-pointer hover:bg-[#E3DCD2] text-[#3D352E] transition-colors border border-[#E3DCD2] bg-[#FEFDFA] shadow-2xs relative">
                        <div
                          className="w-4 h-4 rounded border border-black/15 shrink-0"
                          style={{ backgroundColor: node.color || '#93C5FD' }}
                        />
                        <span className="flex-1 text-[11px] font-medium">Escolher outra cor...</span>
                        <input
                          type="color"
                          value={node.color || '#93C5FD'}
                          onChange={(e) => {
                            const hex = e.target.value;
                            if (onSetNodeColor) onSetNodeColor(node.id, hex);
                          }}
                          className="w-6 h-6 opacity-0 absolute right-2 cursor-pointer"
                        />
                      </label>
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
