import { upload } from '@vercel/blob/client';

const baseUrl = process.env.SMOKE_BASE_URL || 'https://kpetrowbs.vercel.app';
const password = process.env.SMOKE_ADMIN_PASSWORD;
if (!password) throw new Error('SMOKE_ADMIN_PASSWORD is required');

const request = async (path, options = {}, cookie = '') => {
  const headers = { ...(options.headers || {}) };
  if (cookie) headers.cookie = cookie;
  const response = await fetch(`${baseUrl}${path}`, { ...options, headers });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { response, data };
};

const login = await request('/api/login', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ id: 'admin', password }),
});
if (!login.response.ok || !login.data.success) throw new Error(`Login failed: ${JSON.stringify(login.data)}`);
const cookie = login.response.headers.getSetCookie()[0].split(';')[0];

const templateResponse = await fetch(`${baseUrl}/api/wbs/template`, { headers: { cookie } });
if (!templateResponse.ok) throw new Error(`Excel template download failed: ${templateResponse.status}`);
const importBody = new FormData();
importBody.append('file', new Blob([await templateResponse.arrayBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'KPetro_WBS_import_template.xlsx');
importBody.append('mode', 'preview');
const preview = await request('/api/wbs/import', { method: 'POST', body: importBody }, cookie);
if (!preview.response.ok || preview.data.wbs_count !== 1 || preview.data.weekly_count !== 2) {
  throw new Error(`Excel preview failed: ${JSON.stringify(preview.data)}`);
}

let meetingId;
try {
  const created = await request('/api/meetings', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: '배포 자동 점검', meeting_date: '2026-08-26', meeting_time: '20:00', password: 'Smoke!1234', others: '검증 후 자동 삭제' }),
  }, cookie);
  if (!created.response.ok || !created.data.success) throw new Error(`Meeting create failed: ${JSON.stringify(created.data)}`);
  meetingId = created.data.id;

  const fileName = 'deployment-smoke-test.txt';
  await upload(`meetings/${meetingId}/${fileName}`, new Blob(['kpetro-wbs-smoke-test'], { type: 'text/plain' }), {
    access: 'private', handleUploadUrl: `${baseUrl}/api/blob-upload`,
    clientPayload: JSON.stringify({ meetingId, fileName }), headers: { cookie },
  });

  let uploadedFile;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    const meetings = await request('/api/meetings', {}, cookie);
    const storedMeeting = meetings.data.find(item => Number(item.id) === Number(meetingId));
    if (storedMeeting && 'password' in storedMeeting) throw new Error('Meeting password leaked from API');
    uploadedFile = storedMeeting?.files?.[0];
    if (uploadedFile) break;
  }
  if (!uploadedFile) throw new Error('Blob completion callback did not create the file record');

  const downloaded = await request(`/api/meeting-files/${uploadedFile.id}/download`, {}, cookie);
  if (!downloaded.response.ok || downloaded.data !== 'kpetro-wbs-smoke-test') {
    throw new Error(`Private blob download failed: ${downloaded.response.status} ${JSON.stringify(downloaded.data)}`);
  }
  process.stdout.write('Production API, DB, auth, Excel and private Blob: PASS\n');
} finally {
  if (meetingId) {
    await request(`/api/meetings/${meetingId}`, {
      method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'Smoke!1234' }),
    }, cookie);
  }
}
