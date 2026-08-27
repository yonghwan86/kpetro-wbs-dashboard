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

export async function uploadWorkEvidence(file, workType, itemId, onProgress) {
  if (!['implementation', 'test'].includes(workType)) throw new Error('업무 구분이 올바르지 않습니다.');
  const safeName = file.name.replace(/[\\/]/g, '_');
  return upload(`evidence/${workType}/${itemId}/${safeName}`, file, {
    access: 'private',
    handleUploadUrl: '/api/blob-upload',
    clientPayload: JSON.stringify({ kind: 'work-evidence', workType, itemId, fileName: file.name }),
    multipart: file.size > 5 * 1024 * 1024,
    onUploadProgress: onProgress,
  });
}
