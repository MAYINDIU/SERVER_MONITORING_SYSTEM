const { query, queryOne } = require('../config/db');

const SELECT = `
  SELECT a.*, s.name AS server_name, s.ip_address, s.server_code,
         ua.name AS acknowledged_by_name, ur.name AS resolved_by_name
    FROM alerts a
    JOIN servers s ON s.id = a.server_id
    LEFT JOIN users ua ON ua.id = a.acknowledged_by
    LEFT JOIN users ur ON ur.id = a.resolved_by`;

const AlertModel = {
  /** All alerts not yet resolved (used to restore engine state on boot). */
  active() {
    return query(`SELECT * FROM alerts WHERE status IN ('open','acknowledged')`);
  },

  findById(id) {
    return queryOne(`${SELECT} WHERE a.id = ?`, [id]);
  },

  async create(a) {
    const r = await query(
      `INSERT INTO alerts (fingerprint, server_id, rule_id, metric, severity, status, current_value,
                           peak_value, threshold_value, message, first_detected_at, last_detected_at)
       VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?)`,
      [
        a.fingerprint, a.server_id, a.rule_id || null, a.metric, a.severity, a.value, a.value,
        a.threshold, a.message.slice(0, 500), a.at, a.at,
      ]
    );
    return r.insertId;
  },

  /** Still breaching: refresh value / peak / last seen (and optionally escalate). */
  touch(id, { value, severity, threshold, message, at }) {
    return query(
      `UPDATE alerts SET current_value = ?, peak_value = GREATEST(COALESCE(peak_value, ?), ?),
              last_detected_at = ?, severity = COALESCE(?, severity),
              threshold_value = COALESCE(?, threshold_value), message = COALESCE(?, message)
        WHERE id = ?`,
      [value, value, value, at, severity || null, threshold ?? null, message ? message.slice(0, 500) : null, id]
    );
  },

  resolve(id, { userId = null, note = null, at = new Date() } = {}) {
    return query(
      `UPDATE alerts SET status = 'resolved', resolved_at = ?, resolved_by = ?, resolution_note = ?
        WHERE id = ? AND status <> 'resolved'`,
      [at, userId, note, id]
    );
  },

  acknowledge(id, userId) {
    return query(
      `UPDATE alerts SET status = 'acknowledged', acknowledged_by = ?, acknowledged_at = UTC_TIMESTAMP()
        WHERE id = ? AND status = 'open'`,
      [userId, id]
    );
  },

  /** Paged + filtered list. */
  async list({ status, severity, serverId, metric, from, to, q, page = 1, limit = 50 }) {
    const where = [];
    const params = [];
    if (status === 'active') where.push("a.status IN ('open','acknowledged')");
    else if (status) {
      where.push('a.status = ?');
      params.push(status);
    }
    if (severity) {
      where.push('a.severity = ?');
      params.push(severity);
    }
    if (serverId) {
      where.push('a.server_id = ?');
      params.push(serverId);
    }
    if (metric) {
      where.push('a.metric = ?');
      params.push(metric);
    }
    if (from) {
      where.push('a.first_detected_at >= ?');
      params.push(new Date(from));
    }
    if (to) {
      where.push('a.first_detected_at < ?');
      params.push(new Date(to));
    }
    if (q) {
      where.push('(a.message LIKE ? OR s.name LIKE ? OR s.ip_address LIKE ?)');
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const lim = Math.min(Number(limit) || 50, 500);
    const off = (Math.max(Number(page) || 1, 1) - 1) * lim;

    const [rows, total] = await Promise.all([
      query(
        `${SELECT} ${w}
          ORDER BY (a.status = 'resolved'), FIELD(a.severity,'critical','warning','info'), a.first_detected_at DESC
          LIMIT ? OFFSET ?`,
        [...params, lim, off]
      ),
      queryOne(`SELECT COUNT(*) AS c FROM alerts a JOIN servers s ON s.id = a.server_id ${w}`, params),
    ]);
    return { rows, total: total.c, page: Number(page) || 1, limit: lim };
  },

  summary() {
    return queryOne(
      `SELECT SUM(status IN ('open','acknowledged')) AS active,
              SUM(status = 'open') AS unacknowledged,
              SUM(status IN ('open','acknowledged') AND severity = 'critical') AS critical,
              SUM(status IN ('open','acknowledged') AND severity = 'warning') AS warning,
              SUM(status IN ('open','acknowledged') AND severity = 'info') AS info,
              SUM(first_detected_at >= UTC_TIMESTAMP() - INTERVAL 1 DAY) AS last_24h
         FROM alerts`
    );
  },

  recent(limit = 10) {
    return query(`${SELECT} ORDER BY a.first_detected_at DESC LIMIT ?`, [limit]);
  },

  /* ---------- incident timeline ---------- */
  addEvent(alertId, type, message = null, userId = null) {
    return query('INSERT INTO alert_events (alert_id, event_type, message, user_id) VALUES (?, ?, ?, ?)', [
      alertId, type, message ? String(message).slice(0, 500) : null, userId,
    ]);
  },

  events(alertId) {
    return query(
      `SELECT e.*, u.name AS user_name FROM alert_events e
         LEFT JOIN users u ON u.id = e.user_id
        WHERE e.alert_id = ? ORDER BY e.created_at, e.id`,
      [alertId]
    );
  },
};

module.exports = AlertModel;
