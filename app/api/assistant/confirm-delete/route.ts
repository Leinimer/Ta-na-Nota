import { NextResponse } from "next/server";
import { getAuthenticatedSupabase } from "@/lib/ai-notes/server";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  try {
    const { supabase, user } = await getAuthenticatedSupabase(request);
    const body = await request.json().catch(() => null);
    const nodeId = typeof body?.nodeId === "string" ? body.nodeId : "";

    if (!nodeId) {
      return NextResponse.json({ error: "ID da nota não informado." }, { status: 400 });
    }

    // Coleta os arquivos antes da exclusão. O RPC remove os registros de anexo;
    // depois tentamos remover os objetos físicos do bucket privado.
    const { data: note } = await supabase
      .from("notes")
      .select("id")
      .eq("node_id", nodeId)
      .eq("user_id", user.id)
      .maybeSingle();

    let storagePaths: string[] = [];
    if (note?.id) {
      const { data: attachments } = await supabase
        .from("attachments")
        .select("storage_path")
        .eq("note_id", note.id)
        .eq("user_id", user.id);
      storagePaths = (attachments || [])
        .map((item: any) => String(item.storage_path || ""))
        .filter(Boolean);
    }

    const { data, error } = await supabase.rpc("delete_note_atomic", {
      p_node_id: nodeId,
    });

    if (error) {
      console.error("[notes-assistant] Delete RPC failed:", error.code || error.message);
      return NextResponse.json(
        { error: "Não foi possível excluir a nota. Ela pode já ter sido removida ou não pertencer à sua conta." },
        { status: 409 },
      );
    }

    if (data?.status !== "deleted") {
      return NextResponse.json({ error: "O banco não confirmou a exclusão." }, { status: 409 });
    }

    let storageCleanup = "complete";
    if (storagePaths.length) {
      const { error: storageError } = await supabase.storage.from("attachments").remove(storagePaths);
      if (storageError) {
        storageCleanup = "pending";
        console.warn("[notes-assistant] Storage cleanup failed:", storageError.message);
      }
    }

    return NextResponse.json({
      success: true,
      title: data.title || "Nota",
      nodeId,
      storageCleanup,
    });
  } catch (error: any) {
    const message = error?.message || String(error);
    if (message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Sua sessão expirou. Entre novamente no aplicativo." }, { status: 401 });
    }
    if (message === "SUPABASE_NOT_CONFIGURED") {
      return NextResponse.json({ error: "O Supabase não está configurado no servidor." }, { status: 503 });
    }
    console.error("[notes-assistant] Confirm delete failed:", message);
    return NextResponse.json({ error: "Não foi possível concluir a exclusão." }, { status: 500 });
  }
}
