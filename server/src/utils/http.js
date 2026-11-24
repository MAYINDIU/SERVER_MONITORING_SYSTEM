/** Wrap async route handlers so thrown errors reach the error middleware. */
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const clientIp = (req) =>
  String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '')
    .split(',')[0]
    .trim()
    .replace(/^::ffff:/, '');

/** Parse LONGTEXT JSON columns safely (MariaDB returns strings, MySQL may return objects). */
const parseJson = (v, fallback = null) => {
  if (v == null) return fallback;
  if (typeof v === 'object') return v;
  try {
    return JSON.parse(v);
  } catch {
    return fallback;
  }
};

module.exports = { asyncHandler, HttpError, clientIp, parseJson };
