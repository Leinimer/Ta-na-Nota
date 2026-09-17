-- ====================================================================
-- MIGRATION: 20260917000001_initial_schema.sql
-- Description: Core schema for Digital Tactility - Personal Knowledge Base
-- Tables: profiles, nodes, notes, tags, note_tags, note_links, attachments
-- Includes: RLS Policies, Indexes, Triggers, Recursive Validation Functions
-- ====================================================================

-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. PROFILES
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles_select_own" ON public.profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "profiles_insert_own" ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- 3. NODES (Folder and Note Hierarchy Tree)
CREATE TABLE IF NOT EXISTS public.nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  parent_id UUID NULL REFERENCES public.nodes(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('folder', 'note')),
  name TEXT NOT NULL,
  position NUMERIC NOT NULL DEFAULT 1000,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ NULL
);

ALTER TABLE public.nodes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "nodes_select_own" ON public.nodes
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "nodes_insert_own" ON public.nodes
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "nodes_update_own" ON public.nodes
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "nodes_delete_own" ON public.nodes
  FOR DELETE USING (auth.uid() = user_id);

-- Indexes for nodes
CREATE INDEX IF NOT EXISTS idx_nodes_user_id ON public.nodes(user_id);
CREATE INDEX IF NOT EXISTS idx_nodes_parent_id ON public.nodes(parent_id);
CREATE INDEX IF NOT EXISTS idx_nodes_user_parent ON public.nodes(user_id, parent_id);
CREATE INDEX IF NOT EXISTS idx_nodes_user_type ON public.nodes(user_id, type);
CREATE INDEX IF NOT EXISTS idx_nodes_user_updated ON public.nodes(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_nodes_deleted ON public.nodes(deleted_at);

-- 4. NOTES (Separated Content & Metadata)
CREATE TABLE IF NOT EXISTS public.notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id UUID UNIQUE NOT NULL REFERENCES public.nodes(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  markdown_content TEXT NOT NULL DEFAULT '',
  editor_content JSONB NULL,
  is_favorite BOOLEAN NOT NULL DEFAULT FALSE,
  last_opened_at TIMESTAMPTZ NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notes_select_own" ON public.notes
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "notes_insert_own" ON public.notes
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "notes_update_own" ON public.notes
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "notes_delete_own" ON public.notes
  FOR DELETE USING (auth.uid() = user_id);

-- Indexes for notes
CREATE INDEX IF NOT EXISTS idx_notes_node_id ON public.notes(node_id);
CREATE INDEX IF NOT EXISTS idx_notes_user_id ON public.notes(user_id);
CREATE INDEX IF NOT EXISTS idx_notes_favorite ON public.notes(user_id, is_favorite) WHERE is_favorite = TRUE;
CREATE INDEX IF NOT EXISTS idx_notes_last_opened ON public.notes(user_id, last_opened_at DESC NULLS LAST);

-- 5. TAGS
CREATE TABLE IF NOT EXISTS public.tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_user_tag UNIQUE (user_id, normalized_name)
);

ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tags_select_own" ON public.tags
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "tags_insert_own" ON public.tags
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "tags_update_own" ON public.tags
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "tags_delete_own" ON public.tags
  FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_tags_user ON public.tags(user_id);
CREATE INDEX IF NOT EXISTS idx_tags_user_normalized ON public.tags(user_id, normalized_name);

-- 6. NOTE_TAGS (Junction Table)
CREATE TABLE IF NOT EXISTS public.note_tags (
  note_id UUID NOT NULL REFERENCES public.notes(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES public.tags(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (note_id, tag_id)
);

ALTER TABLE public.note_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "note_tags_select_own" ON public.note_tags
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "note_tags_insert_own" ON public.note_tags
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "note_tags_delete_own" ON public.note_tags
  FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_note_tags_note ON public.note_tags(note_id);
CREATE INDEX IF NOT EXISTS idx_note_tags_tag ON public.note_tags(tag_id);
CREATE INDEX IF NOT EXISTS idx_note_tags_user ON public.note_tags(user_id);

-- 7. NOTE_LINKS (Internal Note Links & Backlinks)
CREATE TABLE IF NOT EXISTS public.note_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_note_id UUID NOT NULL REFERENCES public.notes(id) ON DELETE CASCADE,
  target_note_id UUID NOT NULL REFERENCES public.notes(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_note_links UNIQUE (source_note_id, target_note_id),
  CONSTRAINT chk_no_self_link CHECK (source_note_id != target_note_id)
);

ALTER TABLE public.note_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "note_links_select_own" ON public.note_links
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "note_links_insert_own" ON public.note_links
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "note_links_delete_own" ON public.note_links
  FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_note_links_source ON public.note_links(source_note_id);
CREATE INDEX IF NOT EXISTS idx_note_links_target ON public.note_links(target_note_id);
CREATE INDEX IF NOT EXISTS idx_note_links_user ON public.note_links(user_id);

-- 8. ATTACHMENTS
CREATE TABLE IF NOT EXISTS public.attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  note_id UUID NOT NULL REFERENCES public.notes(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "attachments_select_own" ON public.attachments
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "attachments_insert_own" ON public.attachments
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "attachments_delete_own" ON public.attachments
  FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_attachments_note ON public.attachments(note_id);
CREATE INDEX IF NOT EXISTS idx_attachments_user ON public.attachments(user_id);

-- 9. TRANSACTIONAL RPC FUNCTIONS

-- Function to atomically create a note (node + note record)
CREATE OR REPLACE FUNCTION public.create_note_atomic(
  p_name TEXT,
  p_parent_id UUID,
  p_markdown_content TEXT DEFAULT '',
  p_editor_content JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_node_id UUID;
  v_note_id UUID;
  v_pos NUMERIC;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Compute next position
  SELECT COALESCE(MAX(position), 0) + 1000 INTO v_pos
  FROM public.nodes
  WHERE user_id = v_user_id AND ((p_parent_id IS NULL AND parent_id IS NULL) OR (parent_id = p_parent_id));

  -- Insert node
  INSERT INTO public.nodes (user_id, parent_id, type, name, position)
  VALUES (v_user_id, p_parent_id, 'note', p_name, v_pos)
  RETURNING id INTO v_node_id;

  -- Insert note content
  INSERT INTO public.notes (node_id, user_id, markdown_content, editor_content)
  VALUES (v_node_id, v_user_id, p_markdown_content, p_editor_content)
  RETURNING id INTO v_note_id;

  RETURN jsonb_build_object(
    'node_id', v_node_id,
    'note_id', v_note_id,
    'name', p_name,
    'parent_id', p_parent_id,
    'position', v_pos
  );
END;
$$;

-- Function to safely move a node ensuring no cyclical descendants
CREATE OR REPLACE FUNCTION public.move_node_atomic(
  p_node_id UUID,
  p_new_parent_id UUID,
  p_new_position NUMERIC
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_cur UUID;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Prevent moving to self
  IF p_node_id = p_new_parent_id THEN
    RAISE EXCEPTION 'Cannot move node inside itself';
  END IF;

  -- Prevent circular hierarchy
  IF p_new_parent_id IS NOT NULL THEN
    v_cur := p_new_parent_id;
    WHILE v_cur IS NOT NULL LOOP
      IF v_cur = p_node_id THEN
        RAISE EXCEPTION 'Cannot move node inside its own descendant';
      END IF;
      SELECT parent_id INTO v_cur FROM public.nodes WHERE id = v_cur AND user_id = v_user_id;
    END LOOP;
  END IF;

  -- Update node
  UPDATE public.nodes
  SET parent_id = p_new_parent_id,
      position = p_new_position,
      updated_at = now()
  WHERE id = p_node_id AND user_id = v_user_id;

  RETURN TRUE;
END;
$$;
