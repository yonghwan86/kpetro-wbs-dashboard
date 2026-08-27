import { upload } from '@vercel/blob/client';
import ExcelJS from 'exceljs';

const baseUrl = process.env.SMOKE_BASE_URL || 'https://kpetrowbs.vercel.app';
const adminId = process.env.SMOKE_ADMIN_ID || 'admin';
const password = process.env.SMOKE_ADMIN_PASSWORD;
const skipPrivateBlob = process.env.SMOKE_SKIP_PRIVATE_BLOB === '1';
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
  body: JSON.stringify({ id: adminId, password }),
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
let workItemId;
try {
  for (const route of ['implementation', 'test-mgmt']) {
    const workTemplate = await fetch(`${baseUrl}/api/${route}/template`, { headers: { cookie } });
    if (!workTemplate.ok || !String(workTemplate.headers.get('content-type')).includes('spreadsheetml')) {
      throw new Error(`${route} template download failed: ${workTemplate.status}`);
    }
  }

  const smokeSuffix = Date.now();
  const smokeItemName = `배포 자동 점검 ${smokeSuffix}`;
  const workBook = new ExcelJS.Workbook();
  const workSheet = workBook.addWorksheet('구현관리계획');
  workSheet.addRow(['NO', '단위시스템', '개발자', '프로그램명', '계획 시작일', '계획 종료일']);
  workSheet.addRow([999999, '배포점검', adminId, smokeItemName, '2026-08-27', '2026-08-28']);
  const workBuffer = await workBook.xlsx.writeBuffer();
  const importWork = async mode => {
    const form = new FormData();
    form.append('file', new Blob([workBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'deployment-workflow-smoke.xlsx');
    form.append('mode', mode);
    return request('/api/implementation/import', { method: 'POST', body: form }, cookie);
  };
  const workPreview = await importWork('preview');
  if (!workPreview.response.ok || workPreview.data.row_count !== 1) throw new Error(`Work Excel preview failed: ${JSON.stringify(workPreview.data)}`);
  const workApplied = await importWork('apply');
  if (!workApplied.response.ok || workApplied.data.row_count !== 1) throw new Error(`Work Excel apply failed: ${JSON.stringify(workApplied.data)}`);

  let workList = await request('/api/implementation', {}, cookie);
  let workItem = workList.data.items?.find(item => item.item_name === smokeItemName);
  if (!workList.response.ok || !workItem) throw new Error(`Applied work item not found: ${JSON.stringify(workList.data)}`);
  workItemId = workItem.id;

  const schedule = await request(`/api/implementation/${workItemId}`, {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ actual_start_date: '2026-08-27', actual_end_date: '2026-08-28' }),
  }, cookie);
  if (!schedule.response.ok || !schedule.data.success) throw new Error(`Work actual schedule failed: ${JSON.stringify(schedule.data)}`);

  if (!skipPrivateBlob) {
    const pngBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
    await upload(`evidence/implementation/${workItemId}/deployment-smoke.png`, new Blob([pngBytes], { type: 'image/png' }), {
      access: 'private', handleUploadUrl: `${baseUrl}/api/blob-upload`,
      clientPayload: JSON.stringify({ kind: 'work-evidence', workType: 'implementation', itemId: workItemId, fileName: 'deployment-smoke.png' }),
      headers: { cookie },
    });
    for (let attempt = 0; attempt < 12; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      workList = await request('/api/implementation', {}, cookie);
      workItem = workList.data.items?.find(item => Number(item.id) === Number(workItemId));
      if (workItem?.has_evidence) break;
    }
    if (!workItem?.has_evidence) throw new Error('Work evidence Blob completion callback did not update the item');
  }

  const prematurePl = await request(`/api/implementation/${workItemId}/pl`, {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'approved' }),
  }, cookie);
  if (prematurePl.response.status !== 409) throw new Error(`PL was allowed before QA approval: ${prematurePl.response.status}`);
  const qa = await request(`/api/implementation/${workItemId}/qa`, {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'approved' }),
  }, cookie);
  if (!qa.response.ok || !qa.data.success) throw new Error(`QA approval failed: ${JSON.stringify(qa.data)}`);
  const pl = await request(`/api/implementation/${workItemId}/pl`, {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'approved' }),
  }, cookie);
  if (!pl.response.ok || !pl.data.success) throw new Error(`PL approval failed: ${JSON.stringify(pl.data)}`);
  if (!skipPrivateBlob) {
    const evidence = await fetch(`${baseUrl}/api/implementation/${workItemId}/evidence`, { headers: { cookie } });
    if (!evidence.ok || !String(evidence.headers.get('content-type')).startsWith('image/png') || (await evidence.arrayBuffer()).byteLength < 20) {
      throw new Error(`Private work evidence download failed: ${evidence.status}`);
    }
  }
  workList = await request('/api/implementation', {}, cookie);
  workItem = workList.data.items?.find(item => Number(item.id) === Number(workItemId));
  if (workItem?.qa_status !== 'approved' || workItem?.pl_status !== 'approved') throw new Error(`Approval state mismatch: ${JSON.stringify(workItem)}`);

  const created = await request('/api/meetings', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: '배포 자동 점검', meeting_date: '2026-08-26', meeting_time: '20:00', password: 'Smoke!1234', others: '검증 후 자동 삭제' }),
  }, cookie);
  if (!created.response.ok || !created.data.success) throw new Error(`Meeting create failed: ${JSON.stringify(created.data)}`);
  meetingId = created.data.id;

  if (!skipPrivateBlob) {
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
  }
  process.stdout.write(skipPrivateBlob
    ? 'API, DB, auth, Excel and work approvals: PASS (private Blob skipped)\n'
    : 'Production API, DB, auth, Excel, work approvals and private Blob: PASS\n');
} finally {
  if (workItemId) {
    await request(`/api/implementation/${workItemId}`, { method: 'DELETE' }, cookie);
  }
  if (meetingId) {
    await request(`/api/meetings/${meetingId}`, {
      method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'Smoke!1234' }),
    }, cookie);
  }
}
