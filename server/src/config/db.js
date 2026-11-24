const mysql = require('mysql2/promise');
const env = require('./env');

/**
 * Single shared connection pool. All timestamps are stored in UTC:
 *  - `timezone: 'Z'` makes mysql2 serialise/parse JS Dates as UTC
 *  - each new connection sets the session time_zone to UTC so NOW()/UNIX_TIMESTAMP agree
 */
const pool = mysql.createPool({
  ...env.db,
  waitForConnections: true,
  connectionLimit: 20,
  queueLimit: 0,
  timezone: 'Z',
  decimalNumbers: true,
  supportBigNumbers: true,
  bigNumberStrings: false,
  charset: 'utf8mb4',
});

pool.pool.on('connection', (conn) => {
  conn.query("SET time_zone = '+00:00'");
});

/** Run a raw SQL statement with `?` placeholders and return rows / result header. */
async function query(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

/** Return first row or null. */
async function queryOne(sql, params = []) {
  const rows = await query(sql, params);
  return rows[0] || null;
}

/** Run several statements inside a transaction. `fn` receives a connection. */
async function transaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { pool, query, queryOne, transaction };
