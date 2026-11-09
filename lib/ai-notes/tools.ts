import type { SupabaseClient } from "@supabase/supabase-js";
import { MarkdownService } from "@/services/markdownService";

type JsonSchema = Record<string, unknown>;

function functionTool(
  name: string,
  description: string,
  properties: Record<string, JsonSchema>,
): Record<string, unknown> {
  return {
    type: "function",
    name,
    description,
    strict: true,
    parameters: {
      type: "object",
      properties,
      required: Object.keys(properties),
      additionalProperties: false,
    },
  };
}

const stringProperty = (description: string): JsonSchema => ({
  type: "string",
  description,
});

const nullableStringProperty = (description: string): JsonSchema => ({
  type: ["string", "null"],
  description,
});

export const assistantTools: Record<string, unknown>[] = [
  functionTool(
    "list_folders",
    "Lista as pastas ativas do usuário. Use para identificar a pasta de destino antes de criar ou mover notas.",
    {},
  ),
  functionTool(
    "list_recent_notes",
    "Lista as notas mais recentemente criadas. Use para responder perguntas como 'qual foi a última nota criada?'.",
    {
      limit: {
        type: "integer",
        description: "Quantidade de notas, entre 1 e 20.",
        minimum: 1,
        maximum: 20,
      },
    },
  ),
  functionTool(
    "search_notes",
    "Pesquisa notas do usuário pelo título ou pelo conteúdo Markdown.",
    {
      query: stringProperty("Termo ou expressão que deve ser procurado."),
    },
  ),
  functionTool(
    "read_note",
    "Lê o conteúdo de uma nota específica. Use o node_id retornado pela busca ou pela listagem.",
    {
      node_id: stringProperty("ID do nó da nota."),
    },
  ),
  functionTool(
    "create_folder",
    "Cria uma pasta. Para uma pasta dentro de outra, informe o parent_id obtido em list_folders. Use null para criar na raiz.",
    {
      name: stringProperty("Nome da nova pasta."),
      parent_id: nullableStringProperty("ID da pasta pai ou null para a raiz."),
    },
  ),
  functionTool(
    "create_note",
    "Cria uma nota dentro de uma pasta. O conteúdo deve ser Markdown e começar com um título H1. Use list_folders antes quando o usuário indicar o nome de uma pasta.",
    {
      title: stringProperty("Título da nota."),
      markdown_content: stringProperty("Conteúdo completo da nota em Markdown."),
      parent_id: nullableStringProperty("ID da pasta de destino ou null para a raiz."),
    },
  ),
  functionTool(
    "append_to_note",
    "Acrescenta conteúdo ao final de uma nota existente, preservando o conteúdo anterior.",
    {
      node_id: stringProperty("ID do nó da nota."),
      content_to_append: stringProperty("Texto ou Markdown a acrescentar."),
    },
  ),
  functionTool(
    "rename_note",
    "Renomeia uma nota e atualiza o título H1 do seu conteúdo.",
    {
      node_id: stringProperty("ID do nó da nota."),
      new_title: stringProperty("Novo título."),
    },
  ),
  functionTool(
    "move_note",
    "Move uma nota para outra pasta. Use null para movê-la para a raiz. Não move nem exclui pastas.",
    {
      node_id: stringProperty("ID do nó da nota."),
      parent_id: nullableStringProperty("ID da pasta de destino ou null para a raiz."),
    },
  ),
  functionTool(
    "request_delete_note",
    "Prepara a exclusão de uma nota e solicita confirmação explícita ao usuário. Esta ferramenta NUNCA exclui a nota. Não use para pastas.",
    {
      node_id: stringProperty("ID do nó da nota."),
    },
  ),
];

type ToolExecutionResult = {
  ok: boolean;
  message: string;
  data?: unknown;
  changed?: boolean;
  changedNodeId?: string;
  pendingAction?: {
    type: "delete_note";
    nodeId: string;
    title: string;
  };
};

function fail(message: string): ToolExecutionResult {
  return { ok: false, message };
}

function escapeLike(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

function normalizeTitle(value: string): string {
  const title = value.replace(/[\r\n]+/g, " ").trim().slice(0, 160);
  if (!title) throw new Error("Informe um título válido.");
  return title;
}

function markdownWithTitle(markdown: string, title: string): string {
  const body = (markdown || "")
    .trim()
    .replace(/^#\s+[^\n]*(?:\r?\n+|$)/, "")
    .trimStart();
  return "# " + title + "\n\n" + body;
}

async function getOwnedNote(
  supabase: SupabaseClient,
  userId: string,
  nodeId: string,
) {
  const { data: node, error: nodeError } = await supabase
    .from("nodes")
    .select("id, user_id, parent_id, type, name, position, created_at, updated_at, deleted_at")
    .eq("id", nodeId)
    .eq("user_id", userId)
    .eq("type", "note")
    .is("deleted_at", null)
    .maybeSingle();

  if (nodeError) throw nodeError;
  if (!node) return null;

  const { data: note, error: noteError } = await supabase
    .from("notes")
    .select("id, node_id, user_id, markdown_content, editor_content, is_favorite, last_opened_at, version, created_at, updated_at")
    .eq("node_id", nodeId)
    .eq("user_id", userId)
    .maybeSingle();

  if (noteError) throw noteError;
  if (!note) return null;

  return { node, note };
}

async function saveNoteContent(
  supabase: SupabaseClient,
  node: Record<string, any>,
  note: Record<string, any>,
  markdown: string,
) {
  const editorContent = MarkdownService.markdownToVisual(markdown, String(node.name || ""));
  const { data, error } = await supabase.rpc("save_note_versioned", {
    p_id: note.id,
    p_node_id: node.id,
    p_markdown_content: markdown,
    p_editor_content: editorContent,
    p_is_favorite: Boolean(note.is_favorite),
    p_last_opened_at: note.last_opened_at || null,
    p_version: Number(note.version || 1),
    p_updated_at: note.updated_at || null,
  });

  if (error) throw error;
  if (data?.status === "rejected_stale") {
    return { ok: false, message: "A nota foi alterada em outro dispositivo. Li a versão mais recente; tente novamente para evitar sobrescrever alterações." };
  }

  if (data?.status !== "updated" && data?.status !== "inserted") {
    throw new Error("O banco não confirmou a gravação da nota.");
  }

  return { ok: true, message: "Conteúdo salvo.", data: data.note };
}

export async function executeNoteTool(
  supabase: SupabaseClient,
  userId: string,
  toolName: string,
  args: Record<string, any>,
): Promise<ToolExecutionResult> {
  try {
    if (toolName === "list_folders") {
      const { data, error } = await supabase
        .from("nodes")
        .select("id, name, parent_id, created_at")
        .eq("user_id", userId)
        .eq("type", "folder")
        .is("deleted_at", null)
        .order("name", { ascending: true })
        .limit(200);
      if (error) throw error;
      return { ok: true, message: "Pastas encontradas.", data: data || [] };
    }

    if (toolName === "list_recent_notes") {
      const limit = Math.min(20, Math.max(1, Number(args.limit) || 10));
      const { data, error } = await supabase
        .from("nodes")
        .select("id, name, parent_id, created_at, updated_at")
        .eq("user_id", userId)
        .eq("type", "note")
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return { ok: true, message: "Notas recentes encontradas.", data: data || [] };
    }

    if (toolName === "search_notes") {
      const query = String(args.query || "").trim().slice(0, 120);
      if (query.length < 2) return fail("Informe pelo menos dois caracteres para pesquisar.");
      const pattern = "%" + escapeLike(query) + "%";

      const [titleResult, contentResult] = await Promise.all([
        supabase
          .from("nodes")
          .select("id, name, parent_id, created_at, updated_at")
          .eq("user_id", userId)
          .eq("type", "note")
          .is("deleted_at", null)
          .ilike("name", pattern)
          .limit(10),
        supabase
          .from("notes")
          .select("id, node_id, markdown_content, updated_at")
          .eq("user_id", userId)
          .ilike("markdown_content", pattern)
          .limit(10),
      ]);

      if (titleResult.error) throw titleResult.error;
      if (contentResult.error) throw contentResult.error;

      const contentNodeIds = (contentResult.data || []).map((item: any) => item.node_id);
      const allIds = Array.from(new Set([
        ...(titleResult.data || []).map((item: any) => item.id),
        ...contentNodeIds,
      ]));

      let nodes: any[] = [];
      if (allIds.length) {
        const { data, error } = await supabase
          .from("nodes")
          .select("id, name, parent_id, created_at, updated_at")
          .eq("user_id", userId)
          .eq("type", "note")
          .is("deleted_at", null)
          .in("id", allIds);
        if (error) throw error;
        nodes = data || [];
      }

      const nodeMap = new Map(nodes.map((node) => [node.id, node]));
      const snippets = (contentResult.data || []).map((item: any) => {
        const node = nodeMap.get(item.node_id);
        const content = String(item.markdown_content || "");
        const at = content.toLowerCase().indexOf(query.toLowerCase());
        const start = Math.max(0, at - 90);
        return {
          node_id: item.node_id,
          title: node?.name || "Nota",
          snippet: content.slice(start, Math.min(content.length, Math.max(0, at) + 180)).replace(/\s+/g, " "),
        };
      });

      return {
        ok: true,
        message: "Pesquisa concluída.",
        data: {
          notes: nodes,
          content_matches: snippets,
        },
      };
    }

    if (toolName === "read_note") {
      const nodeId = String(args.node_id || "");
      const found = await getOwnedNote(supabase, userId, nodeId);
      if (!found) return fail("Não encontrei essa nota ou ela não está disponível para esta conta.");
      const content = String(found.note.markdown_content || "");
      return {
        ok: true,
        message: "Nota lida.",
        data: {
          node_id: found.node.id,
          title: found.node.name,
          markdown_content: content.slice(0, 24000),
          truncated: content.length > 24000,
          updated_at: found.note.updated_at,
        },
      };
    }

    if (toolName === "create_folder") {
      const name = normalizeTitle(String(args.name || ""));
      const parentId = args.parent_id ? String(args.parent_id) : null;

      if (parentId) {
        const { data: parent, error: parentError } = await supabase
          .from("nodes")
          .select("id")
          .eq("id", parentId)
          .eq("user_id", userId)
          .eq("type", "folder")
          .is("deleted_at", null)
          .maybeSingle();
        if (parentError) throw parentError;
        if (!parent) return fail("A pasta de destino não existe ou não pertence a esta conta.");
      }

      const { data: siblings, error: siblingsError } = await supabase
        .from("nodes")
        .select("position")
        .eq("user_id", userId)
        .is("deleted_at", null)
        .is("parent_id", parentId);
      if (siblingsError) throw siblingsError;
      const position = (siblings || []).reduce((max: number, row: any) => Math.max(max, Number(row.position || 0)), 0) + 1000;

      const { data, error } = await supabase
        .from("nodes")
        .insert({
          id: crypto.randomUUID(),
          user_id: userId,
          parent_id: parentId,
          type: "folder",
          name,
          position,
        })
        .select("id, name, parent_id")
        .single();
      if (error) throw error;
      return { ok: true, message: "Pasta criada.", data, changed: true };
    }

    if (toolName === "create_note") {
      const title = normalizeTitle(String(args.title || ""));
      const parentId = args.parent_id ? String(args.parent_id) : null;
      const suppliedMarkdown = String(args.markdown_content || "").slice(0, 30000);
      const markdown = markdownWithTitle(suppliedMarkdown, title);

      if (parentId) {
        const { data: parent, error: parentError } = await supabase
          .from("nodes")
          .select("id")
          .eq("id", parentId)
          .eq("user_id", userId)
          .eq("type", "folder")
          .is("deleted_at", null)
          .maybeSingle();
        if (parentError) throw parentError;
        if (!parent) return fail("A pasta de destino não existe ou não pertence a esta conta.");
      }

      const editorContent = MarkdownService.markdownToVisual(markdown, title);
      const { data, error } = await supabase.rpc("create_note_atomic", {
        p_name: title,
        p_parent_id: parentId,
        p_markdown_content: markdown,
        p_editor_content: editorContent,
        p_node_id: null,
        p_note_id: null,
      });
      if (error) throw error;
      return {
        ok: true,
        message: "Nota criada.",
        data: {
          node_id: data?.node?.id,
          note_id: data?.note?.id,
          title: data?.node?.name || title,
          parent_id: data?.node?.parent_id ?? null,
        },
        changed: true,
        changedNodeId: data?.node?.id,
      };
    }

    if (toolName === "append_to_note") {
      const nodeId = String(args.node_id || "");
      const addition = String(args.content_to_append || "").trim();
      if (!addition) return fail("Não há conteúdo para acrescentar.");
      if (addition.length > 20000) return fail("O trecho é muito extenso. Divida a atualização em partes menores.");

      const found = await getOwnedNote(supabase, userId, nodeId);
      if (!found) return fail("Não encontrei essa nota ou ela não está disponível para esta conta.");

      const current = String(found.note.markdown_content || "");
      const updated = current.trimEnd() + "\n\n" + addition;
      if (updated.length > 40000) return fail("A nota ultrapassaria o limite de conteúdo desta operação.");

      const saved = await saveNoteContent(supabase, found.node, found.note, updated);
      if (!saved.ok) return saved;
      return {
        ok: true,
        message: "Conteúdo acrescentado sem remover o texto anterior.",
        data: { node_id: nodeId, title: found.node.name },
        changed: true,
        changedNodeId: nodeId,
      };
    }

    if (toolName === "rename_note") {
      const nodeId = String(args.node_id || "");
      const title = normalizeTitle(String(args.new_title || ""));
      const found = await getOwnedNote(supabase, userId, nodeId);
      if (!found) return fail("Não encontrei essa nota ou ela não está disponível para esta conta.");

      const updatedMarkdown = markdownWithTitle(String(found.note.markdown_content || ""), title);
      const saved = await saveNoteContent(supabase, { ...found.node, name: title }, found.note, updatedMarkdown);
      if (!saved.ok) return saved;

      const { error: renameError } = await supabase
        .from("nodes")
        .update({ name: title, updated_at: new Date().toISOString() })
        .eq("id", nodeId)
        .eq("user_id", userId);
      if (renameError) throw renameError;

      return {
        ok: true,
        message: "Nota renomeada.",
        data: { node_id: nodeId, title },
        changed: true,
        changedNodeId: nodeId,
      };
    }

    if (toolName === "move_note") {
      const nodeId = String(args.node_id || "");
      const parentId = args.parent_id ? String(args.parent_id) : null;
      const found = await getOwnedNote(supabase, userId, nodeId);
      if (!found) return fail("Não encontrei essa nota ou ela não está disponível para esta conta.");

      if (parentId) {
        const { data: parent, error: parentError } = await supabase
          .from("nodes")
          .select("id")
          .eq("id", parentId)
          .eq("user_id", userId)
          .eq("type", "folder")
          .is("deleted_at", null)
          .maybeSingle();
        if (parentError) throw parentError;
        if (!parent) return fail("A pasta de destino não existe ou não pertence a esta conta.");
      }

      const { data: siblings, error: siblingsError } = await supabase
        .from("nodes")
        .select("position")
        .eq("user_id", userId)
        .is("deleted_at", null)
        .is("parent_id", parentId);
      if (siblingsError) throw siblingsError;
      const position = (siblings || [])
        .filter((row: any) => row.id !== nodeId)
        .reduce((max: number, row: any) => Math.max(max, Number(row.position || 0)), 0) + 1000;

      const { data, error } = await supabase.rpc("move_node_atomic", {
        p_node_id: nodeId,
        p_new_parent_id: parentId,
        p_new_position: position,
      });
      if (error) throw error;
      if (data !== true) return fail("O banco não confirmou a movimentação.");
      return {
        ok: true,
        message: "Nota movida.",
        data: { node_id: nodeId, parent_id: parentId },
        changed: true,
        changedNodeId: nodeId,
      };
    }

    if (toolName === "request_delete_note") {
      const nodeId = String(args.node_id || "");
      const found = await getOwnedNote(supabase, userId, nodeId);
      if (!found) return fail("Não encontrei essa nota ou ela não está disponível para esta conta.");
      return {
        ok: true,
        message: "A exclusão está aguardando confirmação explícita do usuário. Nenhum dado foi apagado.",
        data: { node_id: nodeId, title: found.node.name },
        pendingAction: {
          type: "delete_note",
          nodeId,
          title: String(found.node.name || "Nota sem título"),
        },
      };
    }

    return fail("Ferramenta não reconhecida.");
  } catch (error: any) {
    console.error("[notes-assistant] Tool execution failed:", {
      toolName,
      message: error?.message || String(error),
      code: error?.code,
    });
    return fail("Não consegui concluir essa operação. Verifique se a nota ou pasta existe e tente novamente.");
  }
}
