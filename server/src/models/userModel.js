const { query, queryOne } = require('../config/db');

const PUBLIC_COLS = 'id, name, username, role, phone, is_active, last_login_at, created_at';

const UserModel = {
  findByUsername(username) {
    return queryOne('SELECT * FROM users WHERE username = ? LIMIT 1', [username]);
  },

  findById(id) {
    return queryOne(`SELECT ${PUBLIC_COLS} FROM users WHERE id = ?`, [id]);
  },

  findWithHashById(id) {
    return queryOne('SELECT * FROM users WHERE id = ?', [id]);
  },

  list() {
    return query(`SELECT ${PUBLIC_COLS} FROM users ORDER BY id`);
  },

  async create({ name, username, passwordHash, role, phone }) {
    const r = await query(
      'INSERT INTO users (name, username, password_hash, role, phone) VALUES (?, ?, ?, ?, ?)',
      [name, username, passwordHash, role, phone || null]
    );
    return r.insertId;
  },

  update(id, { name, role, phone, is_active }) {
    return query(
      `UPDATE users SET name = COALESCE(?, name), role = COALESCE(?, role),
              phone = ?, is_active = COALESCE(?, is_active)
        WHERE id = ?`,
      [name ?? null, role ?? null, phone || null, is_active ?? null, id]
    );
  },

  updatePassword(id, passwordHash) {
    return query('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, id]);
  },

  touchLogin(id) {
    return query('UPDATE users SET last_login_at = UTC_TIMESTAMP() WHERE id = ?', [id]);
  },

  remove(id) {
    return query('DELETE FROM users WHERE id = ?', [id]);
  },

  countAdmins() {
    return queryOne("SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND is_active = 1");
  },
};

module.exports = UserModel;
