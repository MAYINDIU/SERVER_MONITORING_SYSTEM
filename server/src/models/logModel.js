const { query, queryOne } = require('../config/db');

/** Notification delivery log + audit trail. */
const LogModel = {
  addNotification({ alertId = null, channel = 'sms', recipient, message, status, response }) {
    return query(
      'INSERT INTO notifications (alert_id, channel, recipient, message, status, response) VALUES (?, ?, ?, ?, ?, ?)',
      [alertId, channel, recipient, String(message).slice(0, 500), status, response ? String(response).slice(0, 500) : null]
    );
  },

  notifications(limit = 100) {
    return query('SELECT * FROM notifications ORDER BY id DESC LIMIT ?', [Math.min(Number(limit) || 100, 1000)]);
  },

  /** Last time an SMS went out for a given alert fingerprint (for cooldown). */
  lastSmsForFingerprint(fingerprint) {
    return queryOne(
      `SELECT MAX(n.created_at) AS at FROM notifications n
         JOIN alerts a ON a.id = n.alert_id
        WHERE a.fingerprint = ? AND n.status = 'sent'`,
      [fingerprint]
    );
  },

  audit({ user, action, entity = null, entityId = null, details = null, ip = null }) {
    return query(
      'INSERT INTO audit_logs (user_id, username, action, entity, entity_id, details, ip) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        user?.id || null, user?.username || null, action, entity,
        entityId == null ? null : String(entityId),
        details ? JSON.stringify(details).slice(0, 4000) : null, ip,
      ]
    );
  },

  auditList(limit = 200) {
    return query('SELECT * FROM audit_logs ORDER BY id DESC LIMIT ?', [Math.min(Number(limit) || 200, 2000)]);
  },
};

module.exports = LogModel;
