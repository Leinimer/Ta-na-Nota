-- ====================================================================
-- MIGRATION: 20260917000003_auth_username_and_isolation.sql
-- Projeto: "Tá na nota"
-- ====================================================================

-- 1. ATUALIZAÇÃO DA TABELA PROFILES
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS username TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email TEXT;

-- Índice único case-insensitive para username (garante unicidade estrita)
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_username_lower 
  ON public.profiles (LOWER(username)) 
  WHERE username IS NOT NULL;

-- Índice para consultas rápidas por email
CREATE INDEX IF NOT EXISTS idx_profiles_email_lower 
  ON public.profiles (LOWER(email)) 
  WHERE email IS NOT NULL;

-- 2. FUNÇÃO E TRIGGER PARA CRIAR/ATUALIZAR PERFIL AUTOMATICAMENTE
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER 
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  base_username TEXT;
  candidate_username TEXT;
  counter INT := 0;
BEGIN
  -- Obtém base de login a partir dos metadados ou do prefixo do email
  base_username := COALESCE(
    NULLIF(TRIM(new.raw_user_meta_data->>'username'), ''),
    split_part(new.email, '@', 1)
  );
  -- Sanitiza: apenas letras, números e sublinhado
  base_username := REGEXP_REPLACE(LOWER(base_username), '[^a-z0-9_]', '', 'g');
  IF base_username = '' OR base_username IS NULL THEN
    base_username := 'user_' || SUBSTRING(new.id::TEXT, 1, 6);
  END IF;

  candidate_username := base_username;
  -- Garante unicidade caso o username já exista
  WHILE EXISTS (SELECT 1 FROM public.profiles WHERE LOWER(username) = candidate_username AND id <> new.id) LOOP
    counter := counter + 1;
    candidate_username := base_username || counter::TEXT;
  END LOOP;

  INSERT INTO public.profiles (id, email, name, display_name, username)
  VALUES (
    new.id,
    new.email,
    COALESCE(new.raw_user_meta_data->>'name', new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    COALESCE(new.raw_user_meta_data->>'name', new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    candidate_username
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    name = COALESCE(public.profiles.name, EXCLUDED.name),
    display_name = COALESCE(public.profiles.display_name, EXCLUDED.display_name),
    username = COALESCE(public.profiles.username, EXCLUDED.username);

  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT OR UPDATE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 3. FUNÇÕES RPC DE AUTENTICAÇÃO E CHECAGEM SEGURA
-- 3.1. Verifica disponibilidade de username (apenas boolean, sem dados sensíveis)
CREATE OR REPLACE FUNCTION public.is_username_available(p_username TEXT)
RETURNS BOOLEAN
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_username IS NULL OR TRIM(p_username) = '' THEN
    RETURN FALSE;
  END IF;

  RETURN NOT EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE LOWER(username) = LOWER(TRIM(p_username))
  );
END;
$$;

-- Controle estrito de execução para is_username_available
REVOKE ALL ON FUNCTION public.is_username_available(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_username_available(TEXT) TO anon, authenticated, service_role;

-- 3.2. Obtém o e-mail pelo username para login com identificador flexível
CREATE OR REPLACE FUNCTION public.get_email_by_username(p_username TEXT)
RETURNS TEXT
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_email TEXT;
BEGIN
  IF p_username IS NULL OR TRIM(p_username) = '' THEN
    RETURN NULL;
  END IF;

  SELECT email INTO v_email
  FROM public.profiles
  WHERE LOWER(username) = LOWER(TRIM(p_username))
  LIMIT 1;

  RETURN v_email;
END;
$$;

-- Controle estrito de execução para get_email_by_username
REVOKE ALL ON FUNCTION public.get_email_by_username(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_email_by_username(TEXT) TO anon, authenticated, service_role;

-- 4. HABILITAÇÃO DE ROW LEVEL SECURITY (RLS)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.note_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.note_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attachments ENABLE ROW LEVEL SECURITY;

-- 5. POLÍTICAS RLS PARA PROFILES
-- O usuário lê e edita apenas o seu próprio perfil.
DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
DROP POLICY IF EXISTS "profiles_select_all" ON public.profiles;
CREATE POLICY "profiles_select_own" ON public.profiles
  FOR SELECT USING (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;
CREATE POLICY "profiles_insert_own" ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- 6. POLÍTICAS RLS PARA NODES
DROP POLICY IF EXISTS "nodes_select_own" ON public.nodes;
CREATE POLICY "nodes_select_own" ON public.nodes
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "nodes_insert_own" ON public.nodes;
CREATE POLICY "nodes_insert_own" ON public.nodes
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "nodes_update_own" ON public.nodes;
CREATE POLICY "nodes_update_own" ON public.nodes
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "nodes_delete_own" ON public.nodes;
CREATE POLICY "nodes_delete_own" ON public.nodes
  FOR DELETE USING (auth.uid() = user_id);

-- 7. POLÍTICAS RLS PARA NOTES
DROP POLICY IF EXISTS "notes_select_own" ON public.notes;
CREATE POLICY "notes_select_own" ON public.notes
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "notes_insert_own" ON public.notes;
CREATE POLICY "notes_insert_own" ON public.notes
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "notes_update_own" ON public.notes;
CREATE POLICY "notes_update_own" ON public.notes
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "notes_delete_own" ON public.notes;
CREATE POLICY "notes_delete_own" ON public.notes
  FOR DELETE USING (auth.uid() = user_id);

-- 8. POLÍTICAS RLS PARA TAGS
DROP POLICY IF EXISTS "tags_select_own" ON public.tags;
CREATE POLICY "tags_select_own" ON public.tags
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "tags_insert_own" ON public.tags;
CREATE POLICY "tags_insert_own" ON public.tags
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "tags_update_own" ON public.tags;
CREATE POLICY "tags_update_own" ON public.tags
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "tags_delete_own" ON public.tags;
CREATE POLICY "tags_delete_own" ON public.tags
  FOR DELETE USING (auth.uid() = user_id);

-- 9. POLÍTICAS RLS PARA NOTE_TAGS (Isolamento mútuo: nota E tag do usuário)
DROP POLICY IF EXISTS "note_tags_all_own" ON public.note_tags;
CREATE POLICY "note_tags_all_own" ON public.note_tags
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.notes
      WHERE notes.id = note_tags.note_id AND notes.user_id = auth.uid()
    )
    AND
    EXISTS (
      SELECT 1 FROM public.tags
      WHERE tags.id = note_tags.tag_id AND tags.user_id = auth.uid()
    )
  );

-- 10. POLÍTICAS RLS PARA NOTE_LINKS (Isolamento mútuo: source E target pertencem ao usuário)
DROP POLICY IF EXISTS "note_links_all_own" ON public.note_links;
CREATE POLICY "note_links_all_own" ON public.note_links
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.notes
      WHERE notes.id = note_links.source_note_id AND notes.user_id = auth.uid()
    )
    AND
    EXISTS (
      SELECT 1 FROM public.notes
      WHERE notes.id = note_links.target_note_id AND notes.user_id = auth.uid()
    )
  );

-- 11. POLÍTICAS RLS PARA ATTACHMENTS
DROP POLICY IF EXISTS "attachments_select_own" ON public.attachments;
CREATE POLICY "attachments_select_own" ON public.attachments
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "attachments_insert_own" ON public.attachments;
CREATE POLICY "attachments_insert_own" ON public.attachments
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "attachments_update_own" ON public.attachments;
CREATE POLICY "attachments_update_own" ON public.attachments
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "attachments_delete_own" ON public.attachments;
CREATE POLICY "attachments_delete_own" ON public.attachments
  FOR DELETE USING (auth.uid() = user_id);

-- 12. CONFIGURAÇÃO DO BUCKET PRIVADO DE STORAGE "attachments"
-- O bucket é mantido estritamente PRIVADO (public = false)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'attachments',
  'attachments',
  false,
  52428800, -- 50MB
  ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml', 'application/pdf', 'text/plain']
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 52428800;

-- Políticas de acesso ao Storage privado restritas exclusivamente ao usuário autenticado e seu diretório (auth.uid())
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'storage' AND tablename = 'objects') THEN
    -- Leitura e geração de Signed URLs permitidas somente pelo dono do arquivo
    EXECUTE 'DROP POLICY IF EXISTS "storage_attachments_select" ON storage.objects;';
    EXECUTE 'CREATE POLICY "storage_attachments_select" ON storage.objects
      FOR SELECT USING (
        bucket_id = ''attachments'' 
        AND auth.role() = ''authenticated''
        AND (storage.foldername(name))[1] = auth.uid()::text
      );';

    -- Upload permitido apenas para a pasta do próprio usuário (auth.uid())
    EXECUTE 'DROP POLICY IF EXISTS "storage_attachments_insert" ON storage.objects;';
    EXECUTE 'CREATE POLICY "storage_attachments_insert" ON storage.objects
      FOR INSERT WITH CHECK (
        bucket_id = ''attachments'' 
        AND auth.role() = ''authenticated''
        AND (storage.foldername(name))[1] = auth.uid()::text
      );';

    -- Atualização permitida apenas pelo dono do arquivo
    EXECUTE 'DROP POLICY IF EXISTS "storage_attachments_update" ON storage.objects;';
    EXECUTE 'CREATE POLICY "storage_attachments_update" ON storage.objects
      FOR UPDATE USING (
        bucket_id = ''attachments'' 
        AND auth.role() = ''authenticated''
        AND (storage.foldername(name))[1] = auth.uid()::text
      );';

    -- Exclusão permitida apenas pelo dono do arquivo
    EXECUTE 'DROP POLICY IF EXISTS "storage_attachments_delete" ON storage.objects;';
    EXECUTE 'CREATE POLICY "storage_attachments_delete" ON storage.objects
      FOR DELETE USING (
        bucket_id = ''attachments'' 
        AND auth.role() = ''authenticated''
        AND (storage.foldername(name))[1] = auth.uid()::text
      );';
  END IF;
END $$;
