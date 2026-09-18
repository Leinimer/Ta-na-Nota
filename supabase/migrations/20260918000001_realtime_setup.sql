-- ====================================================================
-- MIGRATION: 20260918000001_realtime_setup.sql
-- Description: Configure tables for Supabase Realtime with Postgres Changes
-- Tables: nodes, notes, tags, note_tags, note_links, attachments
-- Ensures full replica identity for DELETE/UPDATE payloads and safe publication addition
-- ====================================================================

-- 1. Ensure REPLICA IDENTITY FULL so that UPDATE and DELETE payloads contain complete row representations
ALTER TABLE public.nodes REPLICA IDENTITY FULL;
ALTER TABLE public.notes REPLICA IDENTITY FULL;
ALTER TABLE public.tags REPLICA IDENTITY FULL;
ALTER TABLE public.note_tags REPLICA IDENTITY FULL;
ALTER TABLE public.note_links REPLICA IDENTITY FULL;
ALTER TABLE public.attachments REPLICA IDENTITY FULL;

-- 2. Safely add required tables to supabase_realtime publication without affecting existing tables
DO $$
BEGIN
  -- nodes
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'nodes'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.nodes;
  END IF;

  -- notes
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'notes'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notes;
  END IF;

  -- tags
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'tags'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.tags;
  END IF;

  -- note_tags
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'note_tags'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.note_tags;
  END IF;

  -- note_links
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'note_links'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.note_links;
  END IF;

  -- attachments
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'attachments'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.attachments;
  END IF;
END $$;
