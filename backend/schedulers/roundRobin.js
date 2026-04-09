/**
 * Round Robin Scheduler with Time Slicing
 * Distributes tasks fairly across all servers in circular order
 * Simulates time-sliced CPU sharing
 * 
 * Time Complexity: O(n) - single pass through servers
 * Best for: Fair workload distribution, multi-tenant environments
 */

let rrIndex = 0;
const TIME_QUANTUM_MS = 5000; // 5-second time quantum simulation

function roundRobinSchedule(task, servers) {
  const active = servers.filter(s => s.status !== 'offline' && s.status !== 'draining');
  if (active.length === 0) return null;

  let attempts = 0;
  while (attempts < active.length) {
    const server = active[rrIndex % active.length];
    rrIndex = (rrIndex + 1) % active.length;
    attempts++;

    if (server.canFit(task)) {
      const timeSlice = Math.min(task.executionTime * 1000, TIME_QUANTUM_MS);
      const log =
        `Task#${task.id} → ${server.name} ` +
        `(Round Robin: slot ${rrIndex}/${active.length}, ` +
        `time-quantum ${timeSlice}ms, load ${Math.round(server.loadScore)}%)`;

      return { server, log };
    }
  }

  return null;
}

function resetRrIndex() {
  rrIndex = 0;
}

module.exports = { roundRobinSchedule, resetRrIndex, TIME_QUANTUM_MS };
