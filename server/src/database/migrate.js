/**
 * Creates the database (if missing), applies schema.sql and seeds defaults.
 * Safe to run multiple times.   ->   npm run migrate
 */
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const env = require('../config/env');
const { ensureSchema } = require('./upgrade');

const DEFAULT_RULES = [
  // name, metric, warning, critical, duration_sec
  ['High CPU usage', 'cpu', 80, 95, 60],
  ['High memory usage', 'memory', 85, 95, 60],
  ['Disk space low', 'disk', 85, 95, 0],
  ['High swap / page file', 'swap', 70, 90, 120],
  ['High CPU temperature', 'temperature', 75, 90, 60],
  ['High network download (MB/s)', 'net_rx', 50, 100, 60],
  ['High network upload (MB/s)', 'net_tx', 50, 100, 60],
  ['Server offline (seconds without data)', 'offline', null, 60, 0],
  ['Unusual spike (z-score)', 'anomaly', 3, null, 0],
];

const DEFAULT_SETTINGS = {
  company_name: 'Shaltech Ceramics Limited',
  app_title: 'SCL Server Monitor',
  offline_after_sec: '30',
  raw_retention_days: '60',
  hourly_retention_days: '60',
  sms_enabled: '0',
  sms_method: 'GET',
  // Example for a typical BD bulk SMS gateway. Placeholders: {api_key} {to} {message} {sender_id}
  sms_api_url: 'https://api.example-sms.com/send?api_key={api_key}&senderid={sender_id}&number={to}&message={message}',
  sms_api_key: '',
  sms_sender_id: '',
  sms_post_body: '{"api_key":"{api_key}","to":"{to}","msg":"{message}"}',
  sms_recipients: '',
  sms_min_severity: 'critical',
  sms_cooldown_min: '15',
  sms_on_recovery: '1',
  sound_enabled: '1',
};

async function run() {
  const { database, ...conn } = env.db;
  const admin = await mysql.createConnection({ ...conn, multipleStatements: true });
  await admin.query(
    `CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  await admin.query(`USE \`${database}\``);
  console.log(`✔ database "${database}" ready`);

  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await admin.query(schema);
  console.log('✔ tables created / verified');

  // Admin user
  const [users] = await admin.query('SELECT id FROM users WHERE username = ?', [env.adminUsername]);
  if (!users.length) {
    const hash = await bcrypt.hash(env.adminPassword, 10);
    await admin.query(
      'INSERT INTO users (name, username, password_hash, role) VALUES (?, ?, ?, ?)',
      ['Administrator', env.adminUsername, hash, 'admin']
    );
    console.log(`✔ admin user created  ->  ${env.adminUsername} / ${env.adminPassword}`);
  }

  // Default rules (only when table is empty)
  const [[{ c }]] = await admin.query('SELECT COUNT(*) AS c FROM alert_rules');
  if (!c) {
    await admin.query(
      'INSERT INTO alert_rules (name, metric, warning_threshold, critical_threshold, duration_sec) VALUES ?',
      [DEFAULT_RULES]
    );
    console.log('✔ default alert rules inserted');
  }

  // Default settings (never overwrite existing values)
  const rows = Object.entries(DEFAULT_SETTINGS);
  await admin.query('INSERT IGNORE INTO settings (`key`, `value`) VALUES ?', [rows]);
  console.log('✔ default settings ensured');

  await ensureSchema(async (sql, params) => (await admin.query(sql, params))[0]);
  console.log('✔ login monitoring tables / rules ensured');

  await admin.end();
  console.log('Migration complete.');
}

run().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
