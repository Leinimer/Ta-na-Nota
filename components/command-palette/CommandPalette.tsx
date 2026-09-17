'use client';

import React, { useState, useEffect, useRef } from 'react';
import { SearchResults } from '@/types';
import { searchService } from '@/services/searchService';
import {
  Search,
  FileText,
  Folder,
  Tag,
  Plus,
  FolderPlus,
  Download,
  Sparkles,
} from 'lucide-react';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
  onSelectNote: (nodeId: string) => void;
  onSelectFolder: (folderId: string) => void;
  onCreateNote: () => void;
  onCreateFolder: () => void;
  onExportAll: () => void;
}

export function CommandPalette({
  isOpen,
  onClose,
  userId,
  onSelectNote,
  onSelectFolder,
  onCreateNote,
  onCreateFolder,
  onExportAll,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResults>({
    folders: [],
    notes: [],
    contentMatches: [],
    tags: [],
  });
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    let isCurrent = true;
    if (!query.trim()) {
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const res = await searchService.search(query, userId);
        if (isCurrent) {
          setResults(res);
        }
      } catch (err) {
        console.warn('Search error:', err);
      }
    }, 150);

    return () => {
      isCurrent = false;
      clearTimeout(timer);
    };
  }, [query, userId]);

  // Static quick actions when no search query is active
  const staticActions = [
    {
      id: 'create-note',
      label: 'Criar Nova Nota',
      icon: Plus,
      action: () => {
        onCreateNote();
        onClose();
      },
    },
    {
      id: 'create-folder',
      label: 'Criar Nova Pasta',
      icon: FolderPlus,
      action: () => {
        onCreateFolder();
        onClose();
      },
    },
    {
      id: 'export-all',
      label: 'Exportar Tudo (.ZIP)',
      icon: Download,
      action: () => {
        onExportAll();
        onClose();
      },
    },
  ];

  if (!isOpen) return null;

  return (
    <div
      id="command-palette-modal"
      className="fixed inset-0 z-50 flex items-start justify-center pt-20 sm:pt-28 px-4 bg-black/40 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl bg-[#FEFDFA] border border-[#E3DCD2] rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-100 text-[#3D352E]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search Input Bar */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-[#E3DCD2]">
          <Search className="w-5 h-5 text-[#8C7B6E]" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              const val = e.target.value;
              setQuery(val);
              if (!val.trim()) {
                setResults({ folders: [], notes: [], contentMatches: [], tags: [] });
              }
            }}
            placeholder="O que você está procurando? Digite notas, pastas, conteúdo ou #tags..."
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-[#8C7B6E]/70 text-[#3D352E]"
          />
          <kbd className="px-2 py-0.5 text-xs bg-[#E3DCD2] border border-[#D9C5B2] rounded text-[#8C7B6E] font-mono">
            ESC
          </kbd>
        </div>

        {/* Scrollable Results list */}
        <div className="max-h-96 overflow-y-auto p-2 custom-scrollbar space-y-3">
          {/* Quick Actions if query is empty */}
          {!query.trim() && (
            <div>
              <div className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#8C7B6E]">
                Ações Rápidas
              </div>
              <div className="space-y-0.5">
                {staticActions.map((act) => {
                  const Icon = act.icon;
                  return (
                    <button
                      key={act.id}
                      onClick={act.action}
                      className="w-full px-3 py-2 rounded-lg text-left text-xs flex items-center gap-3 hover:bg-[#E3DCD2] transition-colors cursor-pointer text-[#3D352E]"
                    >
                      <div className="w-6 h-6 rounded-md bg-[#E3DCD2] flex items-center justify-center text-[#8C7B6E]">
                        <Icon className="w-3.5 h-3.5" />
                      </div>
                      <span className="font-medium">{act.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Search: Notes by Title */}
          {results.notes.length > 0 && (
            <div>
              <div className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#8C7B6E]">
                Notas ({results.notes.length})
              </div>
              <div className="space-y-0.5">
                {results.notes.map((note) => (
                  <button
                    key={note.id}
                    onClick={() => {
                      onSelectNote(note.id);
                      onClose();
                    }}
                    className="w-full px-3 py-2 rounded-lg text-left text-xs flex items-center gap-2.5 hover:bg-[#E3DCD2] transition-colors cursor-pointer text-[#3D352E]"
                  >
                    <FileText className="w-4 h-4 text-[#8C7B6E] shrink-0" />
                    <span className="font-medium truncate">{note.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Search: Content matches with snippet */}
          {results.contentMatches.length > 0 && (
            <div>
              <div className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#8C7B6E]">
                Trechos no Conteúdo ({results.contentMatches.length})
              </div>
              <div className="space-y-0.5">
                {results.contentMatches.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => {
                      onSelectNote(item.nodeId);
                      onClose();
                    }}
                    className="w-full px-3 py-2 rounded-lg text-left text-xs hover:bg-[#E3DCD2] transition-colors cursor-pointer text-[#3D352E]"
                  >
                    <div className="font-medium text-[#8C7B6E] flex items-center gap-1.5">
                      <FileText className="w-3.5 h-3.5" /> {item.name}
                    </div>
                    <div className="text-[11px] text-[#7A6B5F] font-serif italic truncate mt-0.5">
                      &ldquo;{item.snippet}&rdquo;
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Search: Folders */}
          {results.folders.length > 0 && (
            <div>
              <div className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#8C7B6E]">
                Pastas ({results.folders.length})
              </div>
              <div className="space-y-0.5">
                {results.folders.map((folder) => (
                  <button
                    key={folder.id}
                    onClick={() => {
                      onSelectFolder(folder.id);
                      onClose();
                    }}
                    className="w-full px-3 py-2 rounded-lg text-left text-xs flex items-center gap-2.5 hover:bg-[#E3DCD2] transition-colors cursor-pointer text-[#3D352E]"
                  >
                    <Folder className="w-4 h-4 text-[#8C7B6E] shrink-0" />
                    <span className="font-medium truncate">{folder.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Search: Tags */}
          {results.tags.length > 0 && (
            <div>
              <div className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#8C7B6E]">
                Etiquetas ({results.tags.length})
              </div>
              <div className="flex flex-wrap gap-1.5 px-3 py-1">
                {results.tags.map((tag) => (
                  <div
                    key={tag.id}
                    className="px-2.5 py-1 rounded-md text-xs font-mono bg-[#E3DCD2] border border-[#D9C5B2] text-[#8C7B6E]"
                  >
                    #{tag.name}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* No results message */}
          {query.trim() &&
            results.notes.length === 0 &&
            results.contentMatches.length === 0 &&
            results.folders.length === 0 &&
            results.tags.length === 0 && (
              <div className="py-10 text-center text-xs text-[#8C7B6E]/70 italic">
                Nenhum resultado encontrado para &ldquo;{query}&rdquo;
              </div>
            )}
        </div>

        {/* Footer info */}
        <div className="px-4 py-2 bg-[#F9F7F2] border-t border-[#E3DCD2] flex items-center justify-between text-[11px] text-[#8C7B6E]">
          <span>Use ⌘K para pesquisar a qualquer momento</span>
          <span className="flex items-center gap-1 font-medium">
            <Sparkles className="w-3 h-3 text-[#8C7B6E]" /> Pesquisa Instantânea
          </span>
        </div>
      </div>
    </div>
  );
}
