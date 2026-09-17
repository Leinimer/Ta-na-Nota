import { getSupabase, isSupabaseConfigured } from '@/lib/supabase/client';
import { AppUser } from '@/types';
import { indexedDbService } from './indexedDbService';
import { createInitialDemoData, DEMO_USER } from './demoData';

export const authService = {
  async getCurrentUser(): Promise<AppUser | null> {
    const supabase = getSupabase();
    if (supabase && isSupabaseConfigured) {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          return {
            id: user.id,
            email: user.email,
            displayName: user.user_metadata?.display_name || user.email?.split('@')[0],
            avatarUrl: user.user_metadata?.avatar_url,
          };
        }
      } catch (err) {
        console.warn('Supabase auth check failed, falling back to local user', err);
      }
    }

    // Fallback to local IndexedDB session or default demo user
    let localUser = await indexedDbService.getLocalUser();
    if (!localUser) {
      localUser = DEMO_USER;
      await indexedDbService.setLocalUser(localUser);
      // Seed initial demo data for this user
      const demo = createInitialDemoData(localUser.id);
      for (const node of demo.nodes) await indexedDbService.saveNode(node);
      for (const note of demo.notes) await indexedDbService.saveNote(note);
      for (const tag of demo.tags) await indexedDbService.saveTag(tag);
      // Seed initial links
      await indexedDbService.setNoteLinks(localUser.id, 'note-controle', ['note-direitos']);
      await indexedDbService.setNoteLinks(localUser.id, 'note-direitos', ['note-controle']);
      await indexedDbService.setNoteLinks(localUser.id, 'note-investimentos', ['note-aposentadoria']);
      // Seed tags relations
      await indexedDbService.setNoteTags(localUser.id, 'note-controle', ['tag-estudos', 'tag-direito', 'tag-constitucional']);
      await indexedDbService.setNoteTags(localUser.id, 'note-direitos', ['tag-estudos', 'tag-direito']);
      await indexedDbService.setNoteTags(localUser.id, 'note-investimentos', ['tag-financas', 'tag-investimentos']);
      await indexedDbService.setNoteTags(localUser.id, 'note-aposentadoria', ['tag-financas']);
      await indexedDbService.setNoteTags(localUser.id, 'note-solta', ['tag-ideias', 'tag-livros']);
    }

    return localUser;
  },

  async signInWithEmail(email: string, password: string): Promise<{ user: AppUser | null; error?: string }> {
    const supabase = getSupabase();
    if (supabase && isSupabaseConfigured) {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) return { user: null, error: error.message };
      if (data.user) {
        const appUser: AppUser = {
          id: data.user.id,
          email: data.user.email,
          displayName: data.user.user_metadata?.display_name || data.user.email?.split('@')[0],
          avatarUrl: data.user.user_metadata?.avatar_url,
        };
        await indexedDbService.setLocalUser(appUser);
        return { user: appUser };
      }
    }

    // Local authentication for demo/standalone
    const appUser: AppUser = {
      id: 'local_' + email.replace(/[^a-zA-Z0-9]/g, '_'),
      email,
      displayName: email.split('@')[0],
    };
    await indexedDbService.setLocalUser(appUser);
    return { user: appUser };
  },

  async signUpWithEmail(email: string, password: string, displayName?: string): Promise<{ user: AppUser | null; error?: string }> {
    const supabase = getSupabase();
    if (supabase && isSupabaseConfigured) {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { display_name: displayName || email.split('@')[0] },
        },
      });
      if (error) return { user: null, error: error.message };
      if (data.user) {
        const appUser: AppUser = {
          id: data.user.id,
          email: data.user.email,
          displayName: displayName || email.split('@')[0],
        };
        await indexedDbService.setLocalUser(appUser);
        return { user: appUser };
      }
    }

    // Local signup
    const appUser: AppUser = {
      id: 'local_' + email.replace(/[^a-zA-Z0-9]/g, '_'),
      email,
      displayName: displayName || email.split('@')[0],
    };
    await indexedDbService.setLocalUser(appUser);
    const demo = createInitialDemoData(appUser.id);
    for (const node of demo.nodes) await indexedDbService.saveNode(node);
    for (const note of demo.notes) await indexedDbService.saveNote(note);
    for (const tag of demo.tags) await indexedDbService.saveTag(tag);
    return { user: appUser };
  },

  async signOut(): Promise<void> {
    const supabase = getSupabase();
    if (supabase && isSupabaseConfigured) {
      await supabase.auth.signOut();
    }
    await indexedDbService.setLocalUser(null);
  },
};
