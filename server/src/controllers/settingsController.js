const bcrypt = require('bcryptjs');
const SettingModel = require('../models/settingModel');
const RuleModel = require('../models/ruleModel');
const UserModel = require('../models/userModel');
const LogModel = require('../models/logModel');
const alertEngine = require('../services/alertEngine');
const { sendSms } = require('../services/smsService');
const env = require('../config/env');
const { HttpError, clientIp } = require('../utils/http');

const EDITABLE = [
  'company_name', 'app_title', 'offline_after_sec', 'raw_retention_days', 'hourly_retention_days',
  'sms_enabled', 'sms_method', 'sms_api_url', 'sms_api_key', 'sms_sender_id', 'sms_post_body',
  'sms_recipients', 'sms_min_severity', 'sms_cooldown_min', 'sms_on_recovery', 'sound_enabled',
  'login_trusted_ips', 'login_ignore_users', 'login_alert_local', 'login_alert_network',
];
const SECRET = ['sms_api_key'];
const MASK = '••••••••';

/* ----------------------------- settings ----------------------------- */

exports.get = async (req, res) => {
  const all = await SettingModel.all(true);
  const out = {};
  for (const k of EDITABLE) out[k] = SECRET.includes(k) && all[k] ? MASK : all[k] ?? '';
  // public (non-admin) users get only what the UI needs
  if (req.user.role !== 'admin') {
    return res.json({ company_name: out.company_name, app_title: out.app_title, sound_enabled: out.sound_enabled });
  }
  res.json({ ...out, enroll_key: env.enrollKey });
};

exports.update = async (req, res) => {
  const b = req.body || {};
  const patch = {};
  for (const k of EDITABLE) {
    if (b[k] === undefined) continue;
    if (SECRET.includes(k) && b[k] === MASK) continue; // unchanged
    patch[k] = b[k];
  }
  await SettingModel.setMany(patch);
  const logged = { ...patch };
  for (const k of SECRET) if (logged[k]) logged[k] = '***';
  await LogModel.audit({ user: req.user, action: 'settings_update', entity: 'settings', details: logged, ip: clientIp(req) });
  res.json({ ok: true });
};

exports.testSms = async (req, res) => {
  const to = String(req.body?.to || '').trim() || undefined;
  const r = await sendSms(req.body?.message || 'Test SMS from Server Monitor ✔', { force: true, to });
  if (r.skipped) throw new HttpError(400, `SMS not sent: ${r.skipped}`);
  res.json(r);
};

exports.notifications = async (req, res) => {
  res.json(await LogModel.notifications(req.query.limit));
};

exports.audit = async (req, res) => {
  res.json(await LogModel.auditList(req.query.limit));
};

/* ------------------------------- rules ------------------------------ */

function validateRule(b) {
  if (!b.name?.trim()) throw new HttpError(400, 'Rule name is required');
  if (!RuleModel.METRICS.includes(b.metric)) throw new HttpError(400, 'Invalid metric');
  const w = b.warning_threshold === '' || b.warning_threshold == null ? null : Number(b.warning_threshold);
  const c = b.critical_threshold === '' || b.critical_threshold == null ? null : Number(b.critical_threshold);
  // "login" pages on every login (remote = critical, local = warning) – it has no thresholds
  if (w == null && c == null && b.metric !== 'login') throw new HttpError(400, 'Set a warning or critical threshold');
  if (w != null && c != null && c < w) throw new HttpError(400, 'Critical threshold must be ≥ warning threshold');
  return {
    name: b.name.trim(), metric: b.metric, warning_threshold: w, critical_threshold: c,
    duration_sec: Math.max(0, Number(b.duration_sec) || 0), server_id: b.server_id ? Number(b.server_id) : null,
    sms_enabled: !!Number(b.sms_enabled ?? 1), enabled: b.enabled === undefined ? true : !!Number(b.enabled),
  };
}

exports.listRules = async (req, res) => res.json(await RuleModel.list());

exports.createRule = async (req, res) => {
  const rule = validateRule(req.body || {});
  const id = await RuleModel.create(rule);
  await alertEngine.reloadRules();
  await LogModel.audit({ user: req.user, action: 'rule_create', entity: 'rule', entityId: id, details: rule, ip: clientIp(req) });
  res.status(201).json(await RuleModel.findById(id));
};

exports.updateRule = async (req, res) => {
  const id = Number(req.params.id);
  if (!(await RuleModel.findById(id))) throw new HttpError(404, 'Rule not found');
  const rule = validateRule(req.body || {});
  await RuleModel.update(id, rule);
  await alertEngine.reloadRules();
  await LogModel.audit({ user: req.user, action: 'rule_update', entity: 'rule', entityId: id, details: rule, ip: clientIp(req) });
  res.json(await RuleModel.findById(id));
};

exports.deleteRule = async (req, res) => {
  await RuleModel.remove(req.params.id);
  await alertEngine.reloadRules();
  await LogModel.audit({ user: req.user, action: 'rule_delete', entity: 'rule', entityId: req.params.id, ip: clientIp(req) });
  res.json({ ok: true });
};

/* ------------------------------- users ------------------------------ */

const ROLES = ['admin', 'operator', 'viewer'];

exports.listUsers = async (req, res) => res.json(await UserModel.list());

exports.createUser = async (req, res) => {
  const { name, username, password, role = 'viewer', phone } = req.body || {};
  if (!name || !username || !password) throw new HttpError(400, 'Name, username and password are required');
  if (password.length < 6) throw new HttpError(400, 'Password must be at least 6 characters');
  if (!ROLES.includes(role)) throw new HttpError(400, 'Invalid role');
  const id = await UserModel.create({ name, username: username.trim(), passwordHash: await bcrypt.hash(password, 10), role, phone });
  await LogModel.audit({ user: req.user, action: 'user_create', entity: 'user', entityId: id, details: { username, role }, ip: clientIp(req) });
  res.status(201).json(await UserModel.findById(id));
};

exports.updateUser = async (req, res) => {
  const id = Number(req.params.id);
  const b = req.body || {};
  if (b.role && !ROLES.includes(b.role)) throw new HttpError(400, 'Invalid role');
  if (id === req.user.id && (b.role && b.role !== 'admin' || b.is_active === 0 || b.is_active === false)) {
    throw new HttpError(400, 'You cannot demote or disable your own account');
  }
  await UserModel.update(id, {
    name: b.name, role: b.role, phone: b.phone, is_active: b.is_active === undefined ? undefined : b.is_active ? 1 : 0,
  });
  if (b.password) {
    if (b.password.length < 6) throw new HttpError(400, 'Password must be at least 6 characters');
    await UserModel.updatePassword(id, await bcrypt.hash(b.password, 10));
  }
  await LogModel.audit({ user: req.user, action: 'user_update', entity: 'user', entityId: id, details: { ...b, password: b.password ? '***' : undefined }, ip: clientIp(req) });
  res.json(await UserModel.findById(id));
};

exports.deleteUser = async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) throw new HttpError(400, 'You cannot delete your own account');
  await UserModel.remove(id);
  await LogModel.audit({ user: req.user, action: 'user_delete', entity: 'user', entityId: id, ip: clientIp(req) });
  res.json({ ok: true });
};
