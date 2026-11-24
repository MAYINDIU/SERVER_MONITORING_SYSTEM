const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const env = require('../config/env');
const ServerModel = require('../models/serverModel');
const { HttpError } = require('../utils/http');

const bearer = (req) => {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : req.query.token || null;
};

/** Dashboard users (JWT). */
function requireAuth(req, res, next) {
  try {
    req.user = jwt.verify(bearer(req), env.jwtSecret);
    next();
  } catch {
    next(new HttpError(401, 'Not authenticated'));
  }
}

/** Role gate, e.g. requireRole('admin') or requireRole('admin','operator'). */
const requireRole =
  (...roles) =>
  (req, res, next) =>
    roles.includes(req.user?.role) ? next() : next(new HttpError(403, 'Insufficient permission'));

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

/** Monitoring agents (per-server token issued at registration). */
async function requireAgent(req, res, next) {
  try {
    const token = bearer(req);
    if (!token) throw new HttpError(401, 'Missing agent token');
    const server = await ServerModel.findByTokenHash(sha256(token));
    if (!server) throw new HttpError(401, 'Invalid agent token – re-register');
    req.server = server;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { requireAuth, requireRole, requireAgent, sha256 };
