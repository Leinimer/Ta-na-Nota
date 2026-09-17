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
  Moon,
  Sun,
  X,
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
  onToggleTheme: () => void;
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
  onToggleTheme,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResults>({
    folders: [],
    notes: [],
    contentMatches: [],
    tags: [],
  });
  const [selectedIndex, setSelectedIndex] = useState(0);
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
          setSelectedIndex(0);
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
    {
      id: 'toggle-theme',
      label: 'Alternar Tema Claro / Escuro',
      icon: Moon,
      action: () => {
        onToggleTheme();
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
        className="w-full max-w-xl bg-[#ffffff] dark:bg-[#23221e] border border-[#d1c4bc] dark:border-[#44403a] rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-100 text-[#1b1c19] dark:text-[#f2f1ec]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search Input Bar */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-[#eae8e3] dark:border-[#2f2d29]">
          <Search className="w-5 h-5 text-[#7f756e]" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              const val = e.target.value;
              setQuery(val);
              if (!val.trim()) {
                setResults({ folders: [], notes: [], contentMatches: [], tags: [] });
                setSelectedIndex(0);
              }
            }}
            placeholder="O que você está procurando? Digite notas, pastas, conteúdo ou #tags..."
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-[#7f756e]"
          />
          <kbd className="px-2 py-0.5 text-xs bg-[#f5f3ee] dark:bg-[#2c2a26] border border-[#d1c4bc] dark:border-[#44403a] rounded text-[#7f756e]">
            ESC
          </kbd>
        </div>

        {/* Scrollable Results list */}
        <div className="max-h-96 overflow-y-auto p-2 custom-scrollbar space-y-3">
          {/* Quick Actions if query is empty */}
          {!query.trim() && (
            <div>
              <div className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#7f756e]">
                Ações Rápidas
              </div>
              <div className="space-y-0.5">
                {staticActions.map((act) => {
                  const Icon = act.icon;
                  return (
                    <button
                      key={act.id}
                      onClick={act.action}
                      className="w-full px-3 py-2 rounded-lg text-left text-xs flex items-center gap-3 hover:bg-[#f5f3ee] dark:hover:bg-[#2c2a26] transition-colors cursor-pointer"
                    >
                      <div className="w-6 h-6 rounded-md bg-[#f5f3ee] dark:bg-[#2c2a26] flex items-center justify-center text-[#68594d] dark:text-[#d7c3b4]">
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
              <div className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#7f756e]">
                Notas ({results.notes.length})
              </div>
              <div className="space-y-0.5">
                {results.notes.map((note) => (
                  <button
                    key={note.id}
                    onClick={() => {
                      onSelectNote(note.nodeId);
                      onClose();
                    }}
                    className="w-full px-3 py-2 rounded-lg text-left text-xs flex items-center gap-2.5 hover:bg-[#f4dfcb]/40 dark:hover:bg-[#3c3328] transition-colors cursor-pointer"
                  >
                    <FileText className="w-4 h-4 text-[#68594d] shrink-0" />
                    <span className="font-medium truncate">{note.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Search: Content matches with snippet */}
          {results.contentMatches.length > 0 && (
            <div>
              <div className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#7f756e]">
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
                    className="w-full px-3 py-2 rounded-lg text-left text-xs hover:bg-[#f4dfcb]/40 dark:hover:bg-[#3c3328] transition-colors cursor-pointer"
                  >
                    <div className="font-medium text-[#68594d] dark:text-[#d7c3b4] flex items-center gap-1.5">
                      <FileText className="w-3.5 h-3.5" /> {item.name}
                    </div>
                    <div className="text-[11px] text-[#7f756e] font-serif italic truncate mt-0.5">
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
              <div className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#7f756e]">
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
                    className="w-full px-3 py-2 rounded-lg text-left text-xs flex items-center gap-2.5 hover:bg-[#f4dfcb]/40 dark:hover:bg-[#3c3328] transition-colors cursor-pointer"
                  >
                    <Folder className="w-4 h-4 text-[#68594d] shrink-0" />
                    <span className="font-medium truncate">{folder.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Search: Tags */}
          {results.tags.length > 0 && (
            <div>
              <div className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#7f756e]">
                Etiquetas ({results.tags.length})
              </div>
              <div className="flex flex-wrap gap-1.5 px-3 py-1">
                {results.tags.map((tag) => (
                  <div
                    key={tag.id}
                    className="px-2.5 py-1 rounded-full text-xs font-mono bg-[#f5f3ee] dark:bg-[#2c2a26] border border-[#d1c4bc] dark:border-[#44403a] text-[#68594d] dark:text-[#d7c3b4]"
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
              <div className="py-10 text-center text-xs text-[#7f756e] italic">
                Nenhum resultado encontrado para &ldquo;{query}&rdquo;
              </div>
            )}
        </div>

        {/* Footer info */}
        <div className="px-4 py-2 bg-[#f5f3ee] dark:bg-[#201f1c] border-t border-[#eae8e3] dark:border-[#2f2d29] flex items-center justify-between text-[11px] text-[#7f756e]">
          <span>Use ⌘K para pesquisar a qualquer momento</span>
          <span className="flex items-center gap-1">
            <Sparkles className="w-3 h-3 text-[#68594d]" /> Pesquisa Instantânea
          </span>
        </div>
      </div>
    </div>
  );
}
