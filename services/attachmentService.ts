import { AttachmentRecord } from '@/types';
import { indexedDbService } from './indexedDbService';
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase/client';
import { syncEngine } from './syncEngine';

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

// Ouvintes de atualização de anexos para UI reativa sem remontar o editor
type AttachmentUpdateListener = (info: { id: string; storagePath: string; objectUrl: string }) => void;
const updateListeners = new Set<AttachmentUpdateListener>();

export function subscribeToAttachmentUpdates(listener: AttachmentUpdateListener): () => void {
  updateListeners.add(listener);
  return () => {
    updateListeners.delete(listener);
  };
}

function notifyAttachmentUpdated(id: string, storagePath: string, objectUrl: string) {
  for (const listener of updateListeners) {
    try {
      listener({ id, storagePath, objectUrl });
    } catch (err) {
      console.warn('[AttachmentService] Erro ao notificar ouvinte:', err);
    }
  }
}

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
   * Baixa anexo do Supabase Storage de forma autenticada e confiável.
   * Conforme especificação:
   * 1. Obter attachment e storage_path
   * 2. Verificar sessão
   * 3. Baixar do Storage
   * 4. Verificar erro
   * 5. Guardar Blob no IndexedDB (Offline-First permanente)
   * 6. Gerar referência local (Object URL)
   * 7. Atualizar UI
   */
  async downloadAttachment(
    attachmentOrIdOrPath: AttachmentRecord | string
  ): Promise<string | null> {
    let attachment: AttachmentRecord | null = null;
    let storagePath: string | null = null;

    if (typeof attachmentOrIdOrPath === 'object' && attachmentOrIdOrPath !== null) {
      attachment = attachmentOrIdOrPath;
      storagePath = attachment.storagePath;
    } else if (typeof attachmentOrIdOrPath === 'string') {
      const cleaned = attachmentOrIdOrPath
        .replace(/^attachment:/, '')
        .replace(/^attachment-local:/, '');

      // Tenta achar no IndexedDB por id ou storagePath
      attachment = (await indexedDbService.getAttachment(cleaned)) ||
                   (await indexedDbService.getAttachmentByStoragePath(cleaned));

      if (attachment) {
        storagePath = attachment.storagePath;
      } else {
        storagePath = cleaned;
      }
    }

    if (!storagePath) {
      return null;
    }

    // Se já temos o Blob no IndexedDB, usa ele diretamente
    if (attachment?.localBlob) {
      const objectUrl = URL.createObjectURL(attachment.localBlob);
      localBlobUrlCache.set(storagePath, objectUrl);
      if (attachment.id) {
        localBlobUrlCache.set(attachment.id, objectUrl);
      }
      return objectUrl;
    }

    // Verifica sessão / client
    const supabase = getSupabase();
    if (!supabase || !isSupabaseConfigured) {
      return null;
    }

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return null;
    }

    console.log('[ATTACHMENT DOWNLOAD START]', {
      attachmentId: attachment?.id || 'unknown',
      storagePath,
    });

    try {
      const { data: blob, error: dlError } = await supabase.storage
        .from('attachments')
        .download(storagePath);

      if (dlError || !blob) {
        console.error('[ATTACHMENT DOWNLOAD FAILED]', {
          storagePath,
          error: dlError?.message || 'Arquivo binário vazio',
        });
        return null;
      }

      console.log('[ATTACHMENT DOWNLOAD SUCCESS]', {
        storagePath,
        size: blob.size,
      });

      // Guarda Blob no IndexedDB
      if (attachment) {
        attachment.localBlob = blob;
        attachment.status = 'uploaded';
        attachment.updatedAt = new Date().toISOString();
        await indexedDbService.saveAttachment(attachment);
      } else {
        // Tenta buscar no IndexedDB novamente caso tenha sido criado enquanto baixava
        const existing = await indexedDbService.getAttachmentByStoragePath(storagePath);
        if (existing) {
          existing.localBlob = blob;
          existing.status = 'uploaded';
          existing.updatedAt = new Date().toISOString();
          await indexedDbService.saveAttachment(existing);
          attachment = existing;
        }
      }

      // Gera referência local
      const objectUrl = URL.createObjectURL(blob);
      localBlobUrlCache.set(storagePath, objectUrl);
      if (attachment?.id) {
        localBlobUrlCache.set(attachment.id, objectUrl);
      }
      if (attachment?.fileName) {
        localBlobUrlCache.set(attachment.fileName, objectUrl);
      }

      // Atualiza UI reativamente sem reescrever o documento
      if (attachment?.id) {
        notifyAttachmentUpdated(attachment.id, storagePath, objectUrl);
      }

      return objectUrl;
    } catch (err: any) {
      console.error('[ATTACHMENT DOWNLOAD FAILED]', {
        storagePath,
        error: err?.message || String(err),
      });
      return null;
    }
  },

  /**
   * Sincroniza e baixa todos os anexos de uma nota recebida (ex: criada no celular e aberta no computador).
   * 1. Consulta metadados remotos em public.attachments
   * 2. Salva registros ausentes no IndexedDB
   * 3. Para cada anexo sem Blob local: aciona downloadAttachment()
   */
  async syncAttachmentsForNote(noteId: string): Promise<void> {
    try {
      const localAttachments = await indexedDbService.getAttachments(noteId);

      // Baixa blobs locais pendentes de anexos já conhecidos
      for (const att of localAttachments) {
        if (!att.localBlob && att.storagePath) {
          this.downloadAttachment(att).catch(() => {});
        }
      }

      // Se online, verifica se o Supabase tem anexos criados em outros aparelhos
      const supabase = getSupabase();
      if (supabase && isSupabaseConfigured && typeof navigator !== 'undefined' && navigator.onLine) {
        const { data: remoteAtts, error } = await supabase
          .from('attachments')
          .select('*')
          .eq('note_id', noteId);

        if (!error && remoteAtts && remoteAtts.length > 0) {
          for (const row of remoteAtts) {
            let local = await indexedDbService.getAttachment(row.id);
            if (!local) {
              local = {
                id: row.id,
                userId: row.user_id,
                noteId: row.note_id,
                fileName: row.file_name,
                storagePath: row.storage_path,
                mimeType: row.mime_type,
                fileSize: row.file_size,
                localBlob: null,
                status: 'uploaded',
                createdAt: row.created_at,
                updatedAt: row.updated_at,
                url: `attachment:${row.storage_path}`,
              };
              await indexedDbService.saveAttachment(local);
            }

            if (!local.localBlob && local.storagePath) {
              this.downloadAttachment(local).catch(() => {});
            }
          }
        }
      }
    } catch (err) {
      console.warn('[AttachmentService] Erro ao sincronizar anexos da nota:', err);
    }
  },

  /**
   * Resolve uma referência de imagem (attachment:path ou URL remota) para uma URL válida.
   * Prioridade:
   * 1. Object URL em memória (se já criada nesta sessão)
   * 2. Blob local salvo no IndexedDB (Offline-First garantido!)
   * 3. Download autenticado do Supabase Storage -> cache no IndexedDB para persistência offline futura
   * 4. Signed URL temporária do Storage Provider
   * NUNCA retorna Base64 para armazenar no documento.
   */
  async resolveImageUrl(src: string): Promise<string> {
    if (!src) return '';
    if (src.startsWith('data:') || src.startsWith('blob:')) {
      return src;
    }

    let storagePath: string | null = null;
    let targetAttachmentId: string | null = null;

    if (src.startsWith('attachment:')) {
      const raw = src.replace(/^attachment:/, '');
      if (raw.includes('/')) {
        storagePath = raw;
      } else {
        targetAttachmentId = raw;
      }
    } else if (src.startsWith('attachment-local:')) {
      targetAttachmentId = src.replace(/^attachment-local:/, '');
    } else if (src.includes('/storage/v1/object/')) {
      const match = src.match(/\/attachments\/([^?#]+)/);
      if (match && match[1]) {
        storagePath = decodeURIComponent(match[1]);
      }
    }

    // 1. Verifica cache em memória por storagePath, ID ou src
    if (storagePath && localBlobUrlCache.has(storagePath)) {
      return localBlobUrlCache.get(storagePath)!;
    }
    if (targetAttachmentId && localBlobUrlCache.has(targetAttachmentId)) {
      return localBlobUrlCache.get(targetAttachmentId)!;
    }
    if (localBlobUrlCache.has(src)) {
      return localBlobUrlCache.get(src)!;
    }

    // 2. Busca no IndexedDB localmente
    try {
      let local: AttachmentRecord | null = null;
      if (targetAttachmentId) {
        local = await indexedDbService.getAttachment(targetAttachmentId);
      }
      if (!local && storagePath) {
        local = await indexedDbService.getAttachmentByStoragePath(storagePath);
      }
      if (!local && !storagePath && !targetAttachmentId && !src.startsWith('http')) {
        // Pode ser um nome de arquivo direto ex: IMG_6555.png
        const db = await (indexedDbService as any).getDB?.();
        if (db) {
          local = await new Promise<AttachmentRecord | null>((res) => {
            const tx = db.transaction('attachments', 'readonly');
            const req = tx.objectStore('attachments').openCursor();
            req.onsuccess = (e: any) => {
              const cursor = e.target.result;
              if (cursor) {
                if (cursor.value.fileName === src || cursor.value.storagePath?.endsWith(src)) {
                  res(cursor.value);
                  return;
                }
                cursor.continue();
              } else {
                res(null);
              }
            };
            req.onerror = () => res(null);
          });
        }
      }

      if (local) {
        if (local.storagePath) storagePath = local.storagePath;
        if (local.localBlob) {
          const objectUrl = URL.createObjectURL(local.localBlob);
          if (storagePath) localBlobUrlCache.set(storagePath, objectUrl);
          localBlobUrlCache.set(local.id, objectUrl);
          return objectUrl;
        } else if (local.storagePath) {
          // Registro existe mas o blob ainda não foi baixado do Storage
          const downloaded = await this.downloadAttachment(local);
          if (downloaded) return downloaded;
        }
      }
    } catch (err) {
      console.warn('[AttachmentService] Erro ao ler do IndexedDB:', err);
    }

    // Se for URL externa não-storage, retorna direto
    if (!storagePath && (src.startsWith('http://') || src.startsWith('https://'))) {
      return src;
    }

    // 3. Verifica cache em memória de URLs assinadas
    if (storagePath) {
      const cached = signedUrlCache.get(storagePath);
      if (cached && cached.expiresAt > Date.now()) {
        return cached.url;
      }
    }

    // 4. Se estiver online e ainda não tivermos o Blob, executa download do Storage
    if (storagePath && typeof navigator !== 'undefined' && navigator.onLine) {
      const downloaded = await this.downloadAttachment(storagePath);
      if (downloaded) return downloaded;

      // Fallback para Signed URL
      try {
        const { signedUrl, error: signedErr } = await currentProvider.createSignedUrl(storagePath, 7200);
        if (!signedErr && signedUrl) {
          signedUrlCache.set(storagePath, {
            url: signedUrl,
            expiresAt: Date.now() + 6600 * 1000,
          });
          return signedUrl;
        }
      } catch (signedErr) {
        console.warn('[AttachmentService] Erro ao gerar Signed URL:', signedErr);
      }
    }

    return src;
  },

  /**
   * Ferramenta de diagnóstico remoto solicitada na especificação (Requisito 41).
   * Inspeciona public.attachments e o bucket attachments no Supabase Storage.
   * Não expõe tokens nem segredos.
   */
  async debugRemoteAttachment(attachmentId: string): Promise<{
    attachmentId: string;
    inDatabase: boolean;
    databaseRecord: any;
    inStorage: boolean;
    storageInfo: any;
    error: string | null;
  }> {
    const supabase = getSupabase();
    const result = {
      attachmentId,
      inDatabase: false,
      databaseRecord: null as any,
      inStorage: false,
      storageInfo: null as any,
      error: null as string | null,
    };

    if (!supabase || !isSupabaseConfigured) {
      result.error = 'Supabase não configurado neste ambiente';
      console.warn('[DEBUG REMOTE ATTACHMENT]', result);
      return result;
    }

    try {
      // 1. Verifica public.attachments
      const { data: dbData, error: dbErr } = await supabase
        .from('attachments')
        .select('id, user_id, note_id, file_name, storage_path, mime_type, file_size, created_at, updated_at')
        .or(`id.eq.${attachmentId},storage_path.eq.${attachmentId}`)
        .maybeSingle();

      if (dbErr) {
        result.error = `Erro no banco: ${dbErr.message}`;
      } else if (dbData) {
        result.inDatabase = true;
        result.databaseRecord = dbData;
      }

      const storagePath = dbData?.storage_path || attachmentId;

      // 2. Verifica Supabase Storage (download test sem expor token)
      if (storagePath) {
        const { data: blob, error: stErr } = await supabase.storage
          .from('attachments')
          .download(storagePath);

        if (stErr) {
          result.storageInfo = { exists: false, error: stErr.message };
        } else if (blob) {
          result.inStorage = true;
          result.storageInfo = {
            exists: true,
            sizeBytes: blob.size,
            mimeType: blob.type,
          };
        }
      }

      console.log('[DEBUG REMOTE ATTACHMENT RESULT]', result);
      return result;
    } catch (e: any) {
      result.error = e?.message || String(e);
      console.error('[DEBUG REMOTE ATTACHMENT EXCEPTION]', result);
      return result;
    }
  },

  /**
   * Realiza criação/upload de anexo de forma 100% Offline-First.
   * Fluxo:
   * 1. Otimiza arquivo (se for imagem compatível).
   * 2. Cria path determinístico e URL de referência limpa: `attachment:<userId>/<noteId>/<attachmentId>-<fileName>`.
   * 3. Cria Object URL imediata em memória para o editor não travar a digitação.
   * 4. Salva o Blob/File físico no IndexedDB local com status 'pending' (NUNCA Base64).
   * 5. Enfileira operação na `sync_queue` para o SyncEngine processar em background (online ou na reconexão).
   * 6. Dispara o SyncEngine se a rede estiver disponível.
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
    // Estrutura determinística: <userId>/<noteId>/<attachmentId>-<fileName>
    const storagePath = `${userId}/${noteId}/${id}-${cleanFileName}`;
    const referenceUrl = `attachment:${storagePath}`;

    // Cria object URL temporária para visualização instantânea sem atraso
    if (typeof URL !== 'undefined' && URL.createObjectURL) {
      const objectUrl = URL.createObjectURL(file);
      localBlobUrlCache.set(storagePath, objectUrl);
      localBlobUrlCache.set(id, objectUrl);
    }

    // 2. Salva registro com o Blob nativo no IndexedDB
    const attachment: AttachmentRecord = {
      id,
      userId,
      noteId,
      fileName: file.name,
      storagePath,
      mimeType: file.type,
      fileSize: file.size,
      localBlob: file,
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      url: referenceUrl,
    };

    await indexedDbService.saveAttachment(attachment);

    console.log('[ATTACHMENT LOCAL SAVE]', {
      id,
      noteId,
      fileName: file.name,
      size: file.size,
      mimeType: file.type,
      status: 'pending',
    });

    // 3. Enfileira na sync_queue para envio quando online
    await indexedDbService.enqueueSyncItem({
      id: `sync_attachment_${id}`,
      userId,
      entityType: 'attachment',
      entityId: id,
      operation: 'upsert',
      payload: {
        attachmentId: id,
        noteId,
        storagePath,
        fileName: file.name,
        mimeType: file.type,
        fileSize: file.size,
      },
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      attempts: 0,
      nextAttemptAt: 0,
      status: 'pending',
    });

    console.log('[ATTACHMENT QUEUED]', {
      id,
      storagePath,
    });

    // 4. Se estiver online, dispara processamento da fila em background
    if (typeof navigator !== 'undefined' && navigator.onLine) {
      syncEngine.triggerQueueProcessing(50);
    }

    return attachment;
  },

  async deleteAttachment(id: string): Promise<void> {
    // 1. Remove upload pendente da fila de sincronização
    await indexedDbService.removeSyncItem(`sync_attachment_${id}`);

    const att = await indexedDbService.getAttachment(id);
    if (att && att.storagePath) {
      localBlobUrlCache.delete(att.storagePath);
      signedUrlCache.delete(att.storagePath);

      if (typeof navigator !== 'undefined' && navigator.onLine) {
        try {
          await currentProvider.delete(att.storagePath);
          const supabase = getSupabase();
          if (supabase && isSupabaseConfigured) {
            await supabase.from('attachments').delete().eq('id', id);
          }
        } catch (err) {
          console.warn('[AttachmentService] Falha ao deletar remoto imediatamente, enfileirando delete:', err);
          await indexedDbService.enqueueSyncItem({
            id: `sync_attachment_${id}`,
            userId: att.userId,
            entityType: 'attachment',
            entityId: id,
            operation: 'delete',
            payload: { storagePath: att.storagePath, id },
            version: 1,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            attempts: 0,
            nextAttemptAt: 0,
            status: 'pending',
          });
        }
      } else {
        // Se offline e o arquivo já tinha sido enviado antes para o remoto:
        if (att.status === 'uploaded') {
          await indexedDbService.enqueueSyncItem({
            id: `sync_attachment_${id}`,
            userId: att.userId,
            entityType: 'attachment',
            entityId: id,
            operation: 'delete',
            payload: { storagePath: att.storagePath, id },
            version: 1,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            attempts: 0,
            nextAttemptAt: 0,
            status: 'pending',
          });
        }
      }
    }

    localBlobUrlCache.delete(id);
    await indexedDbService.deleteAttachment(id);
  },

  /**
   * Exclui anexos vinculados a uma nota quando ela for excluída definitivamente.
   * Limpa fila de sync, storage e IndexedDB.
   */
  async deleteAttachmentsForNote(noteId: string): Promise<void> {
    const attachments = await indexedDbService.getAttachments(noteId);
    for (const att of attachments) {
      try {
        await this.deleteAttachment(att.id);
      } catch (err) {
        console.warn(`[AttachmentService] Erro ao limpar anexo ${att.id}:`, err);
      }
    }

    const supabase = getSupabase();
    if (supabase && isSupabaseConfigured && typeof navigator !== 'undefined' && navigator.onLine) {
      try {
        await supabase.from('attachments').delete().eq('note_id', noteId);
      } catch (err) {
        console.warn('[AttachmentService] Erro ao deletar anexos remotos da nota:', err);
      }
    }
  },

  /**
   * Limpa anexos órfãos que foram removidos do conteúdo da nota pelo usuário.
   */
  async cleanupUnusedAttachments(noteId: string, currentMarkdown: string, currentEditorJson: any): Promise<void> {
    try {
      const attachments = await indexedDbService.getAttachments(noteId);
      if (attachments.length === 0) return;

      const editorString = JSON.stringify(currentEditorJson || '');
      const markdownString = currentMarkdown || '';

      for (const att of attachments) {
        const isReferencedInMarkdown = markdownString.includes(att.storagePath) || (att.url && markdownString.includes(att.url));
        const isReferencedInJson = editorString.includes(att.storagePath) || (att.url && editorString.includes(att.url));

        if (!isReferencedInMarkdown && !isReferencedInJson) {
          console.log('[ATTACHMENT ORPHAN REMOVED]', { noteId, attachmentId: att.id, storagePath: att.storagePath });
          await this.deleteAttachment(att.id);
        }
      }
    } catch (err) {
      console.warn('[AttachmentService] Erro ao limpar anexos órfãos:', err);
    }
  },
};

// Exposição global para diagnóstico no console do navegador (Requisito 41)
if (typeof window !== 'undefined') {
  (window as any).debugRemoteAttachment = (id: string) => attachmentService.debugRemoteAttachment(id);
}

