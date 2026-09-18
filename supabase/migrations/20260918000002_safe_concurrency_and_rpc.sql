-- ====================================================================
-- MIGRATION: 20260918000002_safe_concurrency_and_rpc.sql
-- Description: Concurrency control RPC function for notes (Last Write Wins)
-- Prevents lost updates, stale overwrites, and packet reordering race conditions.
-- ====================================================================

-- 1. Cria ou atualiza a função RPC save_note_versioned
CREATE OR REPLACE FUNCTION public.save_note_versioned(
  p_id UUID,
  p_node_id UUID,
  p_markdown_content TEXT,
  p_editor_content JSONB,
  p_is_favorite BOOLEAN,
  p_last_opened_at TIMESTAMPTZ,
  p_version INT,
  p_updated_at TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_id UUID;
  v_existing RECORD;
BEGIN
  -- Validar autenticação do chamador
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Bloqueio pessimista (FOR UPDATE) na linha existente para serializar gravações concorrentes
  SELECT * INTO v_existing
  FROM public.notes
  WHERE (id = p_id OR node_id = p_node_id) AND user_id = v_user_id
  FOR UPDATE;

  IF FOUND THEN
    -- Regra Last-Write-Wins (LWW):
    -- Se a versão já existente no banco for estritamente maior,
    -- OU se as versões forem iguais mas o updated_at existente for mais recente,
    -- REJEITA a gravação desatualizada e retorna a nota atual do servidor.
    IF (v_existing.version > p_version) OR 
       (v_existing.version = p_version AND v_existing.updated_at > p_updated_at) THEN
      RETURN jsonb_build_object(
        'status', 'rejected_stale',
        'note', row_to_json(v_existing)::jsonb
      );
    END IF;

    -- Versão aceita: atualiza o registro com a versão e conteúdo mais novos
    UPDATE public.notes
    SET
      markdown_content = p_markdown_content,
      editor_content = p_editor_content,
      is_favorite = COALESCE(p_is_favorite, is_favorite),
      last_opened_at = COALESCE(p_last_opened_at, last_opened_at),
      version = p_version,
      updated_at = p_updated_at
    WHERE id = v_existing.id AND user_id = v_user_id
    RETURNING * INTO v_existing;

    RETURN jsonb_build_object(
      'status', 'updated',
      'note', row_to_json(v_existing)::jsonb
    );
  ELSE
    -- Nova nota: insere registro inicial
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
      p_markdown_content,
      p_editor_content,
      COALESCE(p_is_favorite, false),
      p_last_opened_at,
      GREATEST(p_version, 1),
      COALESCE(p_updated_at, now()),
      COALESCE(p_updated_at, now())
    )
    RETURNING * INTO v_existing;

    RETURN jsonb_build_object(
      'status', 'inserted',
      'note', row_to_json(v_existing)::jsonb
    );
  END IF;
END;
$$;

-- 2. Concede permissão de execução a usuários autenticados
GRANT EXECUTE ON FUNCTION public.save_note_versioned TO authenticated;
