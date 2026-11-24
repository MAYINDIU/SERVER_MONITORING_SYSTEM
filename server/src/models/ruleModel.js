const { query, queryOne } = require('../config/db');

const { RULE_METRICS: METRICS } = require('../database/upgrade');

const RuleModel = {
  METRICS,

  list() {
    return query(
      `SELECT r.*, s.name AS server_name, s.ip_address
         FROM alert_rules r LEFT JOIN servers s ON s.id = r.server_id
        ORDER BY FIELD(r.metric, ${METRICS.map(() => '?').join(',')}), r.server_id IS NOT NULL, r.id`,
      METRICS
    );
  },

  enabled() {
    return query('SELECT * FROM alert_rules WHERE enabled = 1');
  },

  findById(id) {
    return queryOne('SELECT * FROM alert_rules WHERE id = ?', [id]);
  },

  async create(r) {
    const res = await query(
      `INSERT INTO alert_rules (name, metric, warning_threshold, critical_threshold, duration_sec,
                                server_id, sms_enabled, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        r.name, r.metric, r.warning_threshold ?? null, r.critical_threshold ?? null,
        r.duration_sec || 0, r.server_id || null, r.sms_enabled ? 1 : 0, r.enabled === false ? 0 : 1,
      ]
    );
    return res.insertId;
  },

  update(id, r) {
    return query(
      `UPDATE alert_rules SET name = ?, metric = ?, warning_threshold = ?, critical_threshold = ?,
              duration_sec = ?, server_id = ?, sms_enabled = ?, enabled = ?
        WHERE id = ?`,
      [
        r.name, r.metric, r.warning_threshold ?? null, r.critical_threshold ?? null,
        r.duration_sec || 0, r.server_id || null, r.sms_enabled ? 1 : 0, r.enabled ? 1 : 0, id,
      ]
    );
  },

  remove(id) {
    return query('DELETE FROM alert_rules WHERE id = ?', [id]);
  },
};

module.exports = RuleModel;
