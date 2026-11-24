const ReportModel = require('../models/reportModel');
const ServerModel = require('../models/serverModel');
const env = require('../config/env');
const { resolveRange } = require('../utils/range');
const { HttpError } = require('../utils/http');

const MB = 1024 * 1024;

function range(req) {
  try {
    return resolveRange(req.query);
  } catch (e) {
    throw new HttpError(400, e.message);
  }
}

/** Availability (SLA) and data-coverage percentages for one server. */
function availability(r, registeredAt, samples, offlineSec) {
  const start = Math.max(r.from.getTime(), new Date(registeredAt || r.from).getTime());
  const span = Math.max((r.to.getTime() - start) / 1000, 1);
  return {
    period_sec: Math.round(span),
    offline_sec: Math.round(offlineSec || 0),
    availability_pct: Math.max(0, Math.min(100, ((span - (offlineSec || 0)) / span) * 100)).toFixed(2) * 1,
    coverage_pct: Math.min(100, (((samples || 0) * env.sampleIntervalSec) / span) * 100).toFixed(2) * 1,
  };
}

const rangeInfo = (r) => ({
  range: r.range, from: r.from, to: r.to, bucket_sec: r.bucketSec, source: r.source,
});

exports.server = async (req, res) => {
  const r = range(req);
  const server = await ServerModel.findById(req.params.id);
  if (!server) throw new HttpError(404, 'Server not found');

  const [summary, series, alerts, offline] = await Promise.all([
    ReportModel.serverSummary(server.id, r),
    ReportModel.serverSeries(server.id, r),
    ReportModel.alertStats(r, server.id),
    ReportModel.offlineSeconds(r, server.id),
  ]);
  res.json({
    range: rangeInfo(r),
    server,
    summary: { ...summary, ...availability(r, server.created_at, summary?.samples, offline[0]?.seconds) },
    series,
    alerts,
  });
};

exports.fleet = async (req, res) => {
  const r = range(req);
  const [rows, series, alerts, offline] = await Promise.all([
    ReportModel.fleetSummary(r),
    ReportModel.fleetSeries(r),
    ReportModel.alertStats(r),
    ReportModel.offlineSeconds(r),
  ]);
  const offMap = Object.fromEntries(offline.map((o) => [o.server_id, o.seconds]));
  const servers = rows.map((row) => {
    const { sid, ...rest } = row;
    return { ...rest, ...availability(r, row.registered_at, row.samples, offMap[row.server_id]) };
  });

  const withData = servers.filter((s) => s.samples);
  const avg = (k) => (withData.length ? withData.reduce((a, s) => a + Number(s[k] || 0), 0) / withData.length : null);
  const max = (k) => (withData.length ? Math.max(...withData.map((s) => Number(s[k] || 0))) : null);

  res.json({
    range: rangeInfo(r),
    totals: {
      servers: servers.length,
      reporting: withData.length,
      cpu_avg: avg('cpu_avg'),
      cpu_max: max('cpu_max'),
      mem_avg: avg('mem_avg'),
      mem_max: max('mem_max'),
      disk_avg: avg('disk_avg'),
      availability_avg: servers.length ? servers.reduce((a, s) => a + s.availability_pct, 0) / servers.length : null,
    },
    servers,
    series,
    alerts,
  });
};

exports.alerts = async (req, res) => {
  const r = range(req);
  res.json({ range: rangeInfo(r), ...(await ReportModel.alertStats(r, req.query.server_id || null)) });
};

/* ------------------------------ CSV ------------------------------ */

const csvCell = (v) => {
  if (v == null) return '';
  const s = v instanceof Date ? v.toISOString() : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCsv = (header, rows) => [header.join(','), ...rows.map((r) => r.map(csvCell).join(','))].join('\r\n');
const mbps = (v) => (v == null ? '' : (v / MB).toFixed(3));
const localTime = (sec) => new Date(sec * 1000 + env.tzOffsetMin * 60000).toISOString().replace('T', ' ').slice(0, 19);

function sendCsv(res, name, csv) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.send(`﻿${csv}`);
}

exports.serverCsv = async (req, res) => {
  const r = range(req);
  const server = await ServerModel.findById(req.params.id);
  if (!server) throw new HttpError(404, 'Server not found');
  const series = await ReportModel.serverSeries(server.id, r);
  const csv = toCsv(
    ['Time (local)', 'CPU avg %', 'CPU max %', 'RAM avg %', 'RAM max %', 'Swap %', 'Disk %', 'Temp °C',
      'Net RX avg MB/s', 'Net RX max MB/s', 'Net TX avg MB/s', 'Net TX max MB/s', 'Samples'],
    series.map((s) => [
      localTime(s.ts), s.cpu, s.cpu_max, s.mem, s.mem_max, s.swap, s.disk, s.temp,
      mbps(s.rx), mbps(s.rx_max), mbps(s.tx), mbps(s.tx_max), s.samples,
    ])
  );
  sendCsv(res, `${server.server_code}_${server.name}_${r.range}.csv`.replace(/[^\w.-]+/g, '_'), csv);
};

exports.fleetCsv = async (req, res) => {
  const r = range(req);
  const [rows, offline] = await Promise.all([ReportModel.fleetSummary(r), ReportModel.offlineSeconds(r)]);
  const offMap = Object.fromEntries(offline.map((o) => [o.server_id, o.seconds]));
  const csv = toCsv(
    ['Code', 'Server', 'IP', 'Group', 'Status', 'CPU avg %', 'CPU max %', 'RAM avg %', 'RAM max %',
      'Disk avg %', 'Disk max %', 'Temp max °C', 'Net RX avg MB/s', 'Net TX avg MB/s', 'Availability %',
      'Data coverage %', 'Samples'],
    rows.map((s) => {
      const a = availability(r, s.registered_at, s.samples, offMap[s.server_id]);
      return [
        s.server_code, s.name, s.ip_address, s.group_name, s.status, s.cpu_avg, s.cpu_max, s.mem_avg, s.mem_max,
        s.disk_avg, s.disk_max, s.temp_max, mbps(s.rx_avg), mbps(s.tx_avg), a.availability_pct, a.coverage_pct,
        s.samples || 0,
      ];
    })
  );
  sendCsv(res, `all_servers_${r.range}.csv`, csv);
};
