import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { makeWbsTemplate, makeWorkTemplate, parseWbsWorkbook, parseWorkWorkbook } from '../api/_lib/excel.js';
import { projectWeekCount } from '../api/_lib/dates.js';
import { createSessionToken, hasPermission, hashPassword, normalizePermissions, verifyPassword, verifySessionToken } from '../api/_lib/security.js';

test('password hashing and signed session token', () => {
  process.env.SESSION_SECRET = 'test-session-secret-that-is-longer-than-thirty-two-characters';
  const hash = hashPassword('Example!1234');
  assert.equal(verifyPassword(hash, 'Example!1234'), true);
  assert.equal(verifyPassword(hash, 'wrong-password'), false);
  const token = createSessionToken({ id: 'tester' });
  assert.equal(verifySessionToken(token).sub, 'tester');
  assert.equal(verifySessionToken(`${token}broken`), null);
});

test('generated WBS workbook can be parsed', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'kpetro-wbs-'));
  const filePath = path.join(directory, 'template.xlsx');
  try {
    await fs.writeFile(filePath, await makeWbsTemplate());
    const parsed = await parseWbsWorkbook(filePath);
    assert.equal(parsed.wbs.length, 1);
    assert.equal(parsed.weekly.length, 2);
    assert.equal(parsed.wbs[0].system_name, '1. 수급가격통합시스템');
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('project weeks include both start and end dates', () => {
  assert.equal(projectWeekCount('2026-08-01', '2026-12-21'), 21);
  assert.equal(projectWeekCount('2026-08-01', '2026-12-31'), 22);
  assert.equal(projectWeekCount('2026-08-01', '2026-08-07'), 1);
  assert.equal(projectWeekCount('2026-08-01', '2026-08-08'), 2);
});

test('implementation and test workbooks preserve plan rows', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'kpetro-work-'));
  try {
    for (const workType of ['implementation', 'test']) {
      const filePath = path.join(directory, `${workType}.xlsx`);
      await fs.writeFile(filePath, await makeWorkTemplate(workType, [{
        row_no: 1, unit_system: '수급가격통합시스템', assignee: '담당자1', item_name: workType === 'implementation' ? '가격수집배치' : '로그인 통합 시나리오',
        plan_start_date: '2026-09-01', plan_end_date: '2026-09-10',
      }]));
      const parsed = await parseWorkWorkbook(filePath, workType);
      assert.equal(parsed.length, 1);
      assert.equal(parsed[0].assignee, '담당자1');
      assert.equal(parsed[0].plan_end_date, '2026-09-10');
    }
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('new workflow permissions are normalized and enforced', () => {
  const permissions = normalizePermissions(JSON.stringify({ 구현관리: 'Y', 테스트관리: 'Y', 임의권한: 'Y' }));
  assert.deepEqual(JSON.parse(permissions), { 구현관리: 'Y', 테스트관리: 'Y' });
  const user = { is_admin: false, screen_permissions: permissions };
  assert.equal(hasPermission(user, 'implementation'), true);
  assert.equal(hasPermission(user, 'test'), true);
  assert.equal(hasPermission(user, 'project'), false);
});
