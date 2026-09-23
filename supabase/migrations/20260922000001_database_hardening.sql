-- ============================================================================
-- MIGRATION: 20260922000001_database_hardening.sql
-- PROJETO: "Tá na nota" (Leinimer/Ta-na-Nota)
-- OBJETIVO: Hardening completo da camada de banco de dados PostgreSQL / Supabase
--
-- PRINCÍPIOS IMPLEMENTADOS:
-- 1. Isolamento multiusuário estrutural (Foreign Keys compostas com user_id)
-- 2. Integridade referencial inviolável e cascade estrito
-- 3. Row Level Security (RLS) granular com least-privilege (TO authenticated)
-- 4. Revogação de privilégios públicos e de 'anon' nas tabelas de dados
-- 5. Funções SECURITY DEFINER blindadas (SET search_path = '', qualificadores totais)
-- 6. RPC save_note_versioned com versão autoritativa gerada pelo banco e pessimistic locking
-- 7. RPCs create_note_atomic e move_node_atomic seguras contra vazamento e ciclos
-- 8. Constraints de domínio CHECK em nodes, notes, tags, attachments e links
-- 9. Normalização automática de tags com trigger nativo
-- 10. Triggers de timestamps atualizados de forma consistente
-- 11. Storage bucket privado com restrição estrita ao prefixo do user_id
-- 12. Índices de alta performance para a árvore, favoritos e sincronização
-- 13. Preservação de REPLICA IDENTITY FULL e supabase_realtime
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. EXTENSÕES BÁSICAS
-- ----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA extensions;

-- ----------------------------------------------------------------------------
-- 2. FUNÇÃO GENÉRICA DE ATUALIZAÇÃO AUTOMÁTICA DE updated_at
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trigger_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := pg_catalog.greatest(pg_catalog.clock_timestamp(), pg_catalog.coalesce(NEW.updated_at, pg_catalog.clock_timestamp()));
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.trigger_set_updated_at() IS 'Garante atualização automática e autoritativa da coluna updated_at';

-- ----------------------------------------------------------------------------
-- 3. CONSTRAINTS ÚNICAS COMPOSTAS (Necessárias para FKs Compostas Multiusuário)
-- ----------------------------------------------------------------------------

-- Em public.nodes: (id, user_id)
ALTER TABLE public.nodes
  DROP CONSTRAINT IF EXISTS uq_nodes_id_user;
ALTER TABLE public.nodes
  ADD CONSTRAINT uq_nodes_id_user UNIQUE (id, user_id);

-- Em public.notes: (id, user_id) e (node_id, user_id)
ALTER TABLE public.notes
  DROP CONSTRAINT IF EXISTS uq_notes_id_user;
ALTER TABLE public.notes
  ADD CONSTRAINT uq_notes_id_user UNIQUE (id, user_id);

ALTER TABLE public.notes
  DROP CONSTRAINT IF EXISTS uq_notes_node_user;
ALTER TABLE public.notes
  ADD CONSTRAINT uq_notes_node_user UNIQUE (node_id, user_id);

-- Em public.tags: (id, user_id)
ALTER TABLE public.tags
  DROP CONSTRAINT IF EXISTS uq_tags_id_user;
ALTER TABLE public.tags
  ADD CONSTRAINT uq_tags_id_user UNIQUE (id, user_id);

-- Em public.attachments: (id, user_id)
ALTER TABLE public.attachments
  DROP CONSTRAINT IF EXISTS uq_attachments_id_user;
ALTER TABLE public.attachments
  ADD CONSTRAINT uq_attachments_id_user UNIQUE (id, user_id);

-- ----------------------------------------------------------------------------
-- 4. CHAVES ESTRANGEIRAS COMPOSTAS COM user_id (ISOLAMENTO FÍSICO MULTIUSUÁRIO)
-- ----------------------------------------------------------------------------

-- 4.1. nodes.parent_id DEVE pertencer ao mesmo user_id do nó filho
ALTER TABLE public.nodes
  DROP CONSTRAINT IF EXISTS nodes_parent_id_fkey,
  DROP CONSTRAINT IF EXISTS fk_nodes_parent_same_user;
ALTER TABLE public.nodes
  ADD CONSTRAINT fk_nodes_parent_same_user
  FOREIGN KEY (parent_id, user_id)
  REFERENCES public.nodes(id, user_id)
  ON DELETE CASCADE;

-- 4.2. notes.node_id DEVE pertencer ao mesmo user_id da nota
ALTER TABLE public.notes
  DROP CONSTRAINT IF EXISTS notes_node_id_fkey,
  DROP CONSTRAINT IF EXISTS fk_notes_node_same_user;
ALTER TABLE public.notes
  ADD CONSTRAINT fk_notes_node_same_user
  FOREIGN KEY (node_id, user_id)
  REFERENCES public.nodes(id, user_id)
  ON DELETE CASCADE;

-- 4.3. note_tags DEVE ligar nota e tag pertencentes ao mesmo user_id
ALTER TABLE public.note_tags
  DROP CONSTRAINT IF EXISTS note_tags_note_id_fkey,
  DROP CONSTRAINT IF EXISTS note_tags_tag_id_fkey,
  DROP CONSTRAINT IF EXISTS fk_note_tags_note_same_user,
  DROP CONSTRAINT IF EXISTS fk_note_tags_tag_same_user;

ALTER TABLE public.note_tags
  ADD CONSTRAINT fk_note_tags_note_same_user
  FOREIGN KEY (note_id, user_id)
  REFERENCES public.notes(id, user_id)
  ON DELETE CASCADE;

ALTER TABLE public.note_tags
  ADD CONSTRAINT fk_note_tags_tag_same_user
  FOREIGN KEY (tag_id, user_id)
  REFERENCES public.tags(id, user_id)
  ON DELETE CASCADE;

-- 4.4. note_links DEVE ligar source_note e target_note do mesmo user_id
ALTER TABLE public.note_links
  DROP CONSTRAINT IF EXISTS note_links_source_note_id_fkey,
  DROP CONSTRAINT IF EXISTS note_links_target_note_id_fkey,
  DROP CONSTRAINT IF EXISTS fk_note_links_source_same_user,
  DROP CONSTRAINT IF EXISTS fk_note_links_target_same_user;

ALTER TABLE public.note_links
  ADD CONSTRAINT fk_note_links_source_same_user
  FOREIGN KEY (source_note_id, user_id)
  REFERENCES public.notes(id, user_id)
  ON DELETE CASCADE;

ALTER TABLE public.note_links
  ADD CONSTRAINT fk_note_links_target_same_user
  FOREIGN KEY (target_note_id, user_id)
  REFERENCES public.notes(id, user_id)
  ON DELETE CASCADE;

-- 4.5. attachments.note_id DEVE pertencer ao mesmo user_id do anexo
ALTER TABLE public.attachments
  DROP CONSTRAINT IF EXISTS attachments_note_id_fkey,
  DROP CONSTRAINT IF EXISTS fk_attachments_note_same_user;
ALTER TABLE public.attachments
  ADD CONSTRAINT fk_attachments_note_same_user
  FOREIGN KEY (note_id, user_id)
  REFERENCES public.notes(id, user_id)
  ON DELETE CASCADE;

-- ----------------------------------------------------------------------------
-- 5. CONSTRAINTS DE DOMÍNIO (CHECK CONSTRAINTS)
-- ----------------------------------------------------------------------------

-- 5.1. NODES
ALTER TABLE public.nodes
  DROP CONSTRAINT IF EXISTS chk_nodes_name_not_empty,
  DROP CONSTRAINT IF EXISTS chk_nodes_position_non_negative,
  DROP CONSTRAINT IF EXISTS chk_nodes_color_format,
  DROP CONSTRAINT IF EXISTS chk_nodes_no_self_parent;

ALTER TABLE public.nodes
  ADD CONSTRAINT chk_nodes_name_not_empty
  CHECK (length(trim(name)) > 0);

ALTER TABLE public.nodes
  ADD CONSTRAINT chk_nodes_position_non_negative
  CHECK (position >= 0);

ALTER TABLE public.nodes
  ADD CONSTRAINT chk_nodes_color_format
  CHECK (color IS NULL OR color ~* '^#[0-9a-f]{6}$');

ALTER TABLE public.nodes
  ADD CONSTRAINT chk_nodes_no_self_parent
  CHECK (parent_id IS NULL OR parent_id <> id);

-- 5.2. NOTES
ALTER TABLE public.notes
  DROP CONSTRAINT IF EXISTS chk_notes_version_positive;

ALTER TABLE public.notes
  ADD CONSTRAINT chk_notes_version_positive
  CHECK (version >= 1);

-- 5.3. TAGS
ALTER TABLE public.tags
  DROP CONSTRAINT IF EXISTS chk_tags_name_not_empty,
  DROP CONSTRAINT IF EXISTS chk_tags_normalized_name_valid;

ALTER TABLE public.tags
  ADD CONSTRAINT chk_tags_name_not_empty
  CHECK (length(trim(name)) > 0);

ALTER TABLE public.tags
  ADD CONSTRAINT chk_tags_normalized_name_valid
  CHECK (
    length(trim(normalized_name)) > 0 AND
    normalized_name = lower(trim(normalized_name))
  );

-- 5.4. NOTE_LINKS
ALTER TABLE public.note_links
  DROP CONSTRAINT IF EXISTS chk_no_self_link;

ALTER TABLE public.note_links
  ADD CONSTRAINT chk_no_self_link
  CHECK (source_note_id <> target_note_id);

-- 5.5. ATTACHMENTS
ALTER TABLE public.attachments
  DROP CONSTRAINT IF EXISTS chk_attachments_file_size,
  DROP CONSTRAINT IF EXISTS chk_attachments_file_name_not_empty,
  DROP CONSTRAINT IF EXISTS chk_attachments_mime_type_not_empty,
  DROP CONSTRAINT IF EXISTS chk_attachments_storage_path_matches_user;

ALTER TABLE public.attachments
  ADD CONSTRAINT chk_attachments_file_size
  CHECK (file_size >= 0 AND file_size <= 52428800); -- Máximo 50MB

ALTER TABLE public.attachments
  ADD CONSTRAINT chk_attachments_file_name_not_empty
  CHECK (length(trim(file_name)) > 0);

ALTER TABLE public.attachments
  ADD CONSTRAINT chk_attachments_mime_type_not_empty
  CHECK (length(trim(mime_type)) > 0);

-- Garante que o caminho no storage pertence obrigatoriamente à pasta do próprio usuário
ALTER TABLE public.attachments
  ADD CONSTRAINT chk_attachments_storage_path_matches_user
  CHECK (storage_path LIKE (user_id::text || '/%'));

-- ----------------------------------------------------------------------------
-- 6. TRIGGERS DE ATUALIZAÇÃO AUTOMÁTICA DE updated_at
-- ----------------------------------------------------------------------------

-- Keep the function definition authoritative. The trigger is created only when absent
-- to avoid unnecessary ACCESS EXCLUSIVE lock acquisition during deployment.
DO $
BEGIN
IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_profiles_updated_at'
      AND tgrelid = 'public.profiles'::regclass
      AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER trg_profiles_updated_at
      BEFORE UPDATE ON public.profiles
      FOR EACH ROW
      EXECUTE FUNCTION public.trigger_set_updated_at();
  END IF;
END;
$;

DROP TRIGGER IF EXISTS trg_nodes_updated_at ON public.nodes;
CREATE TRIGGER trg_nodes_updated_at
  BEFORE UPDATE ON public.nodes
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_set_updated_at();

DROP TRIGGER IF EXISTS trg_notes_updated_at ON public.notes;
CREATE TRIGGER trg_notes_updated_at
  BEFORE UPDATE ON public.notes
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_set_updated_at();

DROP TRIGGER IF EXISTS trg_attachments_updated_at ON public.attachments;
CREATE TRIGGER trg_attachments_updated_at
  BEFORE UPDATE ON public.attachments
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_set_updated_at();

-- ----------------------------------------------------------------------------
-- 7. TRIGGER DE NORMALIZAÇÃO AUTOMÁTICA DE TAGS
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trigger_normalize_tag()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  NEW.name := trim(NEW.name);
  IF length(NEW.name) = 0 THEN
    RAISE EXCEPTION 'O nome da tag não pode ser vazio';
  END IF;
  NEW.normalized_name := lower(NEW.name);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_normalize_tag_before_save ON public.tags;
CREATE TRIGGER trg_normalize_tag_before_save
  BEFORE INSERT OR UPDATE ON public.tags
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_normalize_tag();

-- ----------------------------------------------------------------------------
-- 8. AUDITORIA E BLINDAGEM DE FUNÇÕES (SECURITY DEFINER / LEAST PRIVILEGE)
-- ----------------------------------------------------------------------------

-- 8.1. handle_new_user()
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_username TEXT;
  v_base_username TEXT;
  v_candidate TEXT;
  v_suffix INTEGER := 1;
BEGIN
  v_base_username := pg_catalog.coalesce(
    nullif(trim((NEW.raw_user_meta_data->>'username')), ''),
    nullif(trim((NEW.raw_user_meta_data->>'user_name')), ''),
    nullif(trim(split_part(NEW.email, '@', 1)), ''),
    'user'
  );

  v_base_username := lower(
    regexp_replace(v_base_username, '[^a-zA-Z0-9_]', '', 'g')
  );

  IF length(v_base_username) < 3 THEN
    v_base_username := 'user_' || pg_catalog.substring(NEW.id::text, 1, 6);
  END IF;

  v_candidate := v_base_username;

  WHILE pg_catalog.exists(
    SELECT 1 FROM public.profiles WHERE pg_catalog.lower(username) = v_candidate
  ) LOOP
    v_candidate := v_base_username || v_suffix::text;
    v_suffix := v_suffix + 1;
  END LOOP;

  v_username := v_candidate;

  INSERT INTO public.profiles (id, username, email, full_name, avatar_url, created_at, updated_at)
  VALUES (
    NEW.id,
    v_username,
    NEW.email,
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'avatar_url',
    pg_catalog.clock_timestamp(),
    pg_catalog.clock_timestamp()
  )
  ON CONFLICT (id) DO UPDATE
  SET
    email = EXCLUDED.email,
    username = pg_catalog.coalesce(public.profiles.username, EXCLUDED.username),
    updated_at = pg_catalog.clock_timestamp();

  RETURN NEW;
END;
$$;

-- 8.2. is_username_available()
CREATE OR REPLACE FUNCTION public.is_username_available(p_username TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_clean TEXT;
BEGIN
  IF p_username IS NULL THEN
    RETURN FALSE;
  END IF;

  v_clean := lower(trim(p_username));

  IF length(v_clean) < 3 OR length(v_clean) > 30 THEN
    RETURN FALSE;
  END IF;

  IF NOT (v_clean ~ '^[a-zA-Z0-9_]+$') THEN
    RETURN FALSE;
  END IF;

  RETURN NOT pg_catalog.exists(
    SELECT 1 FROM public.profiles WHERE pg_catalog.lower(username) = v_clean
  );
END;
$$;

-- 8.3. get_email_by_username()
CREATE OR REPLACE FUNCTION public.get_email_by_username(p_username TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_clean TEXT;
  v_email TEXT;
BEGIN
  IF p_username IS NULL THEN
    RETURN NULL;
  END IF;

  v_clean := lower(trim(p_username));

  SELECT email INTO v_email
  FROM public.profiles
  WHERE pg_catalog.lower(username) = v_clean
  LIMIT 1;

  RETURN v_email;
END;
$$;

-- 8.4. create_note_atomic()
CREATE OR REPLACE FUNCTION public.create_note_atomic(
  p_name TEXT,
  p_parent_id UUID,
  p_markdown_content TEXT DEFAULT '',
  p_editor_content JSONB DEFAULT NULL,
  p_node_id UUID DEFAULT NULL,
  p_note_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID;
  v_node_id UUID;
  v_note_id UUID;
  v_position NUMERIC;
  v_clean_name TEXT;
  v_node_row public.nodes%ROWTYPE;
  v_note_row public.notes%ROWTYPE;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Validação de pasta pai (se informada)
  IF p_parent_id IS NOT NULL THEN
    IF NOT pg_catalog.exists(
      SELECT 1 FROM public.nodes
      WHERE id = p_parent_id
        AND user_id = v_user_id
        AND type = 'folder'
        AND deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'Pasta pai inválida ou inacessível para este usuário';
    END IF;
  END IF;

  v_clean_name := trim(coalesce(p_name, ''));
  IF length(v_clean_name) = 0 THEN
    v_clean_name := 'Sem título';
  END IF;

  -- Idempotência: se p_node_id foi fornecido e já existe para este usuário, retorna o existente
  IF p_node_id IS NOT NULL THEN
    SELECT * INTO v_node_row
    FROM public.nodes
    WHERE id = p_node_id AND user_id = v_user_id;

    IF FOUND THEN
      SELECT * INTO v_note_row
      FROM public.notes
      WHERE node_id = v_node_id AND user_id = v_user_id;

      RETURN pg_catalog.jsonb_build_object(
        'node', pg_catalog.row_to_json(v_node_row)::jsonb,
        'note', pg_catalog.row_to_json(v_note_row)::jsonb,
        'status', 'already_exists'
      );
    END IF;
  END IF;

  v_node_id := pg_catalog.coalesce(p_node_id, extensions.gen_random_uuid());
  v_note_id := pg_catalog.coalesce(p_note_id, extensions.gen_random_uuid());

  -- Calcula próxima posição relativa
  SELECT pg_catalog.coalesce(pg_catalog.max(position), 0) + 1000
  INTO v_position
  FROM public.nodes
  WHERE user_id = v_user_id
    AND ((p_parent_id IS NULL AND parent_id IS NULL) OR (parent_id = p_parent_id));

  -- Inserção atômica do nó
  INSERT INTO public.nodes (
    id,
    user_id,
    parent_id,
    type,
    name,
    position,
    created_at,
    updated_at
  ) VALUES (
    v_node_id,
    v_user_id,
    p_parent_id,
    'note',
    v_clean_name,
    v_position,
    pg_catalog.clock_timestamp(),
    pg_catalog.clock_timestamp()
  )
  RETURNING * INTO v_node_row;

  -- Inserção atômica da nota associada
  INSERT INTO public.notes (
    id,
    node_id,
    user_id,
    markdown_content,
    editor_content,
    is_favorite,
    version,
    created_at,
    updated_at
  ) VALUES (
    v_note_id,
    v_node_id,
    v_user_id,
    pg_catalog.coalesce(p_markdown_content, ''),
    p_editor_content,
    FALSE,
    1,
    pg_catalog.clock_timestamp(),
    pg_catalog.clock_timestamp()
  )
  RETURNING * INTO v_note_row;

  RETURN pg_catalog.jsonb_build_object(
    'node', pg_catalog.row_to_json(v_node_row)::jsonb,
    'note', pg_catalog.row_to_json(v_note_row)::jsonb,
    'status', 'created'
  );
END;
$$;

-- 8.5. move_node_atomic()
CREATE OR REPLACE FUNCTION public.move_node_atomic(
  p_node_id UUID,
  p_new_parent_id UUID,
  p_new_position NUMERIC
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID;
  v_cur_parent UUID;
  v_check_id UUID;
  v_depth INTEGER := 0;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_node_id IS NULL THEN
    RAISE EXCEPTION 'ID do nó é obrigatório';
  END IF;

  IF p_new_position < 0 THEN
    RAISE EXCEPTION 'A posição não pode ser negativa';
  END IF;

  -- Verifica se o nó existe e pertence ao usuário autenticado
  SELECT parent_id INTO v_cur_parent
  FROM public.nodes
  WHERE id = p_node_id AND user_id = v_user_id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Nó não encontrado ou acesso não permitido';
  END IF;

  -- Prevenção de auto-aninhamento
  IF p_node_id = p_new_parent_id THEN
    RAISE EXCEPTION 'Não é permitido mover um nó para dentro de si mesmo';
  END IF;

  -- Se novo pai foi informado, valida existência, posse e tipo 'folder'
  IF p_new_parent_id IS NOT NULL THEN
    IF NOT pg_catalog.exists(
      SELECT 1 FROM public.nodes
      WHERE id = p_new_parent_id
        AND user_id = v_user_id
        AND type = 'folder'
        AND deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'Pasta de destino inválida ou inacessível';
    END IF;

    -- Prevenção de ciclos na árvore: o novo pai não pode ser descendente do nó sendo movido
    v_check_id := p_new_parent_id;
    WHILE v_check_id IS NOT NULL LOOP
      IF v_check_id = p_node_id THEN
        RAISE EXCEPTION 'Não é permitido mover uma pasta para dentro de sua própria descendência (ciclo detectado)';
      END IF;

      v_depth := v_depth + 1;
      IF v_depth > 100 THEN
        RAISE EXCEPTION 'Profundidade máxima da árvore excedida';
      END IF;

      SELECT parent_id INTO v_check_id
      FROM public.nodes
      WHERE id = v_check_id AND user_id = v_user_id;
    END LOOP;
  END IF;

  -- Executa movimentação
  UPDATE public.nodes
  SET
    parent_id = p_new_parent_id,
    position = p_new_position,
    updated_at = pg_catalog.clock_timestamp()
  WHERE id = p_node_id AND user_id = v_user_id;

  RETURN TRUE;
END;
$$;

-- 8.6. save_note_versioned()
-- POLÍTICA DE VERSIONAMENTO AUTORITATIVO DO BANCO:
-- 1. O banco é a autoridade da sequência da versão.
-- 2. Lock pessimista FOR UPDATE garante serialização estrita em gravações simultâneas.
-- 3. Reenvios de payload idêntico são aceitos como idempotentes (sem bump de versão inútil).
-- 4. Gravações baseadas em versões ou timestamps desatualizados são rejeitadas como 'rejected_stale'
--    e retornam o registro atual do servidor para reconciliação local.
-- 5. Gravações aceitas incrementam a versão monotonicamente (existing.version + 1).
CREATE OR REPLACE FUNCTION public.save_note_versioned(
  p_id UUID,
  p_node_id UUID,
  p_markdown_content TEXT,
  p_editor_content JSONB,
  p_is_favorite BOOLEAN,
  p_last_opened_at TIMESTAMPTZ,
  p_version INTEGER,
  p_updated_at TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID;
  v_existing public.notes%ROWTYPE;
  v_new_version INTEGER;
  v_new_updated_at TIMESTAMPTZ;
  v_node_exists BOOLEAN;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_id IS NULL OR p_node_id IS NULL THEN
    RAISE EXCEPTION 'IDs de nota e nó são obrigatórios';
  END IF;

  -- 1. Valida existência do TreeNode correspondente e pertencimento ao mesmo usuário
  SELECT pg_catalog.exists(
    SELECT 1 FROM public.nodes
    WHERE id = p_node_id AND user_id = v_user_id
  ) INTO v_node_exists;

  IF NOT v_node_exists THEN
    RAISE EXCEPTION 'O nó pai da nota não existe ou pertence a outro usuário';
  END IF;

  -- 2. Bloqueio pessimista por ID ou node_id com escopo de isolamento multiusuário
  SELECT * INTO v_existing
  FROM public.notes
  WHERE (id = p_id OR node_id = p_node_id)
    AND user_id = v_user_id
  FOR UPDATE;

  -- 3. CENÁRIO: NOTA JÁ EXISTENTE
  IF FOUND THEN
    -- 3.1. IDEMPOTÊNCIA: Reenvio de payload com o mesmo conteúdo/estado
    IF (v_existing.markdown_content = pg_catalog.coalesce(p_markdown_content, ''))
       AND (v_existing.editor_content IS NOT DISTINCT FROM p_editor_content)
       AND (v_existing.is_favorite IS NOT DISTINCT FROM pg_catalog.coalesce(p_is_favorite, v_existing.is_favorite))
    THEN
      RETURN pg_catalog.jsonb_build_object(
        'status', 'updated',
        'note', pg_catalog.row_to_json(v_existing)::jsonb,
        'message', 'Idempotent write acknowledged'
      );
    END IF;

    -- 3.2. DETECÇÃO DE STALE / CONFLITO DE CONCORRÊNCIA
    -- Se a versão do banco já for estritamente maior que a versão base da requisição:
    IF (v_existing.version > pg_catalog.coalesce(p_version, 1)) THEN
      RETURN pg_catalog.jsonb_build_object(
        'status', 'rejected_stale',
        'note', pg_catalog.row_to_json(v_existing)::jsonb,
        'reason', 'A versão no servidor é mais recente que a versão enviada'
      );
    END IF;

    -- Se as versões forem iguais, mas o timestamp do servidor for estritamente mais novo que o do cliente:
    IF (v_existing.version = pg_catalog.coalesce(p_version, 1))
       AND (p_updated_at IS NOT NULL)
       AND (v_existing.updated_at > p_updated_at)
    THEN
      RETURN pg_catalog.jsonb_build_object(
        'status', 'rejected_stale',
        'note', pg_catalog.row_to_json(v_existing)::jsonb,
        'reason', 'O timestamp do servidor é estritamente mais recente'
      );
    END IF;

    -- 3.3. ATUALIZAÇÃO ACEITA: O banco determina a próxima versão sequencial
    v_new_version := v_existing.version + 1;
    v_new_updated_at := pg_catalog.greatest(
      pg_catalog.clock_timestamp(),
      pg_catalog.coalesce(p_updated_at, pg_catalog.clock_timestamp())
    );

    UPDATE public.notes
    SET
      markdown_content = pg_catalog.coalesce(p_markdown_content, ''),
      editor_content = p_editor_content,
      is_favorite = pg_catalog.coalesce(p_is_favorite, v_existing.is_favorite),
      last_opened_at = pg_catalog.coalesce(p_last_opened_at, v_existing.last_opened_at),
      version = v_new_version,
      updated_at = v_new_updated_at
    WHERE id = v_existing.id AND user_id = v_user_id
    RETURNING * INTO v_existing;

    RETURN pg_catalog.jsonb_build_object(
      'status', 'updated',
      'note', pg_catalog.row_to_json(v_existing)::jsonb
    );

  -- 4. CENÁRIO: PRIMEIRA INSERÇÃO DA NOTA
  ELSE
    v_new_updated_at := pg_catalog.clock_timestamp();

    INSERT INTO public.notes (
      id,
      node_id,
      user_id,
      markdown_content,
      editor_content,
      is_favorite,
      last_opened_at,
      version,
      created_at,
      updated_at
    ) VALUES (
      p_id,
      p_node_id,
      v_user_id,
      pg_catalog.coalesce(p_markdown_content, ''),
      p_editor_content,
      pg_catalog.coalesce(p_is_favorite, FALSE),
      p_last_opened_at,
      1,
      v_new_updated_at,
      v_new_updated_at
    )
    RETURNING * INTO v_existing;

    RETURN pg_catalog.jsonb_build_object(
      'status', 'inserted',
      'note', pg_catalog.row_to_json(v_existing)::jsonb
    );
  END IF;
END;
$$;

-- ----------------------------------------------------------------------------
-- 9. PERMISSÕES E LEAST PRIVILEGE
-- ----------------------------------------------------------------------------

-- 9.1. Revoga privilégios excessivos do papel 'anon' nas tabelas de dados
REVOKE ALL ON TABLE public.profiles FROM anon;
REVOKE ALL ON TABLE public.nodes FROM anon;
REVOKE ALL ON TABLE public.notes FROM anon;
REVOKE ALL ON TABLE public.tags FROM anon;
REVOKE ALL ON TABLE public.note_tags FROM anon;
REVOKE ALL ON TABLE public.note_links FROM anon;
REVOKE ALL ON TABLE public.attachments FROM anon;

-- 9.2. Garante privilégios controlados para 'authenticated'
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.nodes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.notes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.tags TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.note_tags TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.note_links TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.attachments TO authenticated;

-- 9.3. Funções: Revoga de PUBLIC/anon e concede apenas onde estritamente necessário
REVOKE ALL ON FUNCTION public.create_note_atomic FROM PUBLIC;
REVOKE ALL ON FUNCTION public.move_node_atomic FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_note_versioned FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_username_available(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_email_by_username(TEXT) FROM PUBLIC;

-- RPCs de dados: apenas authenticated e service_role
GRANT EXECUTE ON FUNCTION public.create_note_atomic TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.move_node_atomic TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_note_versioned TO authenticated, service_role;

-- Utilitários de login: anon precisa consultar disponibilidade e email para login por username
GRANT EXECUTE ON FUNCTION public.is_username_available(TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_email_by_username(TEXT) TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 10. ROW LEVEL SECURITY (RLS) - POLÍTICAS GRANULARES E ESTBITAS
-- ----------------------------------------------------------------------------

-- Assegura ativação do RLS em todas as tabelas
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.note_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.note_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attachments ENABLE ROW LEVEL SECURITY;

-- 10.1. PROFILES
DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
DROP POLICY IF EXISTS "profiles_delete_own" ON public.profiles;

CREATE POLICY "profiles_select_own" ON public.profiles
  FOR SELECT TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "profiles_insert_own" ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = id);

CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE POLICY "profiles_delete_own" ON public.profiles
  FOR DELETE TO authenticated
  USING (auth.uid() = id);

-- 10.2. NODES
DROP POLICY IF EXISTS "nodes_select_own" ON public.nodes;
DROP POLICY IF EXISTS "nodes_insert_own" ON public.nodes;
DROP POLICY IF EXISTS "nodes_update_own" ON public.nodes;
DROP POLICY IF EXISTS "nodes_delete_own" ON public.nodes;

CREATE POLICY "nodes_select_own" ON public.nodes
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "nodes_insert_own" ON public.nodes
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "nodes_update_own" ON public.nodes
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "nodes_delete_own" ON public.nodes
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- 10.3. NOTES
DROP POLICY IF EXISTS "notes_select_own" ON public.notes;
DROP POLICY IF EXISTS "notes_insert_own" ON public.notes;
DROP POLICY IF EXISTS "notes_update_own" ON public.notes;
DROP POLICY IF EXISTS "notes_delete_own" ON public.notes;

CREATE POLICY "notes_select_own" ON public.notes
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "notes_insert_own" ON public.notes
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "notes_update_own" ON public.notes
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "notes_delete_own" ON public.notes
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- 10.4. TAGS
DROP POLICY IF EXISTS "tags_select_own" ON public.tags;
DROP POLICY IF EXISTS "tags_insert_own" ON public.tags;
DROP POLICY IF EXISTS "tags_update_own" ON public.tags;
DROP POLICY IF EXISTS "tags_delete_own" ON public.tags;

CREATE POLICY "tags_select_own" ON public.tags
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "tags_insert_own" ON public.tags
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "tags_update_own" ON public.tags
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "tags_delete_own" ON public.tags
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- 10.5. NOTE_TAGS
DROP POLICY IF EXISTS "note_tags_all_own" ON public.note_tags;
DROP POLICY IF EXISTS "note_tags_select_own" ON public.note_tags;
DROP POLICY IF EXISTS "note_tags_insert_own" ON public.note_tags;
DROP POLICY IF EXISTS "note_tags_update_own" ON public.note_tags;
DROP POLICY IF EXISTS "note_tags_delete_own" ON public.note_tags;

CREATE POLICY "note_tags_select_own" ON public.note_tags
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "note_tags_insert_own" ON public.note_tags
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "note_tags_update_own" ON public.note_tags
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "note_tags_delete_own" ON public.note_tags
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- 10.6. NOTE_LINKS
DROP POLICY IF EXISTS "note_links_all_own" ON public.note_links;
DROP POLICY IF EXISTS "note_links_select_own" ON public.note_links;
DROP POLICY IF EXISTS "note_links_insert_own" ON public.note_links;
DROP POLICY IF EXISTS "note_links_update_own" ON public.note_links;
DROP POLICY IF EXISTS "note_links_delete_own" ON public.note_links;

CREATE POLICY "note_links_select_own" ON public.note_links
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "note_links_insert_own" ON public.note_links
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "note_links_update_own" ON public.note_links
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "note_links_delete_own" ON public.note_links
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- 10.7. ATTACHMENTS
DROP POLICY IF EXISTS "attachments_select_own" ON public.attachments;
DROP POLICY IF EXISTS "attachments_insert_own" ON public.attachments;
DROP POLICY IF EXISTS "attachments_update_own" ON public.attachments;
DROP POLICY IF EXISTS "attachments_delete_own" ON public.attachments;

CREATE POLICY "attachments_select_own" ON public.attachments
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "attachments_insert_own" ON public.attachments
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "attachments_update_own" ON public.attachments
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "attachments_delete_own" ON public.attachments
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- 11. STORAGE BUCKET HARDENING E POLÍTICAS ESTBITAS
-- ----------------------------------------------------------------------------

-- Garante configuração segura do bucket de anexos
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'attachments',
  'attachments',
  FALSE,
  52428800,
  ARRAY[
    'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
    'application/pdf', 'text/plain',
    'video/mp4', 'video/webm',
    'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4'
  ]
)
ON CONFLICT (id) DO UPDATE
SET
  public = FALSE,
  file_size_limit = 52428800,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Políticas em storage.objects
DROP POLICY IF EXISTS "attachments_user_select" ON storage.objects;
DROP POLICY IF EXISTS "attachments_user_insert" ON storage.objects;
DROP POLICY IF EXISTS "attachments_user_update" ON storage.objects;
DROP POLICY IF EXISTS "attachments_user_delete" ON storage.objects;
DROP POLICY IF EXISTS "storage_attachments_select" ON storage.objects;
DROP POLICY IF EXISTS "storage_attachments_insert" ON storage.objects;
DROP POLICY IF EXISTS "storage_attachments_update" ON storage.objects;
DROP POLICY IF EXISTS "storage_attachments_delete" ON storage.objects;

CREATE POLICY "storage_attachments_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'attachments' AND
    (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "storage_attachments_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'attachments' AND
    (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "storage_attachments_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'attachments' AND
    (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'attachments' AND
    (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "storage_attachments_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'attachments' AND
    (storage.foldername(name))[1] = auth.uid()::text
  );

-- ----------------------------------------------------------------------------
-- 12. ÍNDICES DE ALTA PERFORMANCE
-- ----------------------------------------------------------------------------

-- NODES
CREATE INDEX IF NOT EXISTS idx_nodes_user_parent_pos
  ON public.nodes (user_id, parent_id, position);

CREATE INDEX IF NOT EXISTS idx_nodes_active_tree
  ON public.nodes (user_id, parent_id, position)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_nodes_user_updated
  ON public.nodes (user_id, updated_at DESC);

-- NOTES
CREATE INDEX IF NOT EXISTS idx_notes_user_favorite
  ON public.notes (user_id)
  WHERE is_favorite = TRUE;

CREATE INDEX IF NOT EXISTS idx_notes_user_last_opened
  ON public.notes (user_id, last_opened_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_notes_user_updated
  ON public.notes (user_id, updated_at DESC);

-- TAGS
CREATE INDEX IF NOT EXISTS idx_tags_user_normalized
  ON public.tags (user_id, normalized_name);

-- NOTE_TAGS
CREATE INDEX IF NOT EXISTS idx_note_tags_user_tag
  ON public.note_tags (user_id, tag_id);

CREATE INDEX IF NOT EXISTS idx_note_tags_user_note
  ON public.note_tags (user_id, note_id);

-- NOTE_LINKS
CREATE INDEX IF NOT EXISTS idx_note_links_user_source
  ON public.note_links (user_id, source_note_id);

CREATE INDEX IF NOT EXISTS idx_note_links_user_target
  ON public.note_links (user_id, target_note_id);

-- ATTACHMENTS
CREATE INDEX IF NOT EXISTS idx_attachments_user_note
  ON public.attachments (user_id, note_id);

CREATE INDEX IF NOT EXISTS idx_attachments_user_created
  ON public.attachments (user_id, created_at DESC);

-- ----------------------------------------------------------------------------
-- 13. REALTIME & REPLICA IDENTITY (Preservação total de integridade e CDC)
-- ----------------------------------------------------------------------------

ALTER TABLE public.nodes REPLICA IDENTITY FULL;
ALTER TABLE public.notes REPLICA IDENTITY FULL;
ALTER TABLE public.tags REPLICA IDENTITY FULL;
ALTER TABLE public.note_tags REPLICA IDENTITY FULL;
ALTER TABLE public.note_links REPLICA IDENTITY FULL;
ALTER TABLE public.attachments REPLICA IDENTITY FULL;

-- Garante que todas as tabelas continuam na publicação de Realtime
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END;
$$;

DO $
BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'nodes') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.nodes;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'notes') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notes;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'tags') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.tags;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'note_tags') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.note_tags;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'note_links') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.note_links;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'attachments') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.attachments;
  END IF;
END;
$;

COMMIT;
