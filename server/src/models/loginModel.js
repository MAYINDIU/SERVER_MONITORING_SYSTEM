const { query, queryOne } = require('../config/db');

const SELECT = `
  SELECT l.*, s.name AS server_name, s.ip_address, s.server_code
    FROM login_events l
    JOIN servers s ON s.id = l.server_id`;

const LoginModel = {
  /** Insert one event; returns the new id, or 0 if this uid was already stored (re-sent by the agent). */
  async insert(serverId, e) {
    const r = await query(
      `INSERT IGNORE INTO login_events
         (server_id, uid, event_time, kind, method, username, domain, source_ip, source_host, details)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [serverId, e.uid, e.ts, e.kind, e.method, e.user, e.domain, e.source_ip, e.source_host, e.details]
    );
    return r.affectedRows ? r.insertId : 0;
  },

  markAlerted(id) {
    return query('UPDATE login_events SET alerted = 1 WHERE id = ?', [id]);
  },

  findById(id) {
    return queryOne(`${SELECT} WHERE l.id = ?`, [id]);
  },

  updateSessions(serverId, sessions, logStatus) {
    return query(
      'UPDATE servers SET sessions_json = ?, sessions_at = UTC_TIMESTAMP(), login_log_status = ? WHERE id = ?',
      [JSON.stringify(sessions), logStatus, serverId]
    );
  },

  async list({ serverId, kind, method, ip, q, from, to, page = 1, limit = 50 }) {
    const where = [];
    const params = [];
    if (serverId) {
      where.push('l.server_id = ?');
      params.push(serverId);
    }
    if (kind) {
      where.push('l.kind = ?');
      params.push(kind);
    }
    if (method === 'remote') where.push("l.method IN ('rdp','ssh','anydesk','teamviewer','vnc','winrm')");
    else if (method) {
      where.push('l.method = ?');
      params.push(method);
    }
    if (ip) {
      where.push('l.source_ip = ?');
      params.push(ip);
    }
    if (from) {
      where.push('l.event_time >= ?');
      params.push(new Date(from));
    }
    if (to) {
      where.push('l.event_time < ?');
      params.push(new Date(to));
    }
    if (q) {
      where.push('(l.username LIKE ? OR l.source_ip LIKE ? OR l.source_host LIKE ? OR s.name LIKE ? OR l.details LIKE ?)');
      params.push(...Array(5).fill(`%${q}%`));
    }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const lim = Math.min(Number(limit) || 50, 500);
    const off = (Math.max(Number(page) || 1, 1) - 1) * lim;
    const [rows, total] = await Promise.all([
      query(`${SELECT} ${w} ORDER BY l.event_time DESC, l.id DESC LIMIT ? OFFSET ?`, [...params, lim, off]),
      queryOne(`SELECT COUNT(*) AS c FROM login_events l JOIN servers s ON s.id = l.server_id ${w}`, params),
    ]);
    return { rows, total: total.c, page: Number(page) || 1, limit: lim };
  },

  async summary(serverId) {
    const w = serverId ? 'AND server_id = ?' : '';
    const p = serverId ? [serverId] : [];
    const [counts, topIps] = await Promise.all([
      queryOne(
        `SELECT SUM(kind = 'logon') AS logons,
                SUM(kind = 'failed') AS failed,
                SUM(kind IN ('logon','connection') AND method IN ('rdp','ssh','anydesk','teamviewer','vnc','winrm')) AS remote,
                COUNT(DISTINCT source_ip) AS unique_ips
           FROM login_events
          WHERE event_time >= UTC_TIMESTAMP() - INTERVAL 1 DAY ${w}`,
        p
      ),
      query(
        `SELECT source_ip, COUNT(*) AS total, SUM(kind = 'failed') AS failed,
                COUNT(DISTINCT server_id) AS servers, MAX(event_time) AS last_at,
                SUBSTRING_INDEX(GROUP_CONCAT(DISTINCT source_host ORDER BY event_time DESC), ',', 1) AS host
           FROM login_events
          WHERE source_ip IS NOT NULL AND event_time >= UTC_TIMESTAMP() - INTERVAL 7 DAY ${w}
          GROUP BY source_ip ORDER BY total DESC LIMIT 15`,
        p
      ),
    ]);
    return { ...counts, top_ips: topIps };
  },

  async purge(before, chunk = 5000) {
    let total = 0;
    for (;;) {
      const r = await query('DELETE FROM login_events WHERE event_time < ? LIMIT ?', [before, chunk]);
      total += r.affectedRows;
      if (r.affectedRows < chunk) return total;
    }
  },
};

module.exports = LoginModel;
