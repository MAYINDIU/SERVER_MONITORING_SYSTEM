const { query, queryOne } = require('../config/db');
const { parseJson } = require('../utils/http');

const LIST_SQL = `
  SELECT s.id, s.server_code, s.name, s.hostname, s.ip_address, s.mac_address,
         s.os_name, s.os_version, s.platform, s.arch, s.cpu_model, s.cpu_cores, s.cpu_threads,
         s.mem_total, s.manufacturer, s.model, s.serial, s.group_name, s.location, s.environment,
         s.owner, s.notes, s.agent_version, s.is_enabled, s.status, s.disks_json, s.nics_json,
         s.boot_time, s.last_seen_at, s.inventory_at, s.created_at,
         s.sessions_json, s.sessions_at, s.login_log_status,
         COALESCE(a.critical_count, 0) AS critical_count,
         COALESCE(a.warning_count, 0)  AS warning_count,
         COALESCE(a.info_count, 0)     AS info_count
    FROM servers s
    LEFT JOIN (
      SELECT server_id,
             SUM(severity = 'critical') AS critical_count,
             SUM(severity = 'warning')  AS warning_count,
             SUM(severity = 'info')     AS info_count
        FROM alerts
       WHERE status IN ('open','acknowledged')
       GROUP BY server_id
    ) a ON a.server_id = s.id`;

const hydrate = (row) =>
  row && {
    ...row,
    disks: parseJson(row.disks_json, []),
    nics: parseJson(row.nics_json, []),
    sessions: parseJson(row.sessions_json, []),
    sessions_json: undefined,
    disks_json: undefined,
    nics_json: undefined,
  };

const ServerModel = {
  async list() {
    const rows = await query(`${LIST_SQL} ORDER BY s.group_name, s.name`);
    return rows.map(hydrate);
  },

  async findById(id) {
    return hydrate(await queryOne(`${LIST_SQL} WHERE s.id = ?`, [id]));
  },

  findByTokenHash(hash) {
    return queryOne(
      'SELECT id, server_code, name, ip_address, is_enabled, status FROM servers WHERE agent_token_hash = ? LIMIT 1',
      [hash]
    );
  },

  findByIp(ip) {
    return queryOne('SELECT * FROM servers WHERE ip_address = ? LIMIT 1', [ip]);
  },

  async create({ ip, hostname, tokenHash }) {
    const tmpCode = `TMP-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const r = await query(
      'INSERT INTO servers (server_code, name, hostname, ip_address, agent_token_hash) VALUES (?, ?, ?, ?, ?)',
      [tmpCode, hostname || ip, hostname || null, ip, tokenHash]
    );
    await query("UPDATE servers SET server_code = CONCAT('SRV-', LPAD(id, 4, '0')) WHERE id = ?", [r.insertId]);
    return r.insertId;
  },

  setToken(id, tokenHash) {
    return query('UPDATE servers SET agent_token_hash = ? WHERE id = ?', [tokenHash, id]);
  },

  /** Hardware / OS inventory sent by the agent on start-up and once a day. */
  updateInventory(id, inv) {
    return query(
      `UPDATE servers SET
          hostname = COALESCE(?, hostname), mac_address = COALESCE(?, mac_address),
          os_name = ?, os_version = ?, platform = ?, arch = ?,
          cpu_model = ?, cpu_cores = ?, cpu_threads = ?, mem_total = ?,
          manufacturer = ?, model = ?, serial = ?, agent_version = ?,
          boot_time = ?, nics_json = ?, inventory_at = UTC_TIMESTAMP()
        WHERE id = ?`,
      [
        inv.hostname || null, inv.mac || null,
        inv.os_name || null, inv.os_version || null, inv.platform || null, inv.arch || null,
        inv.cpu_model || null, inv.cpu_cores || null, inv.cpu_threads || null, inv.mem_total || null,
        inv.manufacturer || null, inv.model || null, inv.serial || null, inv.agent_version || null,
        inv.boot_time ? new Date(inv.boot_time) : null,
        inv.nics ? JSON.stringify(inv.nics) : null,
        id,
      ]
    );
  },

  /** Called on every metrics push: marks online + stores latest disk snapshot. */
  touchSeen(id, seenAt, disks) {
    return query(
      `UPDATE servers SET last_seen_at = ?, status = 'online',
              disks_json = COALESCE(?, disks_json)
        WHERE id = ?`,
      [seenAt, disks ? JSON.stringify(disks) : null, id]
    );
  },

  updateMeta(id, { name, group_name, location, environment, owner, notes, is_enabled }) {
    return query(
      `UPDATE servers SET name = COALESCE(?, name), group_name = COALESCE(?, group_name),
              location = ?, environment = COALESCE(?, environment), owner = ?, notes = ?,
              is_enabled = COALESCE(?, is_enabled)
        WHERE id = ?`,
      [
        name || null, group_name || null, location || null, environment || null,
        owner || null, notes || null, is_enabled ?? null, id,
      ]
    );
  },

  /** Servers that stopped reporting – flips them to offline and returns them. */
  async markStaleOffline(cutoff) {
    const rows = await query(
      `SELECT id, name, ip_address, last_seen_at FROM servers
        WHERE status = 'online' AND (last_seen_at IS NULL OR last_seen_at < ?)`,
      [cutoff]
    );
    if (rows.length) {
      await query("UPDATE servers SET status = 'offline' WHERE id IN (?)", [rows.map((r) => r.id)]);
    }
    return rows;
  },

  enabledForOfflineCheck() {
    return query(
      `SELECT id, name, ip_address, last_seen_at FROM servers
        WHERE is_enabled = 1 AND last_seen_at IS NOT NULL`
    );
  },

  groups() {
    return query('SELECT group_name, COUNT(*) AS total FROM servers GROUP BY group_name ORDER BY group_name');
  },

  remove(id) {
    return query('DELETE FROM servers WHERE id = ?', [id]);
  },
};

module.exports = ServerModel;
