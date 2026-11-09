import { createClient } from "@supabase/supabase-js";

/**
 * Cria um cliente Supabase vinculado ao JWT do usuário autenticado.
 * Não utiliza service_role: RLS continua sendo aplicada no banco.
 */
export async function getAuthenticatedSupabase(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);

  if (!match?.[1]) {
    throw new Error("UNAUTHORIZED");
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !anonKey || url.includes("your-project") || anonKey.includes("your-anon-key")) {
    throw new Error("SUPABASE_NOT_CONFIGURED");
  }

  const accessToken = match[1];
  const supabase = createClient(url, anonKey, {
    global: {
      headers: { Authorization: "Bearer " + accessToken },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  const { data, error } = await supabase.auth.getUser(accessToken);
  if (error || !data.user) {
    throw new Error("UNAUTHORIZED");
  }

  return { supabase, user: data.user };
}
