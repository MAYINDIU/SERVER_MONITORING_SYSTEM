const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const env = require('../config/env');
const UserModel = require('../models/userModel');
const LogModel = require('../models/logModel');
const { HttpError, clientIp } = require('../utils/http');

const sign = (u) =>
  jwt.sign({ id: u.id, username: u.username, name: u.name, role: u.role }, env.jwtSecret, {
    expiresIn: env.jwtExpires,
  });

exports.login = async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) throw new HttpError(400, 'Username and password are required');
  const user = await UserModel.findByUsername(username);
  if (!user || !user.is_active || !(await bcrypt.compare(password, user.password_hash))) {
    await LogModel.audit({ user: { username }, action: 'login_failed', ip: clientIp(req) });
    throw new HttpError(401, 'Invalid username or password');
  }
  await UserModel.touchLogin(user.id);
  await LogModel.audit({ user, action: 'login', ip: clientIp(req) });
  res.json({
    token: sign(user),
    user: { id: user.id, name: user.name, username: user.username, role: user.role },
  });
};

exports.me = async (req, res) => {
  const user = await UserModel.findById(req.user.id);
  if (!user) throw new HttpError(401, 'User no longer exists');
  res.json(user);
};

exports.changePassword = async (req, res) => {
  const { current_password, new_password } = req.body || {};
  if (!new_password || new_password.length < 6) throw new HttpError(400, 'New password must be at least 6 characters');
  const user = await UserModel.findWithHashById(req.user.id);
  if (!(await bcrypt.compare(current_password || '', user.password_hash))) {
    throw new HttpError(400, 'Current password is incorrect');
  }
  await UserModel.updatePassword(user.id, await bcrypt.hash(new_password, 10));
  await LogModel.audit({ user: req.user, action: 'password_change', ip: clientIp(req) });
  res.json({ ok: true });
};
