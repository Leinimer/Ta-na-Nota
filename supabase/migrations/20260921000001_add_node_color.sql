-- Migration: Add color column to nodes table for folder and node customization
ALTER TABLE public.nodes ADD COLUMN IF NOT EXISTS color text DEFAULT NULL;
