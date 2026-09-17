import { AttachmentRecord } from '@/types';
import { indexedDbService } from './indexedDbService';
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase/client';

// Cache em memória para URLs assinadas ativas (evita requisições repetidas ao Supabase)
const signedUrlCache = new Map<string, { url: string; expiresAt: number }>();

export const attachmentService = {
  async getAttachments(noteId: string): Promise<AttachmentRecord[]> {
    return indexedDbService.getAttachments(noteId);
  },

  /**
   * Resolve uma referência de imagem (attachment:path ou URL antiga) para uma URL assinada válida ou URL local
   */
  async resolveImageUrl(src: string): Promise<string> {
    if (!src) return '';
    if (src.startsWith('data:') || src.startsWith('blob:')) {
      return src;
    }

    let storagePath: string | null = null;
    if (src.startsWith('attachment:')) {
      storagePath = src.replace(/^attachment:/, '');
    } else if (src.includes('/storage/v1/object/')) {
      const match = src.match(/\/attachments\/([^?#]+)/);
      if (match && match[1]) {
        storagePath = decodeURIComponent(match[1]);
      }
    }

    // Se não for anexo do Supabase e for uma URL web comum, retorna direto
    if (!storagePath) {
      if (src.startsWith('http://') || src.startsWith('https://')) {
        return src;
      }
      if (src.includes('/')) {
        storagePath = src;
      } else {
        return src;
      }
    }

    // 1. Verifica cache em memória
    const cached = signedUrlCache.get(storagePath);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.url;
    }

    // 2. Gera Signed URL no Supabase Storage privado
    const supabase = getSupabase();
    if (supabase && isSupabaseConfigured) {
      try {
        const { data, error } = await supabase.storage
          .from('attachments')
          .createSignedUrl(storagePath, 7200); // 2 horas de validade

        if (!error && data?.signedUrl) {
          signedUrlCache.set(storagePath, {
            url: data.signedUrl,
            expiresAt: Date.now() + 6600 * 1000, // renova com folga de ~1h50m
          });
          return data.signedUrl;
        }
      } catch (err) {
        console.warn('Erro ao criar signed URL para anexo privado:', err);
      }
    }

    // 3. Fallback para cache local no IndexedDB (ex: offline ou modo local)
    try {
      const local = await indexedDbService.getAttachmentByStoragePath(storagePath);
      if (local && local.url && (local.url.startsWith('data:') || local.url.startsWith('blob:'))) {
        return local.url;
      }
    } catch {
      // ignore
    }

    return src;
  },

  async uploadAttachment(
    userId: string,
    noteId: string,
    file: File
  ): Promise<AttachmentRecord> {
    const id = crypto.randomUUID();
    const cleanFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storagePath = `${userId}/${noteId}/${Date.now()}_${cleanFileName}`;
    const referenceUrl = `attachment:${storagePath}`;
    let displayUrl = '';

    const supabase = getSupabase();
    if (supabase && isSupabaseConfigured) {
      try {
        const { error } = await supabase.storage
          .from('attachments')
          .upload(storagePath, file, {
            contentType: file.type,
            upsert: true,
          });

        if (!error) {
          // Obtém signed URL temporária para exibição imediata no editor
          const { data: signedData } = await supabase.storage
            .from('attachments')
            .createSignedUrl(storagePath, 7200);

          if (signedData?.signedUrl) {
            displayUrl = signedData.signedUrl;
            signedUrlCache.set(storagePath, {
              url: displayUrl,
              expiresAt: Date.now() + 6600 * 1000,
            });
          }

          // Persiste metadados na tabela public.attachments
          await supabase.from('attachments').insert({
            id,
            user_id: userId,
            note_id: noteId,
            file_name: file.name,
            file_size: file.size,
            mime_type: file.type,
            storage_path: storagePath,
          });
        }
      } catch (err) {
        console.warn('Falha no upload para Supabase Storage, usando armazenamento local:', err);
      }
    }

    // Fallback local caso Supabase Storage não esteja configurado ou falhe
    if (!displayUrl) {
      const localDataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string || '');
        reader.onerror = () => resolve('');
        reader.readAsDataURL(file);
      });

      displayUrl = localDataUrl || URL.createObjectURL(file);
      signedUrlCache.set(storagePath, {
        url: displayUrl,
        expiresAt: Date.now() + 86400 * 1000,
      });
    }

    const attachment: AttachmentRecord = {
      id,
      userId,
      noteId,
      fileName: file.name,
      storagePath,
      mimeType: file.type,
      fileSize: file.size,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      url: referenceUrl,
    };

    await indexedDbService.saveAttachment(attachment);
    return attachment;
  },

  async deleteAttachment(id: string): Promise<void> {
    await indexedDbService.deleteAttachment(id);
  },
};
