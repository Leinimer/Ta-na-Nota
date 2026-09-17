-- ====================================================================
-- MIGRATION: 20260917000002_storage_setup.sql
-- Description: Storage bucket and policies for attachments
-- ====================================================================

-- 1. Create attachments bucket if not exists
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'attachments',
  'attachments',
  false,
  52428800, -- 50MB
  ARRAY[
    'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml',
    'application/pdf',
    'video/mp4', 'video/webm',
    'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4'
  ]
)
ON CONFLICT (id) DO NOTHING;

-- 2. Storage RLS Policies
CREATE POLICY "attachments_user_select"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'attachments' AND
  (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "attachments_user_insert"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'attachments' AND
  (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "attachments_user_update"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'attachments' AND
  (storage.foldername(name))[1] = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'attachments' AND
  (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "attachments_user_delete"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'attachments' AND
  (storage.foldername(name))[1] = auth.uid()::text
);
