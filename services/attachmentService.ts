import { AttachmentRecord } from '@/types';
import { indexedDbService } from './indexedDbService';
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase/client';

export const attachmentService = {
  async getAttachments(noteId: string): Promise<AttachmentRecord[]> {
    return indexedDbService.getAttachments(noteId);
  },

  async uploadAttachment(
    userId: string,
    noteId: string,
    file: File
  ): Promise<AttachmentRecord> {
    const id = 'att_' + crypto.randomUUID();
    const cleanFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storagePath = `${userId}/${noteId}/${Date.now()}_${cleanFileName}`;
    let fileUrl = '';

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
          const { data } = supabase.storage.from('attachments').getPublicUrl(storagePath);
          fileUrl = data.publicUrl;
        }
      } catch (err) {
        console.warn('Storage upload error, using local fallback:', err);
      }
    }

    // Fallback local caso Supabase Storage não esteja configurado ou falhe
    if (!fileUrl) {
      // Para imagens e arquivos em modo local/offline, lê como Data URL para persistir no IndexedDB e recarregar perfeitamente
      fileUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string || '');
        reader.onerror = () => resolve('');
        reader.readAsDataURL(file);
      });

      if (!fileUrl) {
        fileUrl = URL.createObjectURL(file);
      }
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
      url: fileUrl,
    };

    await indexedDbService.saveAttachment(attachment);
    return attachment;
  },

  async deleteAttachment(id: string): Promise<void> {
    await indexedDbService.deleteAttachment(id);
  },
};
