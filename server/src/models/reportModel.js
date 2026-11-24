const { query, queryOne } = require('../config/db');
const env = require('../config/env');

const OFF = () => env.tzOffsetMin * 60; // seconds

/* Bucket expression: epoch seconds of the bucket start, aligned to LOCAL time. */
const bucketExpr = (col) => `(FLOOR((UNIX_TIMESTAMP(${col}) + ?) / ?) * ? - ?)`;

const RAW_SERIES_COLS = `
  ROUND(AVG(cpu_pct), 2)  AS cpu,   ROUND(MAX(cpu_pct), 2)  AS cpu_max,
  ROUND(AVG(mem_pct), 2)  AS mem,   ROUND(MAX(mem_pct), 2)  AS mem_max,
  ROUND(AVG(swap_pct), 2) AS swap,  ROUND(AVG(disk_pct), 2) AS disk,
  ROUND(AVG(cpu_temp), 1) AS temp,
  ROUND(AVG(net_rx_bps))  AS rx,    MAX(net_rx_bps) AS rx_max,
  ROUND(AVG(net_tx_bps))  AS tx,    MAX(net_tx_bps) AS tx_max,
  COUNT(*) AS samples`;

const HOURLY_SERIES_COLS = `
  ROUND(SUM(cpu_avg * samples) / NULLIF(SUM(samples), 0), 2)  AS cpu,  MAX(cpu_max) AS cpu_max,
  ROUND(SUM(mem_avg * samples) / NULLIF(SUM(samples), 0), 2)  AS mem,  MAX(mem_max) AS mem_max,
  ROUND(SUM(swap_avg * samples) / NULLIF(SUM(samples), 0), 2) AS swap,
  ROUND(SUM(disk_avg * samples) / NULLIF(SUM(samples), 0), 2) AS disk,
  ROUND(SUM(temp_avg * samples) / NULLIF(SUM(samples), 0), 1) AS temp,
  ROUND(SUM(rx_avg * samples) / NULLIF(SUM(samples), 0))      AS rx,   MAX(rx_max) AS rx_max,
  ROUND(SUM(tx_avg * samples) / NULLIF(SUM(samples), 0))      AS tx,   MAX(tx_max) AS tx_max,
  SUM(samples) AS samples`;

const RAW_SUMMARY_COLS = `
  COUNT(*) AS samples,
  ROUND(AVG(cpu_pct), 2) AS cpu_avg, MAX(cpu_pct) AS cpu_max, MIN(cpu_pct) AS cpu_min,
  ROUND(AVG(mem_pct), 2) AS mem_avg, MAX(mem_pct) AS mem_max, MIN(mem_pct) AS mem_min,
  ROUND(AVG(disk_pct), 2) AS disk_avg, MAX(disk_pct) AS disk_max,
  ROUND(AVG(swap_pct), 2) AS swap_avg,
  ROUND(AVG(cpu_temp), 1) AS temp_avg, MAX(cpu_temp) AS temp_max,
  ROUND(AVG(net_rx_bps)) AS rx_avg, MAX(net_rx_bps) AS rx_max,
  ROUND(AVG(net_tx_bps)) AS tx_avg, MAX(net_tx_bps) AS tx_max,
  MIN(created_at) AS first_at, MAX(created_at) AS last_at`;

const HOURLY_SUMMARY_COLS = `
  SUM(samples) AS samples,
  ROUND(SUM(cpu_avg * samples) / NULLIF(SUM(samples), 0), 2) AS cpu_avg, MAX(cpu_max) AS cpu_max, MIN(cpu_avg) AS cpu_min,
  ROUND(SUM(mem_avg * samples) / NULLIF(SUM(samples), 0), 2) AS mem_avg, MAX(mem_max) AS mem_max, MIN(mem_avg) AS mem_min,
  ROUND(SUM(disk_avg * samples) / NULLIF(SUM(samples), 0), 2) AS disk_avg, MAX(disk_max) AS disk_max,
  ROUND(SUM(swap_avg * samples) / NULLIF(SUM(samples), 0), 2) AS swap_avg,
  ROUND(SUM(temp_avg * samples) / NULLIF(SUM(samples), 0), 1) AS temp_avg, MAX(temp_max) AS temp_max,
  ROUND(SUM(rx_avg * samples) / NULLIF(SUM(samples), 0)) AS rx_avg, MAX(rx_max) AS rx_max,
  ROUND(SUM(tx_avg * samples) / NULLIF(SUM(samples), 0)) AS tx_avg, MAX(tx_max) AS tx_max,
  MIN(bucket) AS first_at, MAX(bucket) AS last_at`;

const src = (r) =>
  r.source === 'hourly'
    ? { table: 'metrics_hourly', time: 'bucket', series: HOURLY_SERIES_COLS, summary: HOURLY_SUMMARY_COLS }
    : { table: 'metrics', time: 'created_at', series: RAW_SERIES_COLS, summary: RAW_SUMMARY_COLS };

const ReportModel = {
  /** Time-series for one server. */
  serverSeries(serverId, r) {
    const s = src(r);
    const b = r.bucketSec;
    return query(
      `SELECT ${bucketExpr(s.time)} AS ts, ${s.series}
         FROM ${s.table}
        WHERE server_id = ? AND ${s.time} >= ? AND ${s.time} < ?
        GROUP BY ts ORDER BY ts`,
      [OFF(), b, b, OFF(), serverId, r.from, r.to]
    );
  },

  /** Aggregate summary (avg / max / min) for one server. */
  serverSummary(serverId, r) {
    const s = src(r);
    return queryOne(
      `SELECT ${s.summary} FROM ${s.table}
        WHERE server_id = ? AND ${s.time} >= ? AND ${s.time} < ?`,
      [serverId, r.from, r.to]
    );
  },

  /** One summary row per server (servers with no data still appear). */
  fleetSummary(r) {
    const s = src(r);
    return query(
      `SELECT sv.id AS server_id, sv.server_code, sv.name, sv.ip_address, sv.group_name, sv.status,
              sv.created_at AS registered_at, m.*
         FROM servers sv
         LEFT JOIN (
           SELECT server_id AS sid, ${s.summary}
             FROM ${s.table}
            WHERE ${s.time} >= ? AND ${s.time} < ?
            GROUP BY server_id
         ) m ON m.sid = sv.id
        ORDER BY sv.group_name, sv.name`,
      [r.from, r.to]
    );
  },

  /** Fleet-wide series: average CPU/RAM/Disk across servers, total network. */
  fleetSeries(r) {
    const s = src(r);
    const b = r.bucketSec;
    // per-server bucket first, then aggregate across servers
    return query(
      `SELECT ts,
              ROUND(AVG(cpu), 2) AS cpu, ROUND(MAX(cpu_max), 2) AS cpu_max,
              ROUND(AVG(mem), 2) AS mem, ROUND(AVG(disk), 2) AS disk,
              ROUND(SUM(rx)) AS rx, ROUND(SUM(tx)) AS tx,
              COUNT(*) AS servers
         FROM (
           SELECT server_id, ${bucketExpr(s.time)} AS ts, ${s.series}
             FROM ${s.table}
            WHERE ${s.time} >= ? AND ${s.time} < ?
            GROUP BY server_id, ts
         ) per_server
        GROUP BY ts ORDER BY ts`,
      [OFF(), b, b, OFF(), r.from, r.to]
    );
  },

  /** Alert statistics for the alert report. */
  async alertStats(r, serverId = null) {
    const where = ['a.first_detected_at >= ?', 'a.first_detected_at < ?'];
    const params = [r.from, r.to];
    if (serverId) {
      where.push('a.server_id = ?');
      params.push(serverId);
    }
    const w = where.join(' AND ');

    const [totals, bySeverity, byMetric, byServer] = await Promise.all([
      queryOne(
        `SELECT COUNT(*) AS total,
                SUM(a.status <> 'resolved') AS active,
                ROUND(AVG(CASE WHEN a.resolved_at IS NOT NULL
                          THEN TIMESTAMPDIFF(SECOND, a.first_detected_at, a.resolved_at) END)) AS mttr_sec,
                ROUND(AVG(CASE WHEN a.acknowledged_at IS NOT NULL
                          THEN TIMESTAMPDIFF(SECOND, a.first_detected_at, a.acknowledged_at) END)) AS mtta_sec
           FROM alerts a WHERE ${w}`,
        params
      ),
      query(`SELECT a.severity, COUNT(*) AS total FROM alerts a WHERE ${w} GROUP BY a.severity`, params),
      query(`SELECT a.metric, COUNT(*) AS total FROM alerts a WHERE ${w} GROUP BY a.metric ORDER BY total DESC`, params),
      query(
        `SELECT s.id AS server_id, s.name, s.ip_address, COUNT(*) AS total,
                SUM(a.severity = 'critical') AS critical, SUM(a.severity = 'warning') AS warning,
                ROUND(SUM(TIMESTAMPDIFF(SECOND, a.first_detected_at,
                          COALESCE(a.resolved_at, UTC_TIMESTAMP())))) AS alert_seconds
           FROM alerts a JOIN servers s ON s.id = a.server_id
          WHERE ${w}
          GROUP BY s.id, s.name, s.ip_address ORDER BY total DESC`,
        params
      ),
    ]);
    return { totals, bySeverity, byMetric, byServer };
  },

  /** Total seconds a server was flagged offline inside the range (for SLA). */
  offlineSeconds(r, serverId = null) {
    const params = [r.from, r.to, r.to, r.from];
    let extra = '';
    if (serverId) {
      extra = 'AND server_id = ?';
      params.push(serverId);
    }
    return query(
      `SELECT server_id,
              SUM(GREATEST(0, TIMESTAMPDIFF(SECOND,
                    GREATEST(first_detected_at, ?),
                    LEAST(COALESCE(resolved_at, UTC_TIMESTAMP()), ?)))) AS seconds
         FROM alerts
        WHERE metric = 'offline'
          AND first_detected_at < ?
          AND COALESCE(resolved_at, UTC_TIMESTAMP()) > ? ${extra}
        GROUP BY server_id`,
      params
    );
  },
};

module.exports = ReportModel;
