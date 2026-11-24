function notFound(req, res) {
  res.status(404).json({ message: `Route not found: ${req.method} ${req.originalUrl}` });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  let status = err.status || 500;
  let message = err.message || 'Server error';
  if (err.code === 'ER_DUP_ENTRY') {
    status = 409;
    message = 'Duplicate value – record already exists';
  }
  if (status >= 500) console.error('[error]', req.method, req.originalUrl, err);
  res.status(status).json({ message });
}

module.exports = { notFound, errorHandler };
