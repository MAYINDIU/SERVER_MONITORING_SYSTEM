/**
 * In-memory snapshot of the latest sample for every server.
 * Lets the dashboard/overview render instantly without hitting the metrics table.
 */
const latest = new Map(); // serverId -> sample

module.exports = {
  set(serverId, sample) {
    latest.set(Number(serverId), sample);
  },
  get(serverId) {
    return latest.get(Number(serverId)) || null;
  },
  all() {
    return Object.fromEntries(latest);
  },
  remove(serverId) {
    latest.delete(Number(serverId));
  },
};
