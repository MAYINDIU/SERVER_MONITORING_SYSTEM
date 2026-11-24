# Server Monitoring System

Monitors your PCs and servers in real time. Each machine is identified by its IP address. Built with **React** (frontend), **Node.js/Express** (API), **MySQL/MariaDB** (raw SQL, MVC), and **Socket.IO** for live updates.

```
 PC / Server (agent.js) ──every 10 s──▶ Node API ──▶ MySQL (metrics, metrics_hourly, alerts …)
                                           │
                                           ├─▶ Alert engine ──▶ SMS gateway + incident log
                                           └─▶ Socket.IO ──▶ React dashboard (live gauges & charts)
```

## Features
- **Agent on every PC/server** (Windows/Linux). It collects CPU, RAM, swap, disk per volume, disk I/O, network ↓/↑, CPU temperature and uptime **every 10 s**. If the server can't be reached, the agent keeps up to 1 hour of samples and sends them once it reconnects.
- **History in MySQL.** Raw 10-second samples are kept for 30 days by default. They are rolled up into hourly data that is kept for 2 years and used for the 7-day, 30-day and 12-month reports. Old data is purged automatically.
- **Real-time dashboard.** Speedometer gauges, live charts, server tiles, top consumers and a live clock.
- **Alerts:**
  - Warning and critical thresholds per metric, with a minimum duration before an alert fires.
  - Global rules, plus per-server rules that override them.
  - **Offline detection** when no data arrives.
  - **Anomaly detection**, which flags sudden random spikes in CPU or RAM using a z-score against the last 10 minutes.
  - Each problem stays as a single alert instead of repeating, can escalate from warning to critical, and resolves itself when the machine recovers.
  - Each alert has a timeline and supports acknowledge, resolve and notes.
- **SMS** through any HTTP bulk-SMS gateway (GET or POST template). Settings include a minimum severity, a cooldown, an optional message on recovery, a test button and a delivery log.
- **Pop-up alerts and sound** in the browser as soon as something happens.
- **Reports:**
  - **All servers together:** load per server, fleet trend and availability.
  - **Server-wise:** averages and peaks, availability (SLA) and charts.
  - **Incidents:** MTTA, MTTR and incident counts per server and per metric.
  - Time ranges: hour, today, 24 h, 7 d, 30 d, 12 months or a custom range.
  - Export to **CSV**, or **Print / PDF**.
- **Users and roles** (admin / operator / viewer), JWT login and an **audit log**.

## Folder structure
```
server/                    Node.js API (MVC, raw SQL)
  src/config/              env + mysql2 pool
  src/database/            schema.sql + migrate.js
  src/models/              raw SQL queries only
  src/controllers/         request handling / business logic
  src/routes/              Express routers
  src/middleware/          JWT auth, agent token auth, errors
  src/services/            alertEngine, smsService, scheduler, socket, liveCache
agent/                     agent.js (install on every PC) + simulate.js (demo data)
client/                    React (Vite) dashboard
```

## Setup (monitoring server)
Requirements: Node.js 18+ and MySQL 5.7+/8 or MariaDB 10.1+ (XAMPP works).

```bash
# 1. API
cd server
cp .env.example .env          # edit DB_USER / DB_PASSWORD (default root / 123456), JWT_SECRET, AGENT_ENROLL_KEY
npm install
npm run migrate               # creates DB "server_monitor", tables, default rules, admin user
npm start                     # http://<server-ip>:5000

# 2. Dashboard (development)
cd ../client
npm install
npm run dev                   # http://<server-ip>:5173   (proxies /api to :5000)

# Production: build once and the API serves it on port 5000
npm run build
```

First login: **admin / 123456**. Change it right away in Users.

## Install the agent on each PC
1. Install Node.js 18+ on the PC.
2. Copy the `agent/` folder to the PC and run `npm install` inside it.
3. Create `agent/.env`:
   ```
   SERVER_URL=http://<monitoring-server-ip>:5000
   ENROLL_KEY=SCL-ENROLL-2026        # = AGENT_ENROLL_KEY in server/.env
   ```
4. Run `node agent.js`. The PC appears on the dashboard within 10 seconds.
5. To keep it running after a reboot:
   ```
   npm i -g pm2 pm2-windows-startup
   pm2 start agent.js --name sm-agent && pm2 save && pm2-startup install
   ```

On the monitoring server, open TCP port 5000 in the firewall.

**Demo without extra PCs:** `cd agent && npm run simulate` starts 5 fake servers. They produce random spikes, and one of them goes offline from time to time, so you can see alerts and SMS in action.

## SMS setup
Go to Settings → SMS gateway and enter your provider's URL using these placeholders:
```
https://api.your-sms.com/send?api_key={api_key}&senderid={sender_id}&number={to}&message={message}
```
Add the recipient numbers separated by commas, then use **Send test SMS**.

## Main API
| Method | Path | Purpose |
|---|---|---|
| POST | /api/auth/login | JWT login |
| POST | /api/agent/register | agent enrollment (enroll key) → per-server token |
| POST | /api/agent/metrics | agent push `{ samples:[…], disks:[…] }` |
| GET | /api/dashboard/overview | NOC overview |
| GET | /api/servers, /api/servers/:id, /:id/latest | servers + live samples |
| GET | /api/reports/fleet, /fleet/csv | all-servers report |
| GET | /api/reports/server/:id, /:id/csv | server-wise report |
| GET | /api/reports/alerts | incident statistics |
| GET/POST | /api/alerts, /:id/ack, /:id/resolve, /:id/notes | incidents |
| CRUD | /api/rules, /api/users, /api/settings | administration |

Socket.IO events: `metrics`, `server:status`, `server:registered`, `alert:new`, `alert:resolved`, `alert:updated`.
