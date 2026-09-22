# Hardening da Camada de Banco de Dados — Tá na nota

Este documento consolida as diretrizes, arquitetura e especificações de segurança implementadas na migração `20260922000001_database_hardening.sql` para o PostgreSQL / Supabase do projeto **Tá na nota**.

---

## 1. Princípios Fundamentais

1. **PostgreSQL como Autoridade de Integridade Remota**: Validações de domínio, tipagem, restrições e relacionamentos são fiscalizados pelo banco, não apenas pela interface ou lógica de cliente.
2. **IndexedDB como Fonte Offline-First**: O cliente opera plenamente offline; mutações são registradas localmente e enviadas pela `sync_queue` com garantia de entrega e LWW.
3. **Isolamento Multiusuário Estrutural**: Chaves estrangeiras compostas contendo `user_id` impedem fisicamente qualquer cruzamento de dados entre usuários no nível de integridade referencial.
4. **Least Privilege**: O papel `anon` não possui privilégios em tabelas de conteúdo; `authenticated` possui acesso restrito às suas próprias linhas via RLS.
5. **Funções SECURITY DEFINER Blindadas**: Execução estrita com `SET search_path = ''` e qualificadores totais (`pg_catalog.*`, `public.*`, `auth.uid()`).

---

## 2. Estrutura de Chaves Estrangeiras Compostas

Para impedir que dados de um usuário façam referência a recursos de outro usuário, foram estabelecidas restrições únicas compostas `(id, user_id)` e as seguintes Foreign Keys:

| Tabela Origem | Colunas FK | Tabela Destino | Colunas Alvo | Comportamento ON DELETE |
| :--- | :--- | :--- | :--- | :--- |
| `public.nodes` | `(parent_id, user_id)` | `public.nodes` | `(id, user_id)` | CASCADE |
| `public.notes` | `(node_id, user_id)` | `public.nodes` | `(id, user_id)` | CASCADE |
| `public.note_tags` | `(note_id, user_id)` | `public.notes` | `(id, user_id)` | CASCADE |
| `public.note_tags` | `(tag_id, user_id)` | `public.tags` | `(id, user_id)` | CASCADE |
| `public.note_links`| `(source_note_id, user_id)` | `public.notes` | `(id, user_id)` | CASCADE |
| `public.note_links`| `(target_note_id, user_id)` | `public.notes` | `(id, user_id)` | CASCADE |
| `public.attachments` | `(note_id, user_id)` | `public.notes` | `(id, user_id)` | CASCADE |

---

## 3. Constraints de Domínio (CHECK Constraints)

- **`nodes`**:
  - `chk_nodes_name_not_empty`: `length(trim(name)) > 0`
  - `chk_nodes_position_non_negative`: `position >= 0`
  - `chk_nodes_color_format`: `color IS NULL OR color ~* '^#[0-9a-f]{6}$'`
  - `chk_nodes_no_self_parent`: `parent_id IS NULL OR parent_id <> id`
- **`notes`**:
  - `chk_notes_version_positive`: `version >= 1`
- **`tags`**:
  - `chk_tags_name_not_empty`: `length(trim(name)) > 0`
  - `chk_tags_normalized_name_valid`: `length(trim(normalized_name)) > 0 AND normalized_name = lower(trim(normalized_name))`
- **`note_links`**:
  - `chk_no_self_link`: `source_note_id <> target_note_id`
- **`attachments`**:
  - `chk_attachments_file_size`: `file_size >= 0 AND file_size <= 52428800` (50MB)
  - `chk_attachments_file_name_not_empty`: `length(trim(file_name)) > 0`
  - `chk_attachments_mime_type_not_empty`: `length(trim(mime_type)) > 0`
  - `chk_attachments_storage_path_matches_user`: `storage_path LIKE (user_id::text || '/%')`

---

## 4. Política de Versionamento e RPCs

### 4.1. `save_note_versioned`
- **Locking**: Pessimista via `SELECT ... FOR UPDATE` no escopo `(id = p_id OR node_id = p_node_id) AND user_id = auth.uid()`.
- **Idempotência**: Se o payload recebido (conteúdo markdown, editor JSON e favorito) for idêntico ao estado atual do banco, retorna `status: 'updated'` sem gerar incremento desnecessário de versão.
- **Detecção de Stale**: Se `v_existing.version > p_version` ou se `v_existing.version = p_version AND v_existing.updated_at > p_updated_at`, a gravação concorrente desatualizada é rejeitada com `status: 'rejected_stale'` e o registro atual do servidor é retornado para reconciliação no cliente.
- **Autoridade da Versão**: Quando aceita, o banco gera a versão sequencial `v_new_version := v_existing.version + 1` e timestamp autoritativo via `clock_timestamp()`.

### 4.2. `create_note_atomic`
- Cria o nó e a nota dentro da mesma transação com isolamento multiusuário.
- Valida que `p_parent_id` (se informado) pertence ao mesmo usuário e é do tipo `'folder'`.
- Suporte a idempotência via `p_node_id` e `p_note_id` opcionais.

### 4.3. `move_node_atomic`
- Valida posse de `p_node_id`.
- Impede auto-movimentação (`p_node_id = p_new_parent_id`).
- Impede movimentação para dentro de descendentes (detecção de ciclos em profundidade).
- Valida que a pasta de destino pertence ao usuário e tem `type = 'folder'`.

---

## 5. Storage Seguro

- O bucket `attachments` é privado (`public = false`).
- Políticas RLS no schema `storage.objects` validam `(storage.foldername(name))[1] = auth.uid()::text`.
- Constraint `chk_attachments_storage_path_matches_user` na tabela pública `attachments` impede o registro de caminhos de arquivos fora da pasta do próprio usuário.

---

## 6. Realtime e REPLICA IDENTITY

- Tabelas `nodes`, `notes`, `tags`, `note_tags`, `note_links` e `attachments` utilizam `REPLICA IDENTITY FULL`.
- Isto garante que eventos de `DELETE` no WAL do PostgreSQL transmitam a linha completa antiga (`old`), permitindo que a subscrição com filtro `user_id=eq.${userId}` processe deleções em tempo real sem descartar os registros.
