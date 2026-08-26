const mariadb = require('mariadb');

const pool = mariadb.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3303),
  user: process.env.DB_USER || 'wbs_user',
  password: process.env.DB_PASSWORD || 'change-this-password',
  database: process.env.DB_NAME || 'wbs_db',
  connectionLimit: 5
});

async function query(sql, params) {
  let conn;
  try {
    conn = await pool.getConnection();
    return await conn.query(sql, params);
  } finally {
    if (conn) conn.release();
  }
}

module.exports = { query };
