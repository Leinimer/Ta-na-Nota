-- Exclusão assistida de uma nota, com confirmação feita pela interface.
-- A pasta/nota é marcada como excluída (tombstone); o registro de conteúdo
-- é removido fisicamente. A função só permite excluir notas do próprio usuário.

BEGIN;

-- Recria as RPCs atuais com sintaxe PostgreSQL válida e mantém a segurança por auth.uid().

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
AS $
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
    IF NOT EXISTS(
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

  v_node_id := COALESCE(p_node_id, extensions.gen_random_uuid());
  v_note_id := COALESCE(p_note_id, extensions.gen_random_uuid());

  -- Calcula próxima posição relativa
  SELECT COALESCE(pg_catalog.max(position), 0) + 1000
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
    COALESCE(p_markdown_content, ''),
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
$;

REVOKE ALL ON FUNCTION public.create_note_atomic(TEXT, UUID, TEXT, JSONB, UUID, UUID) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.create_note_atomic(TEXT, UUID, TEXT, JSONB, UUID, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.move_node_atomic(
  p_node_id UUID,
  p_new_parent_id UUID,
  p_new_position NUMERIC
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $
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
    IF NOT EXISTS(
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
$;

REVOKE ALL ON FUNCTION public.move_node_atomic(UUID, UUID, NUMERIC) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.move_node_atomic(UUID, UUID, NUMERIC) TO authenticated;

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
AS $
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
  SELECT EXISTS(
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
    IF (v_existing.markdown_content = COALESCE(p_markdown_content, ''))
       AND (v_existing.editor_content IS NOT DISTINCT FROM p_editor_content)
       AND (v_existing.is_favorite IS NOT DISTINCT FROM COALESCE(p_is_favorite, v_existing.is_favorite))
    THEN
      RETURN pg_catalog.jsonb_build_object(
        'status', 'updated',
        'note', pg_catalog.row_to_json(v_existing)::jsonb,
        'message', 'Idempotent write acknowledged'
      );
    END IF;

    -- 3.2. DETECÇÃO DE STALE / CONFLITO DE CONCORRÊNCIA
    -- Se a versão do banco já for estritamente maior que a versão base da requisição:
    IF (v_existing.version > COALESCE(p_version, 1)) THEN
      RETURN pg_catalog.jsonb_build_object(
        'status', 'rejected_stale',
        'note', pg_catalog.row_to_json(v_existing)::jsonb,
        'reason', 'A versão no servidor é mais recente que a versão enviada'
      );
    END IF;

    -- Se as versões forem iguais, mas o timestamp do servidor for estritamente mais novo que o do cliente:
    IF (v_existing.version = COALESCE(p_version, 1))
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
    v_new_updated_at := GREATEST(
      pg_catalog.clock_timestamp(),
      COALESCE(p_updated_at, pg_catalog.clock_timestamp())
    );

    UPDATE public.notes
    SET
      markdown_content = COALESCE(p_markdown_content, ''),
      editor_content = p_editor_content,
      is_favorite = COALESCE(p_is_favorite, v_existing.is_favorite),
      last_opened_at = COALESCE(p_last_opened_at, v_existing.last_opened_at),
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
      COALESCE(p_markdown_content, ''),
      p_editor_content,
      COALESCE(p_is_favorite, FALSE),
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
$;

REVOKE ALL ON FUNCTION public.save_note_versioned(UUID, UUID, TEXT, JSONB, BOOLEAN, TIMESTAMPTZ, INTEGER, TIMESTAMPTZ) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.save_note_versioned(UUID, UUID, TEXT, JSONB, BOOLEAN, TIMESTAMPTZ, INTEGER, TIMESTAMPTZ) TO authenticated;

-- Renomeia nota e atualiza o conteúdo em uma única transação, com controle de versão.
CREATE OR REPLACE FUNCTION public.rename_note_atomic(
  p_node_id UUID,
  p_new_title TEXT,
  p_markdown_content TEXT,
  p_editor_content JSONB,
  p_version INTEGER,
  p_updated_at TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $
DECLARE
  v_user_id UUID;
  v_node public.nodes%ROWTYPE;
  v_note public.notes%ROWTYPE;
  v_saved JSONB;
  v_title TEXT;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_title := pg_catalog.btrim(pg_catalog.coalesce(p_new_title, ''));
  IF v_title = '' OR pg_catalog.length(v_title) > 160 THEN
    RAISE EXCEPTION 'Invalid note title';
  END IF;

  SELECT * INTO v_node
  FROM public.nodes
  WHERE id = p_node_id
    AND user_id = v_user_id
    AND type = 'note'
    AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Note not found or not accessible';
  END IF;

  SELECT * INTO v_note
  FROM public.notes
  WHERE node_id = p_node_id
    AND user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Note content not found';
  END IF;

  v_saved := public.save_note_versioned(
    v_note.id,
    p_node_id,
    p_markdown_content,
    p_editor_content,
    v_note.is_favorite,
    v_note.last_opened_at,
    p_version,
    p_updated_at
  );

  IF v_saved->>'status' = 'rejected_stale' THEN
    RETURN v_saved;
  END IF;

  UPDATE public.nodes
  SET name = v_title,
      updated_at = pg_catalog.clock_timestamp()
  WHERE id = p_node_id
    AND user_id = v_user_id;

  RETURN pg_catalog.jsonb_build_object(
    'status', 'updated',
    'node_id', p_node_id,
    'title', v_title,
    'note', v_saved->'note'
  );
END;
$;

REVOKE ALL ON FUNCTION public.rename_note_atomic(UUID, TEXT, TEXT, JSONB, INTEGER, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rename_note_atomic(UUID, TEXT, TEXT, JSONB, INTEGER, TIMESTAMPTZ) TO authenticated;

-- Contabilização diária simples para proteger o orçamento da API.
CREATE TABLE IF NOT EXISTS public.ai_assistant_usage (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  usage_date DATE NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
  PRIMARY KEY (user_id, usage_date)
);

ALTER TABLE public.ai_assistant_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ai_assistant_usage FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.consume_ai_assistant_request(
  p_daily_limit INTEGER DEFAULT 50
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $
DECLARE
  v_user_id UUID;
  v_limit INTEGER;
  v_count INTEGER;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_limit := LEAST(500, GREATEST(1, COALESCE(p_daily_limit, 50)));

  INSERT INTO public.ai_assistant_usage (
    user_id, usage_date, request_count, created_at, updated_at
  )
  VALUES (
    v_user_id,
    (pg_catalog.now() AT TIME ZONE 'UTC')::date,
    1,
    pg_catalog.now(),
    pg_catalog.now()
  )
  ON CONFLICT (user_id, usage_date)
  DO UPDATE SET
    request_count = public.ai_assistant_usage.request_count + 1,
    updated_at = pg_catalog.now()
  WHERE public.ai_assistant_usage.request_count < v_limit
  RETURNING request_count INTO v_count;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object(
      'allowed', FALSE,
      'daily_limit', v_limit,
      'remaining', 0
    );
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'allowed', TRUE,
    'daily_limit', v_limit,
    'remaining', GREATEST(0, v_limit - v_count)
  );
END;
$;

REVOKE ALL ON FUNCTION public.consume_ai_assistant_request(INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consume_ai_assistant_request(INTEGER) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_note_atomic(
  p_node_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID;
  v_node public.nodes%ROWTYPE;
  v_note_id UUID;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT *
  INTO v_node
  FROM public.nodes
  WHERE id = p_node_id
    AND user_id = v_user_id
    AND type = 'note'
    AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Note not found or not accessible';
  END IF;

  SELECT id
  INTO v_note_id
  FROM public.notes
  WHERE node_id = p_node_id
    AND user_id = v_user_id
  FOR UPDATE;

  UPDATE public.nodes
  SET deleted_at = pg_catalog.clock_timestamp(),
      updated_at = pg_catalog.clock_timestamp()
  WHERE id = p_node_id
    AND user_id = v_user_id;

  IF v_note_id IS NOT NULL THEN
    DELETE FROM public.notes
    WHERE id = v_note_id
      AND user_id = v_user_id;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'status', 'deleted',
    'node_id', p_node_id,
    'note_id', v_note_id,
    'title', v_node.name
  );
END;
$$;

REVOKE ALL ON FUNCTION public.delete_note_atomic(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_note_atomic(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.delete_note_atomic(UUID) TO authenticated;

COMMIT;
