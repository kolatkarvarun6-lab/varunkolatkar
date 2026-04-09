/**
 * First Come First Served (FCFS) Scheduler
 * Baseline scheduler - assigns tasks to the first available server
 * Time Complexity: O(1) - just check next server in sequence
 * 
 * Best for: Simple workloads, baseline benchmarking
 */

let nextServerIndex = 0;

function fcfsSchedule(task, servers) {
  const active = servers.filter(s => s.status !== 'offline' && s.status !== 'draining');
  if (active.length === 0) return null;

  // Try from current index onwards (wrap around)
  for (let i = 0; i < active.length; i++) {
    const idx = (nextServerIndex + i) % active.length;
    const server = active[idx];
    if (server.canFit(task)) {
      // Advance index for next call (not strictly FCFS but maintains fairness across servers)
      nextServerIndex = (idx + 1) % active.length;
      const log =
        `Task#${task.id} → ${server.name} ` +
        `(FCFS: first available server, position ${idx + 1}/${active.length}, ` +
        `load ${Math.round(server.loadScore)}%)`;
      return { server, log };
    }
  }
  return null;
}

function resetFcfsIndex() {
  nextServerIndex = 0;
}

module.exports = { fcfsSchedule, resetFcfsIndex };
