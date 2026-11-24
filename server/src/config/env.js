const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const env = {
  port: Number(process.env.PORT) || 5000,
  corsOrigin: process.env.CORS_ORIGIN || '*',
  tzOffsetMin:
    process.env.TZ_OFFSET_MIN !== undefined && process.env.TZ_OFFSET_MIN !== ''
      ? Number(process.env.TZ_OFFSET_MIN)
      : -new Date().getTimezoneOffset(),
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'server_monitor',
  },
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',
  jwtExpires: process.env.JWT_EXPIRES || '12h',
  enrollKey: process.env.AGENT_ENROLL_KEY || 'SCL-ENROLL-2026',
  adminUsername: process.env.ADMIN_USERNAME || 'admin',
  adminPassword: process.env.ADMIN_PASSWORD || '123456',
  // agents push every 10 seconds
  sampleIntervalSec: 10,
};

module.exports = env;
