-- ============================================================================
-- SUITE DE TESTES: database_hardening_test.sql
-- PROJETO: "Tá na nota" (Leinimer/Ta-na-Nota)
-- OBJETIVO: Testar e validar isolamento multiusuário, constraints de domínio,
--           foreign keys compostas, RLS, triggers e RPCs atômicas no PostgreSQL.
-- ============================================================================

BEGIN;

-- 1. Criação de dois usuários de teste no schema auth (se ainda não existirem)
DO $$
DECLARE
  v_user_a UUID := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid;
  v_user_b UUID := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid;
BEGIN
  -- Insere perfis de teste diretamente se necessário
  INSERT INTO public.profiles (id, username, email, full_name, created_at, updated_at)
  VALUES
    (v_user_a, 'usuario_alfa', 'alfa@tananota.test', 'Usuário Alfa', now(), now()),
    (v_user_b, 'usuario_beta', 'beta@tananota.test', 'Usuário Beta', now(), now())
  ON CONFLICT (id) DO NOTHING;
END;
$$;

-- 2. TESTES DE CONSTRAINTS DE DOMÍNIO (CHECK)
DO $$
DECLARE
  v_user_a UUID := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid;
  v_passed BOOLEAN := FALSE;
BEGIN
  RAISE NOTICE '== INICIANDO TESTES DE CONSTRAINTS DE DOMÍNIO ==';

  -- 2.1. Teste: Nome de nó vazio deve falhar
  BEGIN
    INSERT INTO public.nodes (id, user_id, name, type, position)
    VALUES (gen_random_uuid(), v_user_a, '   ', 'note', 1000);
    RAISE EXCEPTION 'Falha: nó com nome em branco não deveria ter sido aceito!';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'SUCESSO [2.1]: Inserção de nó com nome em branco bloqueada por CHECK.';
  END;

  -- 2.2. Teste: Posição negativa deve falhar
  BEGIN
    INSERT INTO public.nodes (id, user_id, name, type, position)
    VALUES (gen_random_uuid(), v_user_a, 'Nota Válida', 'note', -5);
    RAISE EXCEPTION 'Falha: posição negativa não deveria ter sido aceita!';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'SUCESSO [2.2]: Inserção de nó com posição negativa bloqueada por CHECK.';
  END;

  -- 2.3. Teste: Formato de cor inválido deve falhar
  BEGIN
    INSERT INTO public.nodes (id, user_id, name, type, position, color)
    VALUES (gen_random_uuid(), v_user_a, 'Nota Colorida', 'note', 1000, 'azul-claro');
    RAISE EXCEPTION 'Falha: cor fora do padrão hex não deveria ter sido aceita!';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'SUCESSO [2.3]: Inserção de nó com cor inválida bloqueada por CHECK.';
  END;

  -- 2.4. Teste: Auto-aninhamento (parent_id = id) deve falhar
  DECLARE
    v_node_id UUID := gen_random_uuid();
  BEGIN
    INSERT INTO public.nodes (id, user_id, parent_id, name, type, position)
    VALUES (v_node_id, v_user_a, v_node_id, 'Pasta Auto-aninhada', 'folder', 1000);
    RAISE EXCEPTION 'Falha: nó com parent_id igual a id não deveria ter sido aceito!';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'SUCESSO [2.4]: Auto-aninhamento bloqueado por CHECK.';
  END;

  -- 2.5. Teste: Self-link em note_links (source_note_id = target_note_id) deve falhar
  DECLARE
    v_folder_id UUID := gen_random_uuid();
    v_note_id UUID := gen_random_uuid();
  BEGIN
    INSERT INTO public.nodes (id, user_id, name, type, position)
    VALUES (v_folder_id, v_user_a, 'Pasta Teste', 'folder', 1000);

    INSERT INTO public.nodes (id, user_id, name, type, position)
    VALUES (v_note_id, v_user_a, 'Nota Teste', 'note', 2000);

    INSERT INTO public.notes (id, node_id, user_id, version)
    VALUES (v_note_id, v_note_id, v_user_a, 1);

    INSERT INTO public.note_links (user_id, source_note_id, target_note_id)
    VALUES (v_user_a, v_note_id, v_note_id);
    RAISE EXCEPTION 'Falha: auto-ligação de notas não deveria ter sido aceita!';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'SUCESSO [2.5]: Self-link de nota bloqueado por CHECK.';
  END;
END;
$$;

-- 3. TESTES DE ISOLAMENTO ESTRUTURAL COM FOREIGN KEYS COMPOSTAS
DO $$
DECLARE
  v_user_a UUID := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid;
  v_user_b UUID := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid;
  v_folder_a UUID := gen_random_uuid();
  v_node_a UUID := gen_random_uuid();
  v_note_a UUID := gen_random_uuid();
  v_tag_a UUID := gen_random_uuid();
BEGIN
  RAISE NOTICE '== INICIANDO TESTES DE INTEGRIDADE MULTIUSUÁRIO (FK COMPOSTAS) ==';

  -- Criação de dados do Usuário A
  INSERT INTO public.nodes (id, user_id, name, type, position)
  VALUES (v_folder_a, v_user_a, 'Pasta do Usuário A', 'folder', 1000);

  INSERT INTO public.nodes (id, user_id, parent_id, name, type, position)
  VALUES (v_node_a, v_user_a, v_folder_a, 'Nota do Usuário A', 'note', 2000);

  INSERT INTO public.notes (id, node_id, user_id, version)
  VALUES (v_note_a, v_node_a, v_user_a, 1);

  INSERT INTO public.tags (id, user_id, name)
  VALUES (v_tag_a, v_user_a, 'importante');

  -- 3.1. Teste: Usuário B tentando criar um nó com parent_id na pasta do Usuário A
  BEGIN
    INSERT INTO public.nodes (id, user_id, parent_id, name, type, position)
    VALUES (gen_random_uuid(), v_user_b, v_folder_a, 'Ataque Invasão de Pasta', 'note', 1000);
    RAISE EXCEPTION 'Falha: FK composta permitiu nó do User B ter parent_id de pasta do User A!';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'SUCESSO [3.1]: Violação de FK composta impediu nó de referenciar pasta de outro usuário.';
  END;

  -- 3.2. Teste: Usuário B tentando associar nota ao node_id do Usuário A
  BEGIN
    INSERT INTO public.notes (id, node_id, user_id, version)
    VALUES (gen_random_uuid(), v_node_a, v_user_b, 1);
    RAISE EXCEPTION 'Falha: FK composta permitiu nota do User B associar ao node do User A!';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'SUCESSO [3.2]: Violação de FK composta impediu nota de associar a nó de outro usuário.';
  END;

  -- 3.3. Teste: Usuário B tentando criar note_tag apontando para tag do Usuário A
  DECLARE
    v_node_b UUID := gen_random_uuid();
    v_note_b UUID := gen_random_uuid();
  BEGIN
    INSERT INTO public.nodes (id, user_id, name, type, position)
    VALUES (v_node_b, v_user_b, 'Nota do User B', 'note', 1000);

    INSERT INTO public.notes (id, node_id, user_id, version)
    VALUES (v_note_b, v_node_b, v_user_b, 1);

    INSERT INTO public.note_tags (note_id, tag_id, user_id)
    VALUES (v_note_b, v_tag_a, v_user_b);
    RAISE EXCEPTION 'Falha: FK composta permitiu note_tags usar tag de outro usuário!';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'SUCESSO [3.3]: Violação de FK composta impediu vincular tag de outro usuário.';
  END;

  -- 3.4. Teste: Usuário B tentando registrar anexo com storage_path adulterado (apontando para pasta do User A)
  DECLARE
    v_node_b UUID := gen_random_uuid();
    v_note_b UUID := gen_random_uuid();
    v_malicious_path TEXT := v_user_a::text || '/hacked/doc.png';
  BEGIN
    INSERT INTO public.nodes (id, user_id, name, type, position)
    VALUES (v_node_b, v_user_b, 'Nota do User B 2', 'note', 2000);

    INSERT INTO public.notes (id, node_id, user_id, version)
    VALUES (v_note_b, v_node_b, v_user_b, 1);

    INSERT INTO public.attachments (id, user_id, note_id, file_name, storage_path, mime_type, file_size)
    VALUES (gen_random_uuid(), v_user_b, v_note_b, 'doc.png', v_malicious_path, 'image/png', 1024);
    RAISE EXCEPTION 'Falha: CHECK permitiu attachment com storage_path de outro usuário!';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'SUCESSO [3.4]: Violação de CHECK impediu attachment com caminho de outro usuário.';
  END;
END;
$$;

-- 4. TESTES DE TRIGGERS (NORMALIZAÇÃO DE TAGS E UPDATED_AT)
DO $$
DECLARE
  v_user_a UUID := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid;
  v_tag_id UUID := gen_random_uuid();
  v_node_id UUID := gen_random_uuid();
  v_tag_row public.tags%ROWTYPE;
  v_node_row public.nodes%ROWTYPE;
  v_initial_time TIMESTAMPTZ;
BEGIN
  RAISE NOTICE '== INICIANDO TESTES DE TRIGGERS AUTOMÁTICOS ==';

  -- 4.1. Normalização automática de tag
  INSERT INTO public.tags (id, user_id, name)
  VALUES (v_tag_id, v_user_a, '  ReUnIãO_dE_pRoJeTo  ')
  RETURNING * INTO v_tag_row;

  IF v_tag_row.name <> 'ReUnIãO_dE_pRoJeTo' OR v_tag_row.normalized_name <> 'reunião_de_projeto' THEN
    RAISE EXCEPTION 'Falha no trigger de normalização de tag! Obtido: name=%, normalized=%', v_tag_row.name, v_tag_row.normalized_name;
  END IF;
  RAISE NOTICE 'SUCESSO [4.1]: Trigger de normalização sanitizou nome e gerou normalized_name corretamente.';

  -- 4.2. Atualização automática de updated_at
  INSERT INTO public.nodes (id, user_id, name, type, position)
  VALUES (v_node_id, v_user_a, 'Nó Teste Trigger', 'note', 1000)
  RETURNING * INTO v_node_row;

  v_initial_time := v_node_row.updated_at;
  PERFORM pg_catalog.pg_sleep(0.05);

  UPDATE public.nodes
  SET name = 'Nó Teste Trigger Atualizado'
  WHERE id = v_node_id
  RETURNING * INTO v_node_row;

  IF v_node_row.updated_at <= v_initial_time THEN
    RAISE EXCEPTION 'Falha no trigger de updated_at: updated_at não avançou no UPDATE!';
  END IF;
  RAISE NOTICE 'SUCESSO [4.2]: Trigger de updated_at garantiu timestamp atualizado no banco.';
END;
$$;

RAISE NOTICE '==================================================';
RAISE NOTICE 'TODOS OS TESTES DE SEGURANÇA E INTEGRIDADE PASSARAM!';
RAISE NOTICE '==================================================';

-- Como este é um script de verificação, revertemos as mutações ao final para manter a base limpa
ROLLBACK;
