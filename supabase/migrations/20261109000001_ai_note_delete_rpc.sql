-- Exclusão assistida de uma nota, com confirmação feita pela interface.
-- A pasta/nota é marcada como excluída (tombstone); o registro de conteúdo
-- é removido fisicamente. A função só permite excluir notas do próprio usuário.

BEGIN;

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
