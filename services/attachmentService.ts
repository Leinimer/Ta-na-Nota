import { AttachmentRecord } from '@/types';
import { indexedDbService } from './indexedDbService';
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase/client';

// ====================================================================
// STORAGE PROVIDER ABSTRACTION
// ====================================================================

export interface StorageUploadParams {
  storagePath: string;
  file: Blob | File;
  mimeType: string;
  userId: string;
}

export interface AttachmentStorageProvider {
  name: string;
  upload(params: StorageUploadParams): Promise<{ error: Error | null }>;
  createSignedUrl(storagePath: string, expiresInSeconds: number): Promise<{ signedUrl: string | null; error: Error | null }>;
  delete(storagePath: string): Promise<{ error: Error | null }>;
}

/**
 * Provedor Atual: Supabase Storage
 */
export class SupabaseStorageProvider implements AttachmentStorageProvider {
  name = 'supabase';

  async upload(params: StorageUploadParams): Promise<{ error: Error | null }> {
    const supabase = getSupabase();
    if (!supabase || !isSupabaseConfigured) {
      return { error: new Error('Supabase client não configurado') };
    }

    try {
      const { error } = await supabase.storage
        .from('attachments')
        .upload(params.storagePath, params.file, {
          contentType: params.mimeType,
          upsert: true,
        });

      return { error: error ? new Error(error.message) : null };
    } catch (err: any) {
      return { error: err instanceof Error ? err : new Error(String(err)) };
    }
  }

  async createSignedUrl(
    storagePath: string,
    expiresInSeconds: number
  ): Promise<{ signedUrl: string | null; error: Error | null }> {
    const supabase = getSupabase();
    if (!supabase || !isSupabaseConfigured) {
      return { signedUrl: null, error: new Error('Supabase client não configurado') };
    }

    try {
      const { data, error } = await supabase.storage
        .from('attachments')
        .createSignedUrl(storagePath, expiresInSeconds);

      if (error || !data?.signedUrl) {
        return { signedUrl: null, error: error ? new Error(error.message) : new Error('URL assinada indisponível') };
      }

      return { signedUrl: data.signedUrl, error: null };
    } catch (err: any) {
      return { signedUrl: null, error: err instanceof Error ? err : new Error(String(err)) };
    }
  }

  async delete(storagePath: string): Promise<{ error: Error | null }> {
    const supabase = getSupabase();
    if (!supabase || !isSupabaseConfigured) {
      return { error: new Error('Supabase client não configurado') };
    }

    try {
      const { error } = await supabase.storage.from('attachments').remove([storagePath]);
      return { error: error ? new Error(error.message) : null };
    } catch (err: any) {
      return { error: err instanceof Error ? err : new Error(String(err)) };
    }
  }
}

/**
 * Provedor Preparado: Cloudflare R2 (S3-compatible)
 * Pronto para ativação futura sem alterar a interface usada pelo NoteEditor.
 */
export class CloudflareR2StorageProvider implements AttachmentStorageProvider {
  name = 'cloudflare-r2';

  async upload(_params: StorageUploadParams): Promise<{ error: Error | null }> {
    return { error: new Error('Cloudflare R2 ainda não configurado com credenciais de produção.') };
  }

  async createSignedUrl(_storagePath: string, _expiresInSeconds: number): Promise<{ signedUrl: string | null; error: Error | null }> {
    return { signedUrl: null, error: new Error('Cloudflare R2 ainda não configurado.') };
  }

  async delete(_storagePath: string): Promise<{ error: Error | null }> {
    return { error: new Error('Cloudflare R2 ainda não configurado.') };
  }
}

// Provedor ativo da aplicação (padrão: Supabase Storage)
let currentProvider: AttachmentStorageProvider = new SupabaseStorageProvider();

// Cache em memória para URLs assinadas ativas (evita requisições repetidas ao Supabase)
const signedUrlCache = new Map<string, { url: string; expiresAt: number }>();
// Cache local em memória para Object URLs geradas temporariamente offline
const localBlobUrlCache = new Map<string, string>();

const MAX_IMAGE_SIZE_BYTES = 15 * 1024 * 1024; // 15MB limite de upload no cliente

/**
 * Otimiza imagens grandes no navegador antes do envio (JPEG, PNG, WebP).
 * - Fotografias grandes são convertidas para WebP compactado mantendo alta nitidez.
 * - Transparências em PNG são preservadas.
 * - SVGs, GIFs e PDFs NUNCA sofrem compressão destrutiva ou conversão em imagem.
 */
async function optimizeImageIfNeeded(file: File): Promise<File> {
  // 1. Rejeita arquivos excessivamente grandes
  if (file.size > MAX_IMAGE_SIZE_BYTES) {
    throw new Error('O arquivo excede o limite máximo permitido de 15MB.');
  }

  // 2. Não toca em SVGs, GIFs animados ou PDFs
  if (
    file.type === 'image/svg+xml' ||
    file.type === 'image/gif' ||
    file.type === 'application/pdf'
  ) {
    return file;
  }

  // Se for imagem pequena (< 800 KB), não há necessidade de re-codificação pesada
  if (file.size < 800 * 1024) {
    return file;
  }

  // 3. Re-amostragem e compressão no Canvas
  try {
    const bitmap = await createImageBitmap(file);
    const maxDim = 2048;
    let { width, height } = bitmap;

    if (width > maxDim || height > maxDim) {
      if (width > height) {
        height = Math.round((height * maxDim) / width);
        width = maxDim;
      } else {
        width = Math.round((width * maxDim) / height);
        height = maxDim;
      }
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;

    ctx.drawImage(bitmap, 0, 0, width, height);

    // Detecta se PNG tem canal alfa transparente
    let targetMime = 'image/webp';
    let targetExt = '.webp';

    if (file.type === 'image/png') {
      const imageData = ctx.getImageData(0, 0, width, height).data;
      let hasAlpha = false;
      for (let i = 3; i < imageData.length; i += 4) {
        if (imageData[i] < 250) {
          hasAlpha = true;
          break;
        }
      }
      if (hasAlpha) {
        targetMime = 'image/png';
        targetExt = '.png';
      }
    }

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, targetMime, 0.86);
    });

    if (blob && blob.size < file.size) {
      const baseName = file.name.replace(/\.[^/.]+$/, '');
      return new File([blob], `${baseName}${targetExt}`, { type: targetMime });
    }

    return file;
  } catch (err) {
    console.warn('[AttachmentService] Não foi possível otimizar a imagem, prosseguindo com original:', err);
    return file;
  }
}

export const attachmentService = {
  /**
   * Permite configurar um provedor alternativo (ex: Cloudflare R2) sem quebrar o NoteEditor
   */
  setStorageProvider(provider: AttachmentStorageProvider) {
    currentProvider = provider;
  },

  getStorageProvider(): AttachmentStorageProvider {
    return currentProvider;
  },

  async getAttachments(noteId: string): Promise<AttachmentRecord[]> {
    return indexedDbService.getAttachments(noteId);
  },

  /**
   * Resolve uma referência de imagem (attachment:path ou URL remota) para uma URL assinada válida.
   * NUNCA retorna Base64 para armazenar no documento.
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

    // Se não for anexo interno e for uma URL web pública, retorna direto
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

    // 1. Verifica cache em memória de URLs assinadas
    const cached = signedUrlCache.get(storagePath);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.url;
    }

    // 2. Verifica se há uma URL de objeto local temporária em memória (ex: offline recente)
    const localBlob = localBlobUrlCache.get(storagePath);
    if (localBlob) {
      return localBlob;
    }

    // 3. Gera Signed URL no Provider de Storage (Supabase Storage)
    const { signedUrl, error } = await currentProvider.createSignedUrl(storagePath, 7200); // 2 horas
    if (!error && signedUrl) {
      signedUrlCache.set(storagePath, {
        url: signedUrl,
        expiresAt: Date.now() + 6600 * 1000, // renova com folga
      });
      return signedUrl;
    }

    // 4. Fallback para cache local no IndexedDB
    try {
      const local = await indexedDbService.getAttachmentByStoragePath(storagePath);
      if (local && local.url && local.url.startsWith('blob:')) {
        return local.url;
      }
    } catch {
      // ignore
    }

    return src;
  },

  /**
   * Realiza upload de arquivo (imagem ou PDF).
   * Garante que:
   * 1. O arquivo físico vá para o Storage.
   * 2. Os metadados vão para public.attachments no Supabase.
   * 3. O retorno SEMPRE possui url no formato 'attachment:storagePath', NUNCA Base64.
   */
  async uploadAttachment(
    userId: string,
    noteId: string,
    rawFile: File
  ): Promise<AttachmentRecord> {
    // 1. Otimiza arquivo se for imagem
    const file = await optimizeImageIfNeeded(rawFile);

    const id = crypto.randomUUID();
    const cleanFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storagePath = `${userId}/${noteId}/${Date.now()}_${cleanFileName}`;
    const referenceUrl = `attachment:${storagePath}`;

    // Cria object URL temporária para visualização instantânea no editor enquanto faz o upload
    if (typeof URL !== 'undefined' && URL.createObjectURL) {
      const objectUrl = URL.createObjectURL(file);
      localBlobUrlCache.set(storagePath, objectUrl);
    }

    // 2. Envia para o Storage Provider
    const { error: uploadErr } = await currentProvider.upload({
      storagePath,
      file,
      mimeType: file.type,
      userId,
    });

    if (!uploadErr) {
      // Gera signed URL para exibição segura e limpa o fallback temporário
      const { signedUrl } = await currentProvider.createSignedUrl(storagePath, 7200);
      if (signedUrl) {
        signedUrlCache.set(storagePath, {
          url: signedUrl,
          expiresAt: Date.now() + 6600 * 1000,
        });
      }

      // 3. Persiste APENAS metadados na tabela public.attachments (NUNCA conteúdo binário)
      const supabase = getSupabase();
      if (supabase && isSupabaseConfigured) {
        try {
          await supabase.from('attachments').insert({
            id,
            user_id: userId,
            note_id: noteId,
            file_name: file.name,
            file_size: file.size,
            mime_type: file.type,
            storage_path: storagePath,
          });
        } catch (dbErr) {
          console.warn('[AttachmentService] Erro ao persistir metadados em public.attachments:', dbErr);
        }
      }
    } else {
      console.warn('[AttachmentService] Upload remoto falhou ou offline; mantendo anexo em cache local:', uploadErr.message);
    }

    // 4. Salva registro no IndexedDB local com referência limpa (SEM Base64)
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
      url: referenceUrl, // Sempre 'attachment:...'
    };

    await indexedDbService.saveAttachment(attachment);
    return attachment;
  },

  async deleteAttachment(id: string): Promise<void> {
    const att = await indexedDbService.getAttachment(id);
    if (att && att.storagePath) {
      await currentProvider.delete(att.storagePath);
      const supabase = getSupabase();
      if (supabase && isSupabaseConfigured) {
        await supabase.from('attachments').delete().eq('id', id);
      }
    }
    await indexedDbService.deleteAttachment(id);
  },

  /**
   * Exclui anexos vinculados a uma nota quando ela for excluída definitivamente
   */
  async deleteAttachmentsForNote(noteId: string): Promise<void> {
    const attachments = await indexedDbService.getAttachments(noteId);
    for (const att of attachments) {
      try {
        if (att.storagePath) {
          await currentProvider.delete(att.storagePath);
        }
        await indexedDbService.deleteAttachment(att.id);
      } catch (err) {
        console.warn(`[AttachmentService] Erro ao limpar anexo ${att.id}:`, err);
      }
    }

    const supabase = getSupabase();
    if (supabase && isSupabaseConfigured) {
      try {
        await supabase.from('attachments').delete().eq('note_id', noteId);
      } catch (err) {
        console.warn('[AttachmentService] Erro ao deletar anexos remotos da nota:', err);
      }
    }
  },
};
