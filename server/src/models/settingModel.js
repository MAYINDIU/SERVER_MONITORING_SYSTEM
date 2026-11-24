const { query } = require('../config/db');

let cache = null;
let cacheAt = 0;

const SettingModel = {
  /** Returns all settings as a plain object (cached for 30 s). */
  async all(force = false) {
    if (!force && cache && Date.now() - cacheAt < 30000) return cache;
    const rows = await query('SELECT `key`, `value` FROM settings');
    cache = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    cacheAt = Date.now();
    return cache;
  },

  async get(key, fallback = null) {
    const all = await this.all();
    return all[key] ?? fallback;
  },

  async setMany(obj) {
    const rows = Object.entries(obj).map(([k, v]) => [k, v == null ? null : String(v)]);
    if (!rows.length) return;
    await query(
      'INSERT INTO settings (`key`, `value`) VALUES ? ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)',
      [rows]
    );
    cache = null;
  },
};

module.exports = SettingModel;
