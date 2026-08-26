import crypto from 'node:crypto';

const COOKIE_NAME = 'kpetro_session';
const SESSION_SECONDS = 8 * 60 * 60;

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function signPart(value) {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters');
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

export function createSessionToken(user) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({ sub: user.id, iat: now, exp: now + SESSION_SECONDS }));
  const unsigned = `${header}.${payload}`;
  return `${unsigned}.${signPart(unsigned)}`;
}

export function verifySessionToken(token) {
  try {
    const [header, payload, signature] = String(token || '').split('.');
    if (!header || !payload || !signature) return null;
    const unsigned = `${header}.${payload}`;
    const expected = signPart(unsigned);
    const left = Buffer.from(signature);
    const right = Buffer.from(expected);
    if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) return null;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data.sub || Number(data.exp) <= Math.floor(Date.now() / 1000)) return null;
    return data;
  } catch {
    return null;
  }
}

export function readCookies(req) {
  const result = {};
  String(req.headers.cookie || '').split(';').forEach(part => {
    const index = part.indexOf('=');
    if (index < 0) return;
    result[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  });
  return result;
}

export function getSessionSubject(req) {
  return verifySessionToken(readCookies(req)[COOKIE_NAME])?.sub || null;
}

export function setSessionCookie(res, user) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${createSessionToken(user)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_SECONDS}${secure}`);
}

export function clearSessionCookie(res) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
}

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(String(password), salt, 64);
  return `scrypt$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

export function verifyPassword(stored, submitted) {
  try {
    const [method, saltValue, hashValue] = String(stored || '').split('$');
    if (method !== 'scrypt' || !saltValue || !hashValue) return false;
    const expected = Buffer.from(hashValue, 'base64url');
    const actual = crypto.scryptSync(String(submitted || ''), Buffer.from(saltValue, 'base64url'), expected.length);
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function randomPassword() {
  return `${crypto.randomBytes(7).toString('base64url')}!7a`;
}

export function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function normalizePermissions(raw) {
  if (raw === 'all') return 'all';
  let parsed = raw;
  if (typeof raw === 'string') {
    try { parsed = JSON.parse(raw || '{}'); } catch { parsed = {}; }
  }
  const allowed = new Set(['대시보드', '단계별진척', '주차별진척', '회의관리', '프로젝트관리', '회원관리', '코드관리']);
  const normalized = {};
  Object.entries(parsed || {}).forEach(([key, value]) => {
    if (allowed.has(key) && value === 'Y') normalized[key] = 'Y';
  });
  return JSON.stringify(normalized);
}

export function parsePermissions(raw) {
  if (raw === 'all') return { all: 'Y' };
  try { return typeof raw === 'string' ? JSON.parse(raw || '{}') : (raw || {}); } catch { return {}; }
}

const PERMISSIONS = {
  dashboard: '대시보드', input: '단계별진척', weekly: '주차별진척', meetings: '회의관리',
  project: '프로젝트관리', users: '회원관리', codes: '코드관리',
};

export function hasPermission(user, key) {
  if (!user) return false;
  if (user.is_admin) return true;
  const permissions = parsePermissions(user.screen_permissions);
  return permissions.all === 'Y' || permissions[PERMISSIONS[key]] === 'Y';
}
