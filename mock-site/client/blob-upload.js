import { upload } from '@vercel/blob/client';

export async function uploadMeetingFile(file, meetingId, onProgress) {
  const safeName = file.name.replace(/[\\/]/g, '_');
  return upload(`meetings/${meetingId}/${safeName}`, file, {
    access: 'private',
    handleUploadUrl: '/api/blob-upload',
    clientPayload: JSON.stringify({ meetingId, fileName: file.name }),
    multipart: file.size > 5 * 1024 * 1024,
    onUploadProgress: onProgress,
  });
}
