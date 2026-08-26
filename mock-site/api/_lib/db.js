import { hashPassword } from './security.js';
import { sql } from './sql.js';

export { sql };

const INITIAL_WBS = [
  ['1. 수급가격통합시스템','1. 공통',10,7.3,7.3,'2026-08-19','2026-09-02','2026-08-19'],
  ['1. 수급가격통합시스템','2. 요구분석',15,8.2,8.1,'2026-08-26','2026-09-16','2026-08-19'],
  ['1. 수급가격통합시스템','3. 설계',20,17.2,16.2,'2026-09-09','2026-10-07','2026-08-19'],
  ['1. 수급가격통합시스템','4. 구현',35,30.5,31,'2026-09-30','2026-11-25','2026-08-19'],
  ['1. 수급가격통합시스템','5. 테스트',10,21.5,22,'2026-11-04','2026-12-16','2026-08-19'],
  ['1. 수급가격통합시스템','6. 이행',10,15.5,16,'2026-11-18','2026-12-23','2026-08-19'],
  ['2. AICC','1. 요구분석',20,10,10,'2026-09-02','2026-09-23','2026-08-19'],
  ['2. AICC','2. 설계',20,10,10,'2026-09-16','2026-10-14','2026-08-19'],
  ['2. AICC','3. 구현',40,20,20,'2026-10-07','2026-12-02','2026-08-19'],
  ['2. AICC','4. 테스트',10,5,5,'2026-11-11','2026-12-16','2026-08-19'],
  ['2. AICC','5. 이행',10,5,5,'2026-11-25','2026-12-23','2026-08-19'],
  ['3. 상황실','1. 요구정의분석',20,10,10,'2026-09-02','2026-09-23','2026-08-19'],
  ['3. 상황실','2. 상황판 설계 및 심의',20,10,10,'2026-09-16','2026-10-14','2026-08-19'],
  ['3. 상황실','3. 상황판 설치 및 시험',30,15,15,'2026-10-07','2026-11-25','2026-08-19'],
  ['3. 상황실','4. 시스템 장비설치',20,10,10,'2026-11-04','2026-12-09','2026-08-19'],
  ['3. 상황실','5. 오픈',10,5,5,'2026-12-02','2026-12-23','2026-08-19'],
  ['4. 사업관리','1. 사업관리 전반',100,20,20,'2026-08-19','2026-12-31','2026-08-19'],
];

let schemaPromise;

export function ensureSchema() {
  if (!schemaPromise) schemaPromise = initializeSchema().catch(error => { schemaPromise = null; throw error; });
  return schemaPromise;
}

async function initializeSchema() {
  let versionRows = [];
  try {
    versionRows = await sql`SELECT value FROM app_meta WHERE key='schema_version'`;
  } catch (error) {
    if (error?.code !== '42P01') throw error;
  }
  if (Number(versionRows[0]?.value || 0) >= 2) return;
  await sql`CREATE TABLE IF NOT EXISTS app_meta (key VARCHAR(100) PRIMARY KEY, value TEXT, updated_at TIMESTAMPTZ DEFAULT NOW())`;
  await sql`
    CREATE TABLE IF NOT EXISTS project_config (
      id INTEGER PRIMARY KEY, project_title VARCHAR(100), target_date DATE,
      start_date DATE, end_date DATE, logo_url TEXT, favicon_url TEXT
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(50) PRIMARY KEY, password TEXT NOT NULL, name VARCHAR(50) NOT NULL,
      affiliation VARCHAR(100), team_name VARCHAR(50), job_role VARCHAR(50), phone VARCHAR(30),
      email VARCHAR(100), start_date DATE, end_date DATE, screen_permissions TEXT,
      is_first_login BOOLEAN DEFAULT TRUE, is_admin BOOLEAN DEFAULT FALSE, failed_login_count INTEGER DEFAULT 0,
      locked_until TIMESTAMPTZ, updated_at TIMESTAMPTZ DEFAULT NOW()
    )`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_count INTEGER DEFAULT 0`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ`;
  await sql`
    CREATE TABLE IF NOT EXISTS common_codes (
      id BIGSERIAL PRIMARY KEY, category_code VARCHAR(50) NOT NULL, category_code_name VARCHAR(100),
      code_value VARCHAR(50) NOT NULL, code_name VARCHAR(100) NOT NULL, sort_order INTEGER DEFAULT 0,
      UNIQUE(category_code, code_value)
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS wbs_progress (
      system_name VARCHAR(100) NOT NULL, phase_name VARCHAR(100) NOT NULL,
      weight NUMERIC(7,2) DEFAULT 0, plan_rate NUMERIC(7,2), actual_rate NUMERIC(7,2),
      start_date DATE, end_date DATE, input_date DATE, delay_reason TEXT, recovery_plan TEXT,
      updated_at TIMESTAMPTZ DEFAULT NOW(), PRIMARY KEY(system_name, phase_name)
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS wbs_weekly (
      week_no INTEGER PRIMARY KEY, plan_rate NUMERIC(7,2), actual_rate NUMERIC(7,2), updated_at TIMESTAMPTZ DEFAULT NOW()
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS meetings (
      id BIGSERIAL PRIMARY KEY, title VARCHAR(150) NOT NULL, meeting_date DATE NOT NULL,
      meeting_time TIME NOT NULL, location VARCHAR(100), attendees VARCHAR(255), agenda TEXT,
      password TEXT NOT NULL, content TEXT, summary TEXT, others TEXT, created_by VARCHAR(50),
      created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS meeting_files (
      id BIGSERIAL PRIMARY KEY, meeting_id BIGINT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
      file_name VARCHAR(255) NOT NULL, blob_url TEXT NOT NULL, pathname TEXT, content_type VARCHAR(150),
      file_size BIGINT DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW()
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS wbs_imports (
      id BIGSERIAL PRIMARY KEY, file_name VARCHAR(255), wbs_rows INTEGER, weekly_rows INTEGER,
      imported_by VARCHAR(50), imported_at TIMESTAMPTZ DEFAULT NOW()
    )`;

  await sql`INSERT INTO project_config (id, project_title, target_date, start_date, end_date)
    VALUES (1, '석유통합관제센터 구축', '2026-11-01', '2026-08-01', '2026-12-31') ON CONFLICT (id) DO NOTHING`;

  const adminId = process.env.INITIAL_ADMIN_ID;
  const adminPassword = process.env.INITIAL_ADMIN_PASSWORD;
  if (adminId && adminPassword) {
    const passwordHash = hashPassword(adminPassword);
    await sql`INSERT INTO users (id, password, name, affiliation, team_name, job_role, email, screen_permissions, is_first_login, is_admin)
      VALUES (${adminId}, ${passwordHash}, '시스템관리자', '본사', '관리자', '시스템관리', ${process.env.INITIAL_ADMIN_EMAIL || ''}, 'all', TRUE, TRUE)
      ON CONFLICT (id) DO UPDATE SET is_admin=TRUE, screen_permissions='all'`;
  }

  const codeCount = await sql`SELECT COUNT(*)::int AS count FROM common_codes`;
  if (codeCount[0].count === 0) {
    await sql`INSERT INTO common_codes (category_code, category_code_name, code_value, code_name, sort_order) VALUES
      ('TEAM','팀명','DEV','개발팀',1),('TEAM','팀명','PMO','PMO팀',2),('TEAM','팀명','OPS','운영팀',3),
      ('TEAM','팀명','SUP','지원팀',4),('JOB','직무','DEV','개발담당',1),('JOB','직무','PM','사업관리',2) ON CONFLICT DO NOTHING`;
  }

  const wbsCount = await sql`SELECT COUNT(*)::int AS count FROM wbs_progress`;
  if (wbsCount[0].count === 0) {
    await sql.begin(async tx => {
      for (const row of INITIAL_WBS) {
        await tx`INSERT INTO wbs_progress (system_name, phase_name, weight, plan_rate, actual_rate, start_date, end_date, input_date)
          VALUES (${row[0]},${row[1]},${row[2]},${row[3]},${row[4]},${row[5]},${row[6]},${row[7]}) ON CONFLICT DO NOTHING`;
      }
    });
  }

  const weeklyCount = await sql`SELECT COUNT(*)::int AS count FROM wbs_weekly`;
  if (weeklyCount[0].count === 0) {
    await sql.begin(async tx => {
      for (let week = 1; week <= 22; week += 1) {
        await tx`INSERT INTO wbs_weekly (week_no, plan_rate, actual_rate) VALUES (${week}, ${Math.min(100, week * 5)}, ${null}) ON CONFLICT DO NOTHING`;
      }
    });
  }
  await sql`INSERT INTO app_meta(key,value,updated_at) VALUES('schema_version','2',NOW()) ON CONFLICT(key) DO UPDATE SET value='2',updated_at=NOW()`;
}

export function dateString(value) {
  if (!value) return '';
  if (typeof value === 'string') return value.slice(0, 10);
  return new Date(value).toISOString().slice(0, 10);
}

export async function getUserById(id) {
  if (!id) return null;
  const rows = await sql`SELECT * FROM users WHERE id=${id}`;
  return rows[0] || null;
}
