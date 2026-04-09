/**
 * Priority Scheduler with Preemption Support
 * Assigns tasks based on priority (1-10) and deadline urgency
 * Supports preempting low-priority tasks for high-priority ones
 * 
 * Time Complexity: O(n log n) for priority queue operations
 * Best for: SLA-critical workloads, real-time systems
 */

/**
 * Calculate urgency score for a task (higher = more urgent)
 */
function getUrgency(task) {
  let score = task.priority * 10;

  if (task.deadline) {
    const msUntil = task.deadline - Date.now();
    const minutesUntil = msUntil / 60000;

    if (minutesUntil <= 0) score += 100;        // Already expired
    else if (minutesUntil <= 5) score += 50;    // Critical: < 5 min
    else if (minutesUntil <= 15) score += 30;   // Urgent: < 15 min
    else if (minutesUntil <= 60) score += 10;   // Soon: < 1 hour
  }

  return score;
}

/**
 * Find a low-priority task running on a server that could be preempted
 */
function findPreemptionCandidate(server, incomingTask, allTasks) {
  const PREEMPTION_THRESHOLD = 3; // Only preempt tasks with priority <= threshold
  if (incomingTask.priority < 8) return null; // Only preempt for very high priority

  const runningOnServer = allTasks.filter(
    t => t.status === 'running' && t.assignedServer === server.id && t.priority <= PREEMPTION_THRESHOLD
  );

  if (runningOnServer.length === 0) return null;

  // Return the lowest-priority running task
  return runningOnServer.reduce((lowest, t) =>
    t.priority < lowest.priority ? t : lowest
  );
}

function prioritySchedule(task, servers, allTasks = []) {
  const available = servers.filter(s => s.canFit(task));

  if (available.length > 0) {
    // Sort by load (prefer less loaded), break ties by server id
    available.sort((a, b) => a.loadScore - b.loadScore);
    const chosen = available[0];

    const urgency = getUrgency(task);
    const log =
      `Task#${task.id} → ${chosen.name} ` +
      `(Priority: urgency-score ${urgency}, priority ${task.priority}/10` +
      `${task.deadline ? ', deadline-driven' : ''}, ` +
      `load ${Math.round(chosen.loadScore)}%)`;

    return { server: chosen, log, preempted: null };
  }

  // No space available — try preemption
  if (task.priority >= 8 && allTasks.length > 0) {
    for (const server of servers.filter(s => s.status !== 'offline')) {
      const candidate = findPreemptionCandidate(server, task, allTasks);
      if (candidate) {
        const log =
          `Task#${task.id} → ${server.name} ` +
          `(Priority PREEMPTION: evicting Task#${candidate.id} ` +
          `[priority ${candidate.priority}] for incoming priority ${task.priority})`;
        return { server, log, preempted: candidate };
      }
    }
  }

  return null;
}

module.exports = { prioritySchedule, getUrgency };
