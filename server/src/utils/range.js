const env = require('../config/env');

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

/**
 * Converts a report range into { from, to, bucketSec, source }.
 *  source = 'raw'    -> metrics table (10 s samples)
 *  source = 'hourly' -> metrics_hourly rollup table
 */
function resolveRange({ range = 'hour', from, to } = {}) {
  const now = Date.now();
  const offMs = env.tzOffsetMin * 60 * 1000;

  if (from && to) {
    const f = new Date(from).getTime();
    const t = new Date(to).getTime();
    if (Number.isNaN(f) || Number.isNaN(t) || f >= t) throw new Error('Invalid from/to');
    const span = t - f;
    if (span <= 2 * DAY) {
      const bucket = Math.max(10, Math.ceil(span / 1000 / 300 / 10) * 10);
      return { range: 'custom', from: new Date(f), to: new Date(t), bucketSec: bucket, source: 'raw' };
    }
    const bucket = span <= 31 * DAY ? 3600 : 86400;
    return { range: 'custom', from: new Date(f), to: new Date(t), bucketSec: bucket, source: 'hourly' };
  }

  switch (range) {
    case 'today': {
      const localMidnight = Math.floor((now + offMs) / DAY) * DAY - offMs;
      return { range, from: new Date(localMidnight), to: new Date(now), bucketSec: 300, source: 'raw' };
    }
    case '24h':
      return { range, from: new Date(now - DAY), to: new Date(now), bucketSec: 300, source: 'raw' };
    case '7d':
      return { range, from: new Date(now - 7 * DAY), to: new Date(now), bucketSec: 3600, source: 'hourly' };
    case '30d':
      return { range, from: new Date(now - 30 * DAY), to: new Date(now), bucketSec: 4 * 3600, source: 'hourly' };
    case '12m':
      return { range, from: new Date(now - 365 * DAY), to: new Date(now), bucketSec: 86400, source: 'hourly' };
    case 'hour':
    default:
      return { range: 'hour', from: new Date(now - HOUR), to: new Date(now), bucketSec: 10, source: 'raw' };
  }
}

module.exports = { resolveRange };
