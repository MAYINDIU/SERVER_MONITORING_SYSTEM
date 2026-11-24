/**
 * Generic HTTP SMS gateway client. Works with most bulk-SMS providers
 * (GET query-string or POST JSON). Configure in Settings → SMS.
 *
 * Placeholders usable in the URL and POST body:
 *   {to} {message} {api_key} {sender_id}
 */
const SettingModel = require('../models/settingModel');
const LogModel = require('../models/logModel');

const SEVERITY_RANK = { info: 1, warning: 2, critical: 3 };

function fill(template, vars, encode) {
  return String(template || '').replace(/\{(to|message|api_key|sender_id)\}/g, (_, k) => {
    const v = vars[k] ?? '';
    return encode ? encodeURIComponent(v) : JSON.stringify(String(v)).slice(1, -1);
  });
}

function recipientsOf(s) {
  return String(s.sms_recipients || '')
    .split(/[\s,;]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

async function sendOne(s, to, message) {
  const vars = { to, message, api_key: s.sms_api_key, sender_id: s.sms_sender_id };
  const method = String(s.sms_method || 'GET').toUpperCase();
  const url = fill(s.sms_api_url, vars, true);
  const opts = { method, signal: AbortSignal.timeout(10000) };
  if (method === 'POST') {
    opts.headers = { 'Content-Type': 'application/json' };
    opts.body = fill(s.sms_post_body, vars, false);
  }
  const res = await fetch(url, opts);
  const text = (await res.text()).slice(0, 500);
  return { ok: res.ok, response: `HTTP ${res.status} ${text}` };
}

/**
 * Send an SMS to every configured recipient.
 * @param {string} message
 * @param {object} [opt] { alertId, severity, force }  force = ignore enabled/min-severity (used by "Test")
 */
async function sendSms(message, opt = {}) {
  const s = await SettingModel.all();
  if (!opt.force) {
    if (s.sms_enabled !== '1') return { skipped: 'sms disabled' };
    const min = SEVERITY_RANK[s.sms_min_severity] || 3;
    if (opt.severity && (SEVERITY_RANK[opt.severity] || 0) < min) return { skipped: 'below min severity' };
  }
  const recipients = opt.to ? [opt.to] : recipientsOf(s);
  if (!recipients.length) return { skipped: 'no recipients' };
  if (!s.sms_api_url) return { skipped: 'no gateway url' };

  const results = [];
  for (const to of recipients) {
    let r;
    try {
      r = await sendOne(s, to, message);
    } catch (err) {
      r = { ok: false, response: err.message };
    }
    await LogModel.addNotification({
      alertId: opt.alertId || null,
      recipient: to,
      message,
      status: r.ok ? 'sent' : 'failed',
      response: r.response,
    }).catch(() => {});
    results.push({ to, ...r });
  }
  return { results };
}

module.exports = { sendSms, SEVERITY_RANK };
