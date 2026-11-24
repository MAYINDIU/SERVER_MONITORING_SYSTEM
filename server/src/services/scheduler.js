/**
 * Background jobs:
 *   every 10 s  -> offline detection
 *   every 5 min -> hourly rollup (current + previous hour, idempotent)
 *   every 1 h   -> retention purge (raw + hourly + resolved incidents/SMS log), default 60 days
 */
const MetricModel = require('../models/metricModel');
const SettingModel = require('../models/settingModel');
const LoginModel = require('../models/loginModel');
const alertEngine = require('./alertEngine');

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

function guard(name, fn) {
  let running = false;
  return async () => {
    if (running) return;
    running = true;
    try {
      await fn();
    } catch (err) {
      console.error(`[scheduler] ${name} failed:`, err.message);
    } finally {
      running = false;
    }
  };
}

const offlineJob = guard('offline-check', async () => {
  await alertEngine.checkOffline();
  await alertEngine.checkLoginFailures(); // lets "failed logins" incidents recover once attempts stop
});

const rollupJob = guard('rollup', async () => {
  const hourStart = Math.floor(Date.now() / HOUR) * HOUR;
  await MetricModel.rollupHourly(new Date(hourStart - HOUR), new Date(hourStart + HOUR));
});

const retentionJob = guard('retention', async () => {
  const s = await SettingModel.all(true);
  const rawDays = Math.max(Number(s.raw_retention_days) || 60, 1);
  const hourlyDays = Math.max(Number(s.hourly_retention_days) || 60, 1);
  // make sure everything about to be purged has been rolled up first
  const cutoff = new Date(Date.now() - rawDays * DAY);
  await MetricModel.rollupHourly(new Date(cutoff.getTime() - 2 * DAY), cutoff);
  const raw = await MetricModel.purgeRaw(cutoff);
  const hourly = await MetricModel.purgeHourly(new Date(Date.now() - hourlyDays * DAY));
  const hist = await MetricModel.purgeHistory(new Date(Date.now() - hourlyDays * DAY));
  const logins = await LoginModel.purge(new Date(Date.now() - hourlyDays * DAY));
  if (raw || hourly || hist.alerts || hist.notifications || logins) {
    console.log(`[retention] purged ${raw} raw, ${hourly} hourly, ${hist.alerts} resolved incidents, ${hist.notifications} SMS log rows, ${logins} login events`);
  }
});

function start() {
  setInterval(offlineJob, 10 * 1000);
  setInterval(rollupJob, 5 * 60 * 1000);
  setInterval(retentionJob, HOUR);
  setTimeout(rollupJob, 5000);
  setTimeout(retentionJob, 60 * 1000);
}

module.exports = { start, rollupJob };
