/**
 * Greedy (Least Loaded) Scheduler
 * Assigns tasks to the server with the lowest current load score
 * Time Complexity: O(n) where n = number of servers
 * 
 * Best for: Real-time task placement where speed is critical
 */

function greedySchedule(task, servers) {
  const available = servers.filter(s => s.canFit(task));
  if (available.length === 0) return null;

  // Sort by composite load score (CPU 60% weight, memory 40% weight)
  available.sort((a, b) => a.loadScore - b.loadScore);
  const chosen = available[0];

  const avgLoad = servers
    .filter(s => s.status !== 'offline')
    .reduce((sum, s) => sum + s.loadScore, 0) /
    servers.filter(s => s.status !== 'offline').length;

  const capacityUsed = Math.round(
    ((chosen.usedCpu + task.cpu) / chosen.totalCpu) * 100
  );

  const log =
    `Task#${task.id} → ${chosen.name} ` +
    `(Greedy: ${Math.round(chosen.loadScore)}% load vs ${Math.round(avgLoad)}% avg, ` +
    `fits ${capacityUsed}% CPU capacity)`;

  return { server: chosen, log };
}

module.exports = { greedySchedule };
