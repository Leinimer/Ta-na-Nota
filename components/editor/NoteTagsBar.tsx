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
    <div className="relative flex flex-wrap items-center justify-center gap-1.5 pt-1">
      {/* 1. Add Tag '+' Button */}
      <div className="relative inline-flex items-center">
        <button
          type="button"
          id="btn-add-note-tag"
          onClick={() => setIsPopoverOpen((prev) => !prev)}
          className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-[#E3DCD2] border border-[#D9C5B2] text-[#8C7B6E] hover:bg-[#D9C5B2] transition-colors text-xs font-semibold cursor-pointer shadow-2xs"
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
            className="absolute top-7 left-1/2 -translate-x-1/2 sm:left-0 sm:translate-x-0 z-50 w-64 bg-[#FEFDFA] border border-[#E3DCD2] rounded-lg shadow-xl p-3 text-xs text-[#3D352E] animate-in fade-in zoom-in-95 duration-150"
          >
            <div className="flex items-center justify-between pb-2 border-b border-[#E3DCD2] mb-2.5">
              <span className="font-serif font-semibold text-[#8C7B6E]">
                Adicionar tag
              </span>
              <button
                type="button"
                onClick={() => setIsPopoverOpen(false)}
                className="text-[#8C7B6E] hover:text-[#3D352E] p-0.5 rounded cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Input with Search / Auto-hashtag */}
            <div className="relative flex items-center mb-2.5">
              <span className="absolute left-2.5 text-[#8C7B6E] font-mono text-xs select-none">
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
                className="w-full pl-6 pr-2.5 py-1.5 text-xs bg-[#FFFFFF] border border-[#E3DCD2] rounded-md outline-none focus:border-[#8C7B6E] font-mono placeholder:font-sans placeholder:text-[#8C7B6E]/60 text-[#3D352E]"
              />
            </div>

            {/* Create new tag action if text is typed and not already attached */}
            {cleanQuery && !isExactExistingMatch && (
              <button
                type="button"
                disabled={loading}
                onClick={() => handleAddTag(cleanQuery)}
                className="w-full flex items-center gap-1.5 px-2.5 py-1.5 mb-2 rounded-md bg-[#E3DCD2] hover:bg-[#D9C5B2] text-[#8C7B6E] font-medium text-left cursor-pointer transition-colors"
              >
                <Plus className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">Criar nova tag: <strong className="font-mono">#{cleanQuery}</strong></span>
              </button>
            )}

            {/* Existing user tags list */}
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[#8C7B6E] mb-1.5">
                {cleanQuery ? 'Tags encontradas' : 'Tags existentes:'}
              </div>

              {filteredUserTags.length === 0 ? (
                <div className="py-2 text-center text-[11px] text-[#8C7B6E]/70 italic">
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
                            ? 'bg-[#D9C5B2] text-[#3D352E] font-medium'
                            : 'hover:bg-[#E3DCD2] text-[#3D352E]'
                        }`}
                      >
                        <span className="font-mono">#{tag.name}</span>
                        {isAttached && (
                          <span className="flex items-center text-[10px] text-[#8C7B6E]">
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
          className="group inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-sans bg-[#E3DCD2]/70 text-[#8C7B6E] border border-[#D9C5B2]/50 hover:bg-[#E3DCD2] transition-colors shadow-2xs font-medium"
        >
          <button
            type="button"
            onClick={() => onTagClick && onTagClick(tag)}
            className="hover:underline cursor-pointer"
            title={`Ver notas com tag ${tag.name}`}
          >
            {tag.name}
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleRemoveTag(tag.id);
            }}
            className="opacity-50 group-hover:opacity-100 hover:text-red-700 p-0.5 rounded-full transition-opacity cursor-pointer"
            title={`Remover tag ${tag.name}`}
            aria-label={`Remover ${tag.name}`}
          >
            <X className="w-2.5 h-2.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
