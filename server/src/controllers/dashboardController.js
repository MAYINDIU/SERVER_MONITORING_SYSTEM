const ServerModel = require('../models/serverModel');
const AlertModel = require('../models/alertModel');
const MetricModel = require('../models/metricModel');
const ReportModel = require('../models/reportModel');
const SettingModel = require('../models/settingModel');
const liveCache = require('../services/liveCache');
const { resolveRange } = require('../utils/range');

/** Everything the NOC overview page needs in one call. */
exports.overview = async (req, res) => {
  const [servers, alertSummary, recentAlerts, fleetSeries, settings] = await Promise.all([
    ServerModel.list(),
    AlertModel.summary(),
    AlertModel.recent(8),
    ReportModel.fleetSeries({ ...resolveRange({ range: 'hour' }), bucketSec: 60 }),
    SettingModel.all(),
  ]);

  const enriched = servers.map((s) => ({ ...s, live: liveCache.get(s.id) }));
  const counts = {
    total: servers.length,
    online: servers.filter((s) => s.status === 'online').length,
    offline: servers.filter((s) => s.status === 'offline').length,
    unknown: servers.filter((s) => s.status === 'unknown').length,
    critical: servers.filter((s) => s.critical_count > 0).length,
    warning: servers.filter((s) => !s.critical_count && s.warning_count > 0).length,
  };

  const top = (key) =>
    enriched
      .filter((s) => s.live && s.status === 'online' && s.live[key] != null)
      .sort((a, b) => b.live[key] - a.live[key])
      .slice(0, 5)
      .map((s) => ({ id: s.id, name: s.name, ip_address: s.ip_address, value: s.live[key] }));

  res.json({
    counts,
    alerts: alertSummary,
    recentAlerts,
    fleetSeries,
    top: { cpu: top('cpu_pct'), mem: top('mem_pct'), disk: top('disk_pct'), net: top('net_rx_bps') },
    servers: enriched,
    company: { name: settings.company_name, title: settings.app_title },
  });
};

exports.system = async (req, res) => {
  res.json({
    storage: await MetricModel.storageStats(),
    uptime_sec: Math.round(process.uptime()),
    node: process.version,
    memory_mb: Math.round(process.memoryUsage().rss / 1048576),
  });
};
