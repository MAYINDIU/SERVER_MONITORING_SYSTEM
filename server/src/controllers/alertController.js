const AlertModel = require('../models/alertModel');
const LogModel = require('../models/logModel');
const alertEngine = require('../services/alertEngine');
const { emit } = require('../services/socket');
const { HttpError, clientIp } = require('../utils/http');

exports.list = async (req, res) => {
  const q = req.query;
  res.json(
    await AlertModel.list({
      status: q.status, severity: q.severity, serverId: q.server_id, metric: q.metric,
      from: q.from, to: q.to, q: q.q, page: q.page, limit: q.limit,
    })
  );
};

exports.summary = async (req, res) => {
  res.json(await AlertModel.summary());
};

exports.get = async (req, res) => {
  const alert = await AlertModel.findById(req.params.id);
  if (!alert) throw new HttpError(404, 'Alert not found');
  res.json({ ...alert, events: await AlertModel.events(alert.id) });
};

exports.acknowledge = async (req, res) => {
  const alert = await AlertModel.findById(req.params.id);
  if (!alert) throw new HttpError(404, 'Alert not found');
  if (alert.status !== 'open') throw new HttpError(400, `Alert is already ${alert.status}`);
  await AlertModel.acknowledge(alert.id, req.user.id);
  await AlertModel.addEvent(alert.id, 'acknowledged', req.body?.note || null, req.user.id);
  alertEngine.markAcknowledged(alert.fingerprint);
  await LogModel.audit({ user: req.user, action: 'alert_ack', entity: 'alert', entityId: alert.id, ip: clientIp(req) });
  const updated = await AlertModel.findById(alert.id);
  emit('alert:updated', updated);
  res.json(updated);
};

exports.resolve = async (req, res) => {
  const alert = await AlertModel.findById(req.params.id);
  if (!alert) throw new HttpError(404, 'Alert not found');
  if (alert.status === 'resolved') throw new HttpError(400, 'Alert is already resolved');
  const note = req.body?.note || null;
  await AlertModel.resolve(alert.id, { userId: req.user.id, note });
  await AlertModel.addEvent(alert.id, 'resolved', note, req.user.id);
  alertEngine.forget(alert.fingerprint);
  await LogModel.audit({ user: req.user, action: 'alert_resolve', entity: 'alert', entityId: alert.id, ip: clientIp(req) });
  const updated = await AlertModel.findById(alert.id);
  emit('alert:updated', updated);
  res.json(updated);
};

exports.addNote = async (req, res) => {
  const note = String(req.body?.note || '').trim();
  if (!note) throw new HttpError(400, 'Note is required');
  const alert = await AlertModel.findById(req.params.id);
  if (!alert) throw new HttpError(404, 'Alert not found');
  await AlertModel.addEvent(alert.id, 'note', note, req.user.id);
  res.json(await AlertModel.events(alert.id));
};
