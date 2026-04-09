/**
 * 0-1 Knapsack Scheduler
 * Batch-optimizes task placement to maximize server utilization
 * Time Complexity: O(n * W) where n = tasks, W = capacity
 * 
 * Best for: Batch job optimization, offline scheduling, high-utilization workloads
 * Uses CPU as the "weight" and priority as the "value"
 */

/**
 * Solve 0-1 Knapsack: maximize value (priority sum) given CPU capacity
 * @param {Task[]} tasks - Pending tasks to schedule
 * @param {number} capacity - Available CPU units (whole number)
 * @returns {Task[]} - Optimal subset of tasks to run
 */
function knapsackSolve(tasks, capacity) {
  const n = tasks.length;
  const W = Math.floor(capacity);

  // DP table: dp[i][w] = max priority value using first i tasks with w CPU
  const dp = Array.from({ length: n + 1 }, () => new Array(W + 1).fill(0));

  for (let i = 1; i <= n; i++) {
    const weight = Math.ceil(tasks[i - 1].cpu);
    const value = tasks[i - 1].priority;
    for (let w = 0; w <= W; w++) {
      dp[i][w] = dp[i - 1][w];
      if (weight <= w) {
        dp[i][w] = Math.max(dp[i][w], dp[i - 1][w - weight] + value);
      }
    }
  }

  // Backtrack to find selected tasks
  const selected = [];
  let w = W;
  for (let i = n; i > 0; i--) {
    if (dp[i][w] !== dp[i - 1][w]) {
      selected.push(tasks[i - 1]);
      w -= Math.ceil(tasks[i - 1].cpu);
    }
  }

  return selected;
}

/**
 * Schedule a single task using knapsack logic against available servers
 */
function knapsackSchedule(task, servers) {
  const available = servers.filter(s => s.canFit(task));
  if (available.length === 0) return null;

  // Find server where adding this task maximizes overall utilization
  // Score = how well this task fills the server's remaining capacity
  let bestServer = null;
  let bestScore = -1;

  for (const server of available) {
    const cpuFillRatio = task.cpu / server.availableCpu;
    const memFillRatio = task.memory / server.availableMemory;
    const fillScore = (cpuFillRatio * 0.6 + memFillRatio * 0.4);

    // Prefer servers that are already loaded (pack them) but not overloaded
    const packingBonus = server.loadScore / 100;
    const score = fillScore + packingBonus * 0.3;

    if (score > bestScore) {
      bestScore = score;
      bestServer = server;
    }
  }

  if (!bestServer) return null;

  const utilizationAfter = Math.round(
    ((bestServer.usedCpu + task.cpu) / bestServer.totalCpu) * 100
  );

  const log =
    `Task#${task.id} → ${bestServer.name} ` +
    `(Knapsack: fill-score ${Math.round(bestScore * 100)}%, ` +
    `utilization after ${utilizationAfter}%, priority-value ${task.priority})`;

  return { server: bestServer, log };
}

/**
 * Batch schedule multiple tasks using 0-1 Knapsack optimization
 * @param {Task[]} tasks - Batch of queued tasks
 * @param {Server} server - Target server
 * @returns {{ scheduled: Task[], log: string }}
 */
function knapsackBatch(tasks, server) {
  const selected = knapsackSolve(tasks, server.availableCpu);
  const log =
    `Knapsack batch: selected ${selected.length}/${tasks.length} tasks ` +
    `for ${server.name} (priority sum: ${selected.reduce((s, t) => s + t.priority, 0)}, ` +
    `CPU used: ${selected.reduce((s, t) => s + t.cpu, 0).toFixed(1)}/${server.availableCpu.toFixed(1)})`;

  return { scheduled: selected, log };
}

module.exports = { knapsackSchedule, knapsackBatch, knapsackSolve };
