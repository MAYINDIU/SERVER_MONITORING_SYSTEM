const http = require('http');
const env = require('./config/env');
const { pool, query } = require('./config/db');
const { ensureSchema } = require('./database/upgrade');
const app = require('./app');
const { initSocket } = require('./services/socket');
const alertEngine = require('./services/alertEngine');
const scheduler = require('./services/scheduler');
const liveCache = require('./services/liveCache');
const MetricModel = require('./models/metricModel');

async function main() {
  // fail fast if the database is unreachable
  await pool.query('SELECT 1');
  console.log(`✔ MySQL connected (${env.db.host}:${env.db.port}/${env.db.database})`);
  await ensureSchema(query);

  // warm the live cache so the dashboard has numbers immediately after a restart
  for (const m of await MetricModel.latestPerServer()) liveCache.set(m.server_id, m);

  const server = http.createServer(app);
  initSocket(server);
  await alertEngine.init();
  scheduler.start();

  server.listen(env.port, '0.0.0.0', () => {
    console.log(`✔ API + Socket.IO listening on http://0.0.0.0:${env.port}`);
  });
}

main().catch((err) => {
  console.error('Startup failed:', err.message);
  if (err.code === 'ER_BAD_DB_ERROR') console.error('→ Run "npm run migrate" first to create the database.');
  if (err.code === 'ECONNREFUSED') console.error('→ Is MySQL running? Check DB_HOST / DB_PORT in server/.env');
  process.exit(1);
});

process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err));
