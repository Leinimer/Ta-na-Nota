// ====================================================================
// Domain Types for Digital Tactility - Personal Knowledge Base
// ====================================================================

export type NodeType = 'folder' | 'note';

export interface AppUser {
  id: string;
  email?: string;
  displayName?: string;
  name?: string;
  username?: string;
  avatarUrl?: string;
}

export interface TreeNode {
  id: string;
  userId: string;
  parentId: string | null;
  type: NodeType;
  name: string;
  position: number;
  color?: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
  // Computed client-side properties
  isFavorite?: boolean;
  lastOpenedAt?: string | null;
  children?: TreeNode[];
  noteId?: string; // id of the corresponding note record if type === 'note'
}

export interface NoteRecord {
  id: string;
  nodeId: string;
  userId: string;
  markdownContent: string;
  editorContent: any; // Tiptap JSON structure
  isFavorite: boolean;
  lastOpenedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface TagRecord {
  id: string;
  userId: string;
  name: string;
  normalizedName: string;
  createdAt: string;
  count?: number;
}

export interface NoteLinkRecord {
  id: string;
  userId: string;
  sourceNoteId: string;
  targetNoteId: string;
  createdAt: string;
}

export type AttachmentStatus = 'pending' | 'uploading' | 'uploaded' | 'failed';

export interface AttachmentRecord {
  id: string;
  userId: string;
  noteId: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  localBlob?: Blob | File | null;
  storagePath: string;
  status: AttachmentStatus;
  createdAt: string;
  updatedAt: string;
  url?: string;
}

export interface BacklinkItem {
  noteId: string;
  nodeId: string;
  title: string;
  snippet?: string;
}

export interface SearchResults {
  folders: Array<{ id: string; name: string }>;
  notes: Array<{ id: string; nodeId: string; name: string }>;
  contentMatches: Array<{ id: string; nodeId: string; name: string; snippet: string }>;
  tags: Array<{ id: string; name: string; noteCount: number }>;
}

export type SyncStatus = 'saved' | 'saving' | 'offline' | 'error';

export interface SyncQueueItem {
  id: string;
  userId: string;
  entityType: 'note' | 'node' | 'tag' | 'note_tags' | 'note_links' | 'attachment';
  entityId: string;
  operation: 'upsert' | 'delete';
  payload: any;
  version: number;
  createdAt: string;
  updatedAt: string;
  attempts: number;
  nextAttemptAt: number;
  status: 'pending' | 'processing' | 'failed';
  lastError?: string;
}
