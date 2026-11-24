const { query } = require('../config/db');

const COLS = [
  'server_id', 'created_at', 'cpu_pct', 'cpu_temp', 'mem_used', 'mem_total', 'mem_pct', 'swap_pct',
  'disk_pct', 'disk_used', 'disk_total', 'disk_read_bps', 'disk_write_bps',
  'net_rx_bps', 'net_tx_bps', 'process_count', 'uptime_sec',
];

const MetricModel = {
  COLS,

  /** Bulk insert samples (array of objects keyed by COLS). */
  insertMany(samples) {
    if (!samples.length) return null;
    const values = samples.map((s) => COLS.map((c) => (s[c] === undefined ? null : s[c])));
    return query(`INSERT INTO metrics (${COLS.join(', ')}) VALUES ?`, [values]);
  },

  /** Most recent N raw samples for a server (oldest first) – used for live charts. */
  async latest(serverId, limit = 60) {
    const rows = await query(
      `SELECT created_at, cpu_pct, cpu_temp, mem_pct, mem_used, mem_total, swap_pct, disk_pct,
              disk_read_bps, disk_write_bps, net_rx_bps, net_tx_bps, uptime_sec
         FROM metrics WHERE server_id = ?
        ORDER BY created_at DESC LIMIT ?`,
      [serverId, Math.min(Number(limit) || 60, 1000)]
    );
    return rows.reverse();
  },

  /** Last sample of every server – used to warm the live cache on boot. */
  latestPerServer() {
    return query(
      `SELECT m.* FROM metrics m
         JOIN (SELECT server_id, MAX(created_at) AS mx FROM metrics
                WHERE created_at > UTC_TIMESTAMP() - INTERVAL 1 DAY GROUP BY server_id) x
           ON x.server_id = m.server_id AND x.mx = m.created_at`
    );
  },

  /**
   * Re-aggregates raw samples into metrics_hourly for [from, to).
   * Idempotent thanks to ON DUPLICATE KEY UPDATE.
   */
  rollupHourly(from, to) {
    return query(
      `INSERT INTO metrics_hourly
          (server_id, bucket, samples, cpu_avg, cpu_max, mem_avg, mem_max, swap_avg,
           disk_avg, disk_max, temp_avg, temp_max, rx_avg, rx_max, tx_avg, tx_max)
       SELECT server_id,
              DATE_FORMAT(created_at, '%Y-%m-%d %H:00:00') AS b,
              COUNT(*), AVG(cpu_pct), MAX(cpu_pct), AVG(mem_pct), MAX(mem_pct), AVG(swap_pct),
              AVG(disk_pct), MAX(disk_pct), AVG(cpu_temp), MAX(cpu_temp),
              AVG(net_rx_bps), MAX(net_rx_bps), AVG(net_tx_bps), MAX(net_tx_bps)
         FROM metrics
        WHERE created_at >= ? AND created_at < ?
        GROUP BY server_id, b
       ON DUPLICATE KEY UPDATE
          samples = VALUES(samples), cpu_avg = VALUES(cpu_avg), cpu_max = VALUES(cpu_max),
          mem_avg = VALUES(mem_avg), mem_max = VALUES(mem_max), swap_avg = VALUES(swap_avg),
          disk_avg = VALUES(disk_avg), disk_max = VALUES(disk_max),
          temp_avg = VALUES(temp_avg), temp_max = VALUES(temp_max),
          rx_avg = VALUES(rx_avg), rx_max = VALUES(rx_max),
          tx_avg = VALUES(tx_avg), tx_max = VALUES(tx_max)`,
      [from, to]
    );
  },

  /** Delete in small chunks so the table is never locked for long. */
  async purgeRaw(before, chunk = 20000) {
    let total = 0;
    for (;;) {
      const r = await query('DELETE FROM metrics WHERE created_at < ? LIMIT ?', [before, chunk]);
      total += r.affectedRows;
      if (r.affectedRows < chunk) return total;
    }
  },

  async purgeHourly(before, chunk = 20000) {
    let total = 0;
    for (;;) {
      const r = await query('DELETE FROM metrics_hourly WHERE bucket < ? LIMIT ?', [before, chunk]);
      total += r.affectedRows;
      if (r.affectedRows < chunk) return total;
    }
  },

  /** Delete resolved incidents (their timeline events cascade) and SMS log rows older than `before`. */
  async purgeHistory(before, chunk = 5000) {
    let alerts = 0;
    for (;;) {
      const r = await query("DELETE FROM alerts WHERE status = 'resolved' AND COALESCE(resolved_at, last_detected_at) < ? LIMIT ?", [before, chunk]);
      alerts += r.affectedRows;
      if (r.affectedRows < chunk) break;
    }
    const n = await query("DELETE FROM notifications WHERE created_at < ?", [before]);
    return { alerts, notifications: n.affectedRows };
  },

  async storageStats() {
    return query(
      `SELECT table_name AS name, table_rows AS approx_rows,
              ROUND((data_length + index_length) / 1048576, 1) AS size_mb
         FROM information_schema.tables
        WHERE table_schema = DATABASE() AND table_name IN ('metrics','metrics_hourly','alerts')`
    );
  },
};

module.exports = MetricModel;
