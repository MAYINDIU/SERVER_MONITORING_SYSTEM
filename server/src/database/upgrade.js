/**
 * Idempotent schema upgrades for features added after the first release.
 * Runs automatically on API start-up (and from `npm run migrate`), so existing
 * installations pick up new tables / columns without manual SQL.
 *
 *  v1.1 – login / remote-access monitoring
 */

const LOGIN_EVENTS_SQL = `
CREATE TABLE IF NOT EXISTS login_events (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  server_id    INT UNSIGNED NOT NULL,
  uid          VARCHAR(64)  NOT NULL,
  event_time   DATETIME(3)  NOT NULL,
  kind         ENUM('logon','failed','connection') NOT NULL,
  method       VARCHAR(20)  NOT NULL,
  username     VARCHAR(150) NULL,
  domain       VARCHAR(150) NULL,
  source_ip    VARCHAR(45)  NULL,
  source_host  VARCHAR(150) NULL,
  details      VARCHAR(255) NULL,
  alerted      TINYINT(1)   NOT NULL DEFAULT 0,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_login_uid (server_id, uid),
  KEY idx_login_time (event_time),
  KEY idx_login_server_time (server_id, event_time),
  KEY idx_login_ip (source_ip),
  CONSTRAINT fk_login_server FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;

const SERVER_COLUMNS = {
  sessions_json: 'LONGTEXT NULL',
  sessions_at: 'DATETIME NULL',
  login_log_status: 'VARCHAR(20) NULL',
};

const RULE_METRICS = ['cpu', 'memory', 'disk', 'swap', 'temperature', 'net_rx', 'net_tx', 'offline', 'anomaly', 'login', 'login_failed'];

const LOGIN_RULES = [
  // name, metric, warning, critical, duration_sec (login_failed: counting window)
  ['Login / remote access detected', 'login', null, null, 0],
  ['Failed logins (password guessing)', 'login_failed', 5, 20, 300],
];

const LOGIN_SETTINGS = {
  login_trusted_ips: '',
  login_ignore_users: '',
  login_alert_local: '1',
  login_alert_network: '0',
};

/** `run(sql, params)` must return rows (mysql2 pool.query()[0] or similar). */
async function ensureSchema(run) {
  await run(LOGIN_EVENTS_SQL);

  const cols = await run(
    `SELECT column_name AS name FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'servers'`
  );
  const have = new Set(cols.map((c) => String(c.name || c.COLUMN_NAME).toLowerCase()));
  for (const [name, def] of Object.entries(SERVER_COLUMNS)) {
    if (!have.has(name)) await run(`ALTER TABLE servers ADD COLUMN ${name} ${def}`);
  }

  const [metricCol] = await run(
    `SELECT column_type AS t FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'alert_rules' AND column_name = 'metric'`
  );
  if (metricCol && !String(metricCol.t || metricCol.COLUMN_TYPE).includes("'login_failed'")) {
    await run(`ALTER TABLE alert_rules MODIFY metric ENUM(${RULE_METRICS.map((m) => `'${m}'`).join(',')}) NOT NULL`);
  }

  for (const [name, metric, w, c, d] of LOGIN_RULES) {
    const [exists] = await run('SELECT id FROM alert_rules WHERE metric = ? LIMIT 1', [metric]);
    if (!exists) {
      await run(
        'INSERT INTO alert_rules (name, metric, warning_threshold, critical_threshold, duration_sec) VALUES (?, ?, ?, ?, ?)',
        [name, metric, w, c, d]
      );
    }
  }

  await run('INSERT IGNORE INTO settings (`key`, `value`) VALUES ?', [Object.entries(LOGIN_SETTINGS)]);
}

module.exports = { ensureSchema, RULE_METRICS };
