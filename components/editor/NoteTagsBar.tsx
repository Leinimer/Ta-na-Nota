'use client';

import React, { useState, useEffect, useRef } from 'react';
import { TagRecord } from '@/types';
import { tagService } from '@/services/tagService';
import { Plus, X, Search, Check } from 'lucide-react';

interface NoteTagsBarProps {
  userId: string;
  noteId: string;
  onTagClick?: (tag: TagRecord) => void;
  onTagsUpdated?: () => void;
}

export function NoteTagsBar({
  userId,
  noteId,
  onTagClick,
  onTagsUpdated,
}: NoteTagsBarProps) {
  const [noteTags, setNoteTags] = useState<TagRecord[]>([]);
  const [allUserTags, setAllUserTags] = useState<TagRecord[]>([]);
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);

  const popoverRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Load note tags & user tags
  useEffect(() => {
    let isMounted = true;
    async function loadTags() {
      try {
        const [attached, all] = await Promise.all([
          tagService.getTagsForNote(noteId, userId),
          tagService.getAllUserTags(userId),
        ]);
        if (isMounted) {
          setNoteTags(attached);
          setAllUserTags(all);
        }
      } catch (err) {
        console.warn('Error loading tags for note:', err);
      }
    }
    loadTags();
    return () => {
      isMounted = false;
    };
  }, [noteId, userId]);

  // Focus input when popover opens
  useEffect(() => {
    if (isPopoverOpen) {
      const timer = setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isPopoverOpen]);

  const closePopover = () => {
    setIsPopoverOpen(false);
    setSearchQuery('');
  };

  // Click outside listener
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as HTMLElement)) {
        closePopover();
      }
    }
    if (isPopoverOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isPopoverOpen]);

  const refreshAllTags = async () => {
    try {
      const all = await tagService.getAllUserTags(userId);
      setAllUserTags(all);
    } catch {
      // ignore
    }
  };

  const handleAddTag = async (tagName: string) => {
    const clean = tagName.trim().replace(/^#+/, '');
    if (!clean) return;
    setLoading(true);
    try {
      const updated = await tagService.addTagToNote(userId, noteId, clean);
      setNoteTags(updated);
      await refreshAllTags();
      setSearchQuery('');
      if (onTagsUpdated) onTagsUpdated();
    } catch (err) {
      console.warn('Error adding tag:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveTag = async (tagId: string) => {
    try {
      const updated = await tagService.removeTagFromNote(userId, noteId, tagId);
      setNoteTags(updated);
      await refreshAllTags();
      if (onTagsUpdated) onTagsUpdated();
    } catch (err) {
      console.warn('Error removing tag:', err);
    }
  };

  // Filter existing user tags by query
  const cleanQuery = searchQuery.trim().replace(/^#+/, '').toLowerCase();
  const filteredUserTags = allUserTags.filter((t) =>
    t.normalizedName.includes(cleanQuery)
  );

  const isExactExistingMatch = allUserTags.some(
    (t) => t.normalizedName === cleanQuery
  );

  const attachedTagIds = new Set(noteTags.map((t) => t.id));

  return (
    <div className="relative flex flex-wrap items-center gap-1.5 pt-1">
      {/* 1. Add Tag '+' Button */}
      <div className="relative inline-flex items-center">
        <button
          type="button"
          id="btn-add-note-tag"
          onClick={() => setIsPopoverOpen((prev) => !prev)}
          className="inline-flex items-center justify-center w-5 h-5 rounded-md bg-[#ede8dc] dark:bg-[#332d27] border border-[#ded8cb] dark:border-[#423b34] text-[#5c4e42] dark:text-[#ddd8ce] hover:bg-[#e3ddd0] dark:hover:bg-[#3d3730] transition-colors text-xs font-semibold cursor-pointer shadow-2xs"
          title="Adicionar tag"
          aria-label="Adicionar tag"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>

        {/* Popover Interface */}
        {isPopoverOpen && (
          <div
            ref={popoverRef}
            id="popover-add-tag"
            className="absolute top-7 left-0 z-50 w-64 bg-[#fefdfa] dark:bg-[#282420] border border-[#ded8cb] dark:border-[#423b34] rounded-lg shadow-xl p-3 text-xs text-[#2d2621] dark:text-[#f5f2eb] animate-in fade-in zoom-in-95 duration-150"
          >
            <div className="flex items-center justify-between pb-2 border-b border-[#ded8cb] dark:border-[#423b34] mb-2.5">
              <span className="font-serif font-semibold text-[#4a3f35] dark:text-[#ddd8ce]">
                Adicionar tag
              </span>
              <button
                type="button"
                onClick={() => setIsPopoverOpen(false)}
                className="text-[#7a6e63] hover:text-[#2d2621] p-0.5 rounded cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Input with Search / Auto-hashtag */}
            <div className="relative flex items-center mb-2.5">
              <span className="absolute left-2.5 text-[#7a6e63] font-mono text-xs select-none">
                #
              </span>
              <input
                ref={inputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    if (searchQuery.trim()) {
                      handleAddTag(searchQuery);
                    }
                  } else if (e.key === 'Escape') {
                    setIsPopoverOpen(false);
                  }
                }}
                placeholder="Digite uma tag..."
                className="w-full pl-6 pr-2.5 py-1.5 text-xs bg-[#f1ede4] dark:bg-[#1d1a17] border border-[#ded8cb] dark:border-[#423b34] rounded-md outline-none focus:border-[#5c4e42] dark:focus:border-[#d2c5b5] font-mono placeholder:font-sans placeholder:text-[#7a6e63]"
              />
            </div>

            {/* Create new tag action if text is typed and not already attached */}
            {cleanQuery && !isExactExistingMatch && (
              <button
                type="button"
                disabled={loading}
                onClick={() => handleAddTag(cleanQuery)}
                className="w-full flex items-center gap-1.5 px-2.5 py-1.5 mb-2 rounded-md bg-[#ede8dc] dark:bg-[#332d27] hover:bg-[#e3ddd0] dark:hover:bg-[#3d3730] text-[#5c4e42] dark:text-[#ddd8ce] font-medium text-left cursor-pointer transition-colors"
              >
                <Plus className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">Criar nova tag: <strong className="font-mono">#{cleanQuery}</strong></span>
              </button>
            )}

            {/* Existing user tags list */}
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[#7a6e63] mb-1.5">
                {cleanQuery ? 'Tags encontradas' : 'Tags existentes:'}
              </div>

              {filteredUserTags.length === 0 ? (
                <div className="py-2 text-center text-[11px] text-[#7a6e63] italic">
                  {cleanQuery ? 'Nenhuma tag correspondente.' : 'Nenhuma tag criada ainda.'}
                </div>
              ) : (
                <div className="max-h-36 overflow-y-auto space-y-1 custom-scrollbar pr-0.5">
                  {filteredUserTags.map((tag) => {
                    const isAttached = attachedTagIds.has(tag.id);
                    return (
                      <button
                        key={tag.id}
                        type="button"
                        onClick={() => {
                          if (isAttached) {
                            handleRemoveTag(tag.id);
                          } else {
                            handleAddTag(tag.name);
                          }
                        }}
                        className={`w-full flex items-center justify-between px-2 py-1 rounded-md text-left transition-colors cursor-pointer ${
                          isAttached
                            ? 'bg-[#e3ddd0] dark:bg-[#3d3730] text-[#4a3f35] dark:text-[#f5f2eb] font-medium'
                            : 'hover:bg-[#f1ede4] dark:hover:bg-[#332d27] text-[#5c4e42] dark:text-[#ddd8ce]'
                        }`}
                      >
                        <span className="font-mono">#{tag.name}</span>
                        {isAttached && (
                          <span className="flex items-center text-[10px] text-[#4a6b46] dark:text-[#7ba675]">
                            <Check className="w-3 h-3" />
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 2. Attached Tags List */}
      {noteTags.map((tag) => (
        <div
          key={tag.id}
          className="group inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-mono bg-[#eee8db] dark:bg-[#37312a] text-[#5c4e42] dark:text-[#ded6c9] border border-[#ded8cb] dark:border-[#4a4239] transition-colors shadow-2xs"
        >
          <button
            type="button"
            onClick={() => onTagClick && onTagClick(tag)}
            className="hover:underline cursor-pointer"
            title={`Ver notas com #${tag.name}`}
          >
            #{tag.name}
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleRemoveTag(tag.id);
            }}
            className="opacity-50 group-hover:opacity-100 hover:text-red-700 dark:hover:text-red-400 p-0.5 rounded transition-opacity cursor-pointer"
            title={`Remover #${tag.name} da nota`}
            aria-label={`Remover #${tag.name}`}
          >
            <X className="w-2.5 h-2.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
