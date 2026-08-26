const express = require('express');
const cors = require('cors');
const db = require('./db');

const app = express();
app.use(cors());
app.use(express.json());

// 데이터베이스 테이블 자동 생성 (최초 실행 시)
async function initDB() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS wbs_progress (
        system_name VARCHAR(50) NOT NULL,
        phase_name VARCHAR(50) NOT NULL,
        plan_rate DECIMAL(5,1),
        actual_rate DECIMAL(5,1),
        input_date DATE,
        PRIMARY KEY (system_name, phase_name)
      )
    `);
    console.log("MariaDB 테이블 확인 완료");
  } catch (err) {
    console.error("DB 초기화 에러:", err);
  }
}
initDB();

// 1. 모든 진척율 데이터 조회 API
app.get('/api/wbs', async (req, res) => {
  try {
    const rows = await db.query("SELECT * FROM wbs_progress");
    // 대시보드/입력창에서 쓰기 편하게 객체 형태로 변환
    const state = {};
    rows.forEach(row => {
      const key = `${row.system_name}_${row.phase_name}`;
      state[key] = {
        plan: row.plan_rate,
        actual: row.actual_rate,
        date: row.input_date ? row.input_date.toISOString().split('T')[0] : ''
      };
    });
    res.json(state);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. 진척율 데이터 전체 저장/수정 API (그리드 입력 반영)
app.post('/api/wbs', async (req, res) => {
  const data = req.body; // { '시스템_단계': { plan, actual, date }, ... }
  try {
    for (let key in data) {
      const [sys, phase] = key.split('_');
      const { plan, actual, date } = data[key];

      await db.query(`
        INSERT INTO wbs_progress (system_name, phase_name, plan_rate, actual_rate, input_date)
        VALUES (?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
        plan_rate = VALUES(plan_rate),
        actual_rate = VALUES(actual_rate),
        input_date = VALUES(input_date)
      `, [sys, phase, plan, actual, date]);
    }
    res.json({ success: true, message: 'MariaDB 저장 완료' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(3000, () => {
  console.log('서버가 3000번 포트에서 실행 중입니다.');
});
