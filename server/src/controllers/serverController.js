const { execFile } = require('child_process');
const ServerModel = require('../models/serverModel');
const MetricModel = require('../models/metricModel');
const LogModel = require('../models/logModel');
const liveCache = require('../services/liveCache');
const alertEngine = require('../services/alertEngine');
const { emit } = require('../services/socket');
const { HttpError, clientIp } = require('../utils/http');

const withLive = (s) => s && { ...s, live: liveCache.get(s.id) };

exports.list = async (req, res) => {
  const rows = await ServerModel.list();
  res.json(rows.map(withLive));
};

exports.groups = async (req, res) => {
  res.json(await ServerModel.groups());
};

exports.get = async (req, res) => {
  const server = await ServerModel.findById(req.params.id);
  if (!server) throw new HttpError(404, 'Server not found');
  res.json(withLive(server));
};

/** Last N raw samples – seeds the live chart before socket updates arrive. */
exports.latest = async (req, res) => {
  res.json(await MetricModel.latest(req.params.id, req.query.limit || 90));
};

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

/** Manually pre-register a PC by IP. It stays "waiting for agent" until the agent on that IP connects. */
exports.create = async (req, res) => {
  const b = req.body || {};
  const ip = String(b.ip_address || '').trim();
  if (!IPV4.test(ip)) throw new HttpError(400, 'Enter a valid IPv4 address, e.g. 192.168.11.155');
  if (await ServerModel.findByIp(ip)) throw new HttpError(409, `${ip} is already added`);
  const id = await ServerModel.create({ ip, hostname: null, tokenHash: null });
  await ServerModel.updateMeta(id, {
    name: b.name?.trim() || ip,
    group_name: b.group_name?.trim() || 'Default',
    location: b.location, environment: b.environment, owner: b.owner, notes: b.notes,
  });
  await LogModel.audit({ user: req.user, action: 'server_create', entity: 'server', entityId: id, details: { ip, name: b.name }, ip: clientIp(req) });
  const server = withLive(await ServerModel.findById(id));
  emit('server:registered', server);
  res.status(201).json(server);
};

/** Ping an IP from the monitoring server (reachability check before installing the agent). */
exports.ping = async (req, res) => {
  const ip = String(req.body?.ip || '').trim();
  if (!IPV4.test(ip)) throw new HttpError(400, 'Invalid IPv4 address');
  const isWin = process.platform === 'win32';
  const args = isWin ? ['-n', '2', '-w', '1500', ip] : ['-c', '2', '-W', '2', ip];
  execFile('ping', args, { timeout: 8000 }, (err, stdout = '') => {
    const times = [...stdout.matchAll(/time[=<]\s*([\d.]+)\s*ms/gi)].map((m) => Number(m[1]));
    const reachable = times.length > 0;
    res.json({
      ip,
      reachable,
      time_ms: reachable ? Math.round(times.reduce((a, t) => a + t, 0) / times.length) : null,
    });
  });
};

exports.update = async (req, res) => {
  const id = Number(req.params.id);
  const existing = await ServerModel.findById(id);
  if (!existing) throw new HttpError(404, 'Server not found');
  const b = req.body || {};
  await ServerModel.updateMeta(id, {
    name: b.name?.trim(),
    group_name: b.group_name?.trim(),
    location: b.location,
    environment: b.environment,
    owner: b.owner,
    notes: b.notes,
    is_enabled: b.is_enabled === undefined ? undefined : b.is_enabled ? 1 : 0,
  });
  await LogModel.audit({ user: req.user, action: 'server_update', entity: 'server', entityId: id, details: b, ip: clientIp(req) });
  const server = withLive(await ServerModel.findById(id));
  emit('server:updated', server);
  res.json(server);
};

exports.remove = async (req, res) => {
  const id = Number(req.params.id);
  const existing = await ServerModel.findById(id);
  if (!existing) throw new HttpError(404, 'Server not found');
  await ServerModel.remove(id);
  liveCache.remove(id);
  alertEngine.forgetServer(id);
  await LogModel.audit({
    user: req.user, action: 'server_delete', entity: 'server', entityId: id,
    details: { name: existing.name, ip: existing.ip_address }, ip: clientIp(req),
  });
  emit('server:deleted', { id });
  res.json({ ok: true });
};
