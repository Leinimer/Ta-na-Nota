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
} from 'lucide-react';

interface TreeNodeItemProps {
  node: TreeNode;
  level?: number;
  activeNodeId: string | null;
  expandedFolders: Set<string>;
  onToggleExpand: (folderId: string) => void;
  onSelectNode: (node: TreeNode) => void;
  onCreateChildNote: (parentId: string) => void;
  onCreateChildFolder: (parentId: string) => void;
  onRenameNode: (nodeId: string, newName: string) => void;
  onDeleteNode: (nodeId: string) => void;
  onDuplicateNote: (nodeId: string) => void;
  onToggleFavorite: (nodeId: string) => void;
  onExportNote: (nodeId: string) => void;
  onMoveNode: (draggedId: string, targetParentId: string | null) => void;
}

export function TreeNodeItem({
  node,
  level = 0,
  activeNodeId,
  expandedFolders,
  onToggleExpand,
  onSelectNode,
  onCreateChildNote,
  onCreateChildFolder,
  onRenameNode,
  onDeleteNode,
  onDuplicateNote,
  onToggleFavorite,
  onExportNote,
  onMoveNode,
}: TreeNodeItemProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(node.name);
  const [showMenu, setShowMenu] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  const isFolder = node.type === 'folder';
  const isExpanded = expandedFolders.has(node.id);
  const isActive = activeNodeId === node.id;

  const handleFinishRename = () => {
    setIsEditing(false);
    if (editName.trim() && editName.trim() !== node.name) {
      onRenameNode(node.id, editName.trim());
    } else {
      setEditName(node.name);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleFinishRename();
    if (e.key === 'Escape') {
      setIsEditing(false);
      setEditName(node.name);
    }
  };

  // Drag and drop handlers
  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('text/plain', node.id);
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
    const draggedId = e.dataTransfer.getData('text/plain');
    if (draggedId && draggedId !== node.id) {
      if (isFolder) {
        onMoveNode(draggedId, node.id);
      } else {
        onMoveNode(draggedId, node.parentId);
      }
    }
  };

  return (
    <div className="select-none group/item relative">
      <div
        id={`tree-node-${node.id}`}
        draggable={!isEditing}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => {
          if (isFolder) {
            onToggleExpand(node.id);
          } else {
            onSelectNode(node);
          }
        }}
        style={{ paddingLeft: `${Math.max(8, level * 18 + 8)}px` }}
        className={`
          flex items-center gap-1.5 py-1.5 pr-2 rounded-md text-sm transition-all cursor-pointer relative
          ${
            isActive
              ? 'bg-[#D9C5B2] font-medium text-[#3D352E] border-l-2 border-[#8C7B6E]'
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

        {/* Icon */}
        <span className="text-[#8C7B6E] shrink-0">
          {isFolder ? (
            isExpanded ? (
              <FolderOpen className="w-4 h-4 text-[#8C7B6E]" />
            ) : (
              <Folder className="w-4 h-4 text-[#8C7B6E]" />
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
              setIsEditing(true);
            }}
            className="flex-1 truncate text-xs sm:text-sm tracking-tight"
          >
            {node.name}
          </span>
        )}

        {/* Favorite indicator for notes */}
        {!isFolder && node.isFavorite && (
          <Star className="w-3 h-3 fill-amber-500 text-amber-500 shrink-0" />
        )}

        {/* Hover Action Menu Trigger */}
        <div className="opacity-0 group-hover/item:opacity-100 transition-opacity flex items-center gap-0.5">
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
            onClick={(e) => {
              e.stopPropagation();
              setShowMenu(!showMenu);
            }}
            className="p-1 text-[#8C7B6E] hover:text-[#3D352E] hover:bg-[#D9C5B2]/50 rounded cursor-pointer"
          >
            <MoreVertical className="w-3 h-3" />
          </button>
        </div>

        {/* Context Dropdown */}
        {showMenu && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setShowMenu(false)} />
            <div
              className="absolute right-2 top-full mt-1 z-40 w-44 bg-[#FEFDFA] border border-[#E3DCD2] rounded-lg shadow-lg py-1 text-xs text-[#3D352E] animate-in fade-in zoom-in-95 duration-100"
              onClick={(e) => e.stopPropagation()}
            >
              {isFolder ? (
                <>
                  <button
                    onClick={() => {
                      setShowMenu(false);
                      onCreateChildNote(node.id);
                    }}
                    className="w-full text-left px-3 py-1.5 hover:bg-[#E3DCD2] flex items-center gap-2 cursor-pointer text-[#3D352E]"
                  >
                    <Plus className="w-3.5 h-3.5 text-[#8C7B6E]" /> Nova Nota
                  </button>
                  <button
                    onClick={() => {
                      setShowMenu(false);
                      onCreateChildFolder(node.id);
                    }}
                    className="w-full text-left px-3 py-1.5 hover:bg-[#E3DCD2] flex items-center gap-2 cursor-pointer text-[#3D352E]"
                  >
                    <FolderPlus className="w-3.5 h-3.5 text-[#8C7B6E]" /> Nova Subpasta
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
                    <Star className={`w-3.5 h-3.5 ${node.isFavorite ? 'fill-amber-500 text-amber-500' : 'text-[#8C7B6E]'}`} />
                    {node.isFavorite ? 'Remover dos Favoritos' : 'Adicionar aos Favoritos'}
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
                </>
              )}

              <button
                onClick={() => {
                  setShowMenu(false);
                  setIsEditing(true);
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
            </div>
          </>
        )}
      </div>

      {/* Recursive Children for expanded folders */}
      {isFolder && isExpanded && node.children && node.children.length > 0 && (
        <div className="flex flex-col">
          {node.children.map((child) => (
            <TreeNodeItem
              key={child.id}
              node={child}
              level={level + 1}
              activeNodeId={activeNodeId}
              expandedFolders={expandedFolders}
              onToggleExpand={onToggleExpand}
              onSelectNode={onSelectNode}
              onCreateChildNote={onCreateChildNote}
              onCreateChildFolder={onCreateChildFolder}
              onRenameNode={onRenameNode}
              onDeleteNode={onDeleteNode}
              onDuplicateNote={onDuplicateNote}
              onToggleFavorite={onToggleFavorite}
              onExportNote={onExportNote}
              onMoveNode={onMoveNode}
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
