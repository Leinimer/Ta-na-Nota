import { getSupabase, isSupabaseConfigured } from '@/lib/supabase/client';
import { AppUser } from '@/types';
import { indexedDbService } from './indexedDbService';

const KEEP_CONNECTED_KEY = 'tana_nota_keep_connected';
const SESSION_ACTIVE_KEY = 'tana_nota_session_active';

export const authService = {
  /**
   * Retrieves currently authenticated user or returns null.
   * Never forces demo user for unauthenticated visitors.
   */
  async getCurrentUser(): Promise<AppUser | null> {
    if (typeof window !== 'undefined') {
      const keepConnected = localStorage.getItem(KEEP_CONNECTED_KEY) !== 'false';
      const sessionActive = sessionStorage.getItem(SESSION_ACTIVE_KEY) === 'true';

      // If user chose NOT to keep connected and browser was restarted (sessionStorage empty)
      if (!keepConnected && !sessionActive) {
        await this.signOut();
        return null;
      }
    }

    const supabase = getSupabase();
    if (supabase && isSupabaseConfigured) {
      try {
        const { data: { user }, error } = await supabase.auth.getUser();
        if (!error && user) {
          // Attempt to enrich with profile data (name, username)
          let username = user.user_metadata?.username;
          let name = user.user_metadata?.name || user.user_metadata?.display_name;

          try {
            const { data: profile } = await supabase
              .from('profiles')
              .select('name, display_name, username')
              .eq('id', user.id)
              .maybeSingle();

            if (profile) {
              name = profile.name || profile.display_name || name;
              username = profile.username || username;
            }
          } catch {
            // Profile query might fail before migration is run
          }

          const appUser: AppUser = {
            id: user.id,
            email: user.email,
            name: name || user.email?.split('@')[0],
            displayName: name || user.email?.split('@')[0],
            username: username || user.email?.split('@')[0],
            avatarUrl: user.user_metadata?.avatar_url,
          };

          await indexedDbService.setLocalUser(appUser);
          if (typeof window !== 'undefined') {
            sessionStorage.setItem(SESSION_ACTIVE_KEY, 'true');
          }
          return appUser;
        }
      } catch (err) {
        console.warn('Supabase auth check failed:', err);
      }
    }

    // Check local session only if already explicitly logged in previously
    const localUser = await indexedDbService.getLocalUser();
    if (localUser && localUser.id !== 'demo-user-tactility-1') {
      return localUser;
    }

    return null;
  },

  /**
   * Checks if username is available (both via Supabase and validation rules)
   */
  async isUsernameAvailable(username: string): Promise<{ available: boolean; error?: string }> {
    const clean = username.trim().toLowerCase();
    if (!clean) return { available: false, error: 'O login não pode ser vazio.' };

    // Allowed: letters, numbers, underscore, dot (no spaces)
    if (!/^[a-zA-Z0-9_.]+$/.test(clean)) {
      return { available: false, error: 'O login deve conter apenas letras, números, ponto ou sublinhado.' };
    }

    if (clean.length < 3) {
      return { available: false, error: 'O login deve ter no mínimo 3 caracteres.' };
    }

    const supabase = getSupabase();
    if (supabase && isSupabaseConfigured) {
      try {
        // Try RPC first if created
        const { data: rpcAvailable, error: rpcErr } = await supabase.rpc('is_username_available', {
          p_username: clean,
        });

        if (!rpcErr && typeof rpcAvailable === 'boolean') {
          return { available: rpcAvailable, error: rpcAvailable ? undefined : 'Este login já está em uso.' };
        }

        // Fallback to direct query on profiles
        const { data } = await supabase
          .from('profiles')
          .select('id')
          .eq('username', clean)
          .maybeSingle();

        if (data) {
          return { available: false, error: 'Este login já está em uso.' };
        }
      } catch {
        // Continue if profile table doesn't have username yet
      }
    }

    return { available: true };
  },

  /**
   * Sign in using either Email or Username + Password.
   */
  async signInWithIdentifier(
    identifier: string,
    password: string,
    keepConnected: boolean = true
  ): Promise<{ user: AppUser | null; error?: string }> {
    const trimmed = identifier.trim();
    if (!trimmed) return { user: null, error: 'Informe seu e-mail ou login.' };
    if (!password) return { user: null, error: 'Informe sua senha.' };

    let targetEmail = trimmed;

    // If identifier doesn't contain '@', it is treated as a username
    if (!trimmed.includes('@')) {
      const usernameClean = trimmed.toLowerCase();
      const supabase = getSupabase();

      if (supabase && isSupabaseConfigured) {
        // 1. Try RPC get_email_by_username
        try {
          const { data: emailFromRpc, error: rpcErr } = await supabase.rpc('get_email_by_username', {
            p_username: usernameClean,
          });

          if (!rpcErr && emailFromRpc) {
            targetEmail = emailFromRpc;
          } else {
            // 2. Try profiles table lookup
            const { data: profile } = await supabase
              .from('profiles')
              .select('id, username')
              .eq('username', usernameClean)
              .maybeSingle();

            if (!profile) {
              return { user: null, error: 'Usuário com este login não foi encontrado.' };
            }
          }
        } catch {
          // If RPC not available and direct query fails
          return { user: null, error: 'Não foi possível encontrar a conta associada a este login.' };
        }
      } else {
        // Local offline fallback
        const localUser = await indexedDbService.getLocalUser();
        if (localUser && localUser.username === usernameClean && localUser.email) {
          targetEmail = localUser.email;
        }
      }
    }

    // Persist preference for session
    if (typeof window !== 'undefined') {
      localStorage.setItem(KEEP_CONNECTED_KEY, keepConnected ? 'true' : 'false');
      sessionStorage.setItem(SESSION_ACTIVE_KEY, 'true');
    }

    const supabase = getSupabase();
    if (supabase && isSupabaseConfigured) {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: targetEmail,
        password,
      });

      if (error) {
        return { user: null, error: 'Credenciais inválidas. Verifique seu login/e-mail e senha.' };
      }

      if (data.user) {
        const appUser: AppUser = {
          id: data.user.id,
          email: data.user.email,
          name: data.user.user_metadata?.name || data.user.user_metadata?.display_name || data.user.email?.split('@')[0],
          displayName: data.user.user_metadata?.display_name || data.user.email?.split('@')[0],
          username: data.user.user_metadata?.username || (!trimmed.includes('@') ? trimmed : data.user.email?.split('@')[0]),
          avatarUrl: data.user.user_metadata?.avatar_url,
        };
        await indexedDbService.setLocalUser(appUser);
        return { user: appUser };
      }
    }

    // Fallback for standalone/local environment
    const localUser: AppUser = {
      id: 'local_' + targetEmail.replace(/[^a-zA-Z0-9]/g, '_'),
      email: targetEmail,
      name: targetEmail.split('@')[0],
      displayName: targetEmail.split('@')[0],
      username: !trimmed.includes('@') ? trimmed : targetEmail.split('@')[0],
    };
    await indexedDbService.setLocalUser(localUser);
    return { user: localUser };
  },

  /**
   * Creates a new user account with Name, Username, Email and Password.
   */
  async signUp(params: {
    name: string;
    username: string;
    email: string;
    password: string;
    keepConnected?: boolean;
  }): Promise<{ user: AppUser | null; error?: string }> {
    const { name, username, email, password, keepConnected = true } = params;

    // Validate fields
    if (!name.trim()) return { user: null, error: 'Informe seu nome.' };
    if (!username.trim()) return { user: null, error: 'Informe um login.' };
    if (!email.trim() || !email.includes('@')) return { user: null, error: 'Informe um e-mail válido.' };
    if (password.length < 6) return { user: null, error: 'A senha deve conter no mínimo 6 caracteres.' };

    // Validate username rules
    const usernameCheck = await this.isUsernameAvailable(username);
    if (!usernameCheck.available) {
      return { user: null, error: usernameCheck.error || 'Este login já está em uso.' };
    }

    if (typeof window !== 'undefined') {
      localStorage.setItem(KEEP_CONNECTED_KEY, keepConnected ? 'true' : 'false');
      sessionStorage.setItem(SESSION_ACTIVE_KEY, 'true');
    }

    const cleanUsername = username.trim().toLowerCase();
    const cleanName = name.trim();

    const supabase = getSupabase();
    if (supabase && isSupabaseConfigured) {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: {
            name: cleanName,
            display_name: cleanName,
            username: cleanUsername,
          },
        },
      });

      if (error) return { user: null, error: error.message };

      if (data.user) {
        // Attempt to upsert profile record
        try {
          await supabase.from('profiles').upsert({
            id: data.user.id,
            name: cleanName,
            display_name: cleanName,
            username: cleanUsername,
            updated_at: new Date().toISOString(),
          });
        } catch (err) {
          console.warn('Profile upsert pending DB migration:', err);
        }

        const appUser: AppUser = {
          id: data.user.id,
          email: data.user.email,
          name: cleanName,
          displayName: cleanName,
          username: cleanUsername,
        };
        await indexedDbService.setLocalUser(appUser);
        return { user: appUser };
      }
    }

    // Standalone fallback
    const appUser: AppUser = {
      id: 'local_' + email.replace(/[^a-zA-Z0-9]/g, '_'),
      email: email.trim(),
      name: cleanName,
      displayName: cleanName,
      username: cleanUsername,
    };
    await indexedDbService.setLocalUser(appUser);
    return { user: appUser };
  },

  /**
   * Official Supabase Google OAuth sign in.
   */
  async signInWithGoogle(): Promise<{ error?: string }> {
    const supabase = getSupabase();
    if (!supabase || !isSupabaseConfigured) {
      return { error: 'Supabase não está configurado para autenticação com o Google.' };
    }

    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: typeof window !== 'undefined' ? window.location.origin : undefined,
        },
      });
      if (error) return { error: error.message };
      return {};
    } catch (err: any) {
      return { error: err?.message || 'Erro ao conectar com o Google.' };
    }
  },

  /**
   * Helper alias for sign in with email
   */
  async signInWithEmail(email: string, pass: string): Promise<{ user: AppUser | null; error?: string }> {
    return this.signInWithIdentifier(email, pass, true);
  },

  /**
   * Helper alias for sign up with email
   */
  async signUpWithEmail(email: string, pass: string, name?: string): Promise<{ user: AppUser | null; error?: string }> {
    const cleanName = name || email.split('@')[0];
    const username = email.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '').toLowerCase().slice(0, 20) || 'user_' + Date.now().toString(36);
    return this.signUp({
      name: cleanName,
      username,
      email,
      password: pass,
      keepConnected: true,
    });
  },

  /**
   * Logs out user from Supabase and clears local memory and session.
   */
  async signOut(): Promise<void> {
    const supabase = getSupabase();
    if (supabase && isSupabaseConfigured) {
      try {
        await supabase.auth.signOut();
      } catch (err) {
        console.warn('Error signing out of Supabase:', err);
      }
    }
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem(SESSION_ACTIVE_KEY);
      localStorage.removeItem(KEEP_CONNECTED_KEY);
    }
    await indexedDbService.setLocalUser(null);
  },
};
