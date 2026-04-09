/**
 * Task Service
 * Orchestrates task lifecycle: creation, scheduling, execution simulation,
 * completion, and SLA tracking. Acts as the central coordinator between
 * scheduling algorithms and the resource manager.
 */

const Task = require('../models/Task');
const resourceManager = require('./resourceManager');
const { greedySchedule } = require('../schedulers/greedy');
const { knapsackSchedule } = require('../schedulers/knapsack');
const { fcfsSchedule } = require('../schedulers/fcfs');
const { prioritySchedule } = require('../schedulers/priority');
const { roundRobinSchedule } = require('../schedulers/roundRobin');

// All tasks in system (active + recent history)
const tasks = new Map();          // id -> Task
const queue = [];                 // Tasks waiting to be scheduled
let currentAlgorithm = 'greedy'; // Default scheduling algorithm

// Valid algorithms
const ALGORITHMS = ['greedy', 'knapsack', 'fcfs', 'priority', 'roundrobin'];

// Priority queue comparator (higher urgency = lower index)
function queueComparator(a, b) {
  return b.getUrgencyScore() - a.getUrgencyScore();
}

function sortQueue() {
  queue.sort(queueComparator);
}

// ─── Algorithm Selection ────────────────────────────────────────────────────

function setAlgorithm(algo) {
  const normalized = algo.toLowerCase().replace(/[-_\s]/g, '');
  if (!ALGORITHMS.includes(normalized)) {
    throw new Error(`Unknown algorithm "${algo}". Valid: ${ALGORITHMS.join(', ')}`);
  }
  currentAlgorithm = normalized;
  return currentAlgorithm;
}

function getAlgorithm() {
  return currentAlgorithm;
}

// ─── Scheduling ─────────────────────────────────────────────────────────────

function scheduleTask(task) {
  const servers = resourceManager.getServers();
  const allTasks = getAllTasks();
  let result = null;

  switch (currentAlgorithm) {
    case 'greedy':
      result = greedySchedule(task, servers);
      break;
    case 'knapsack':
      result = knapsackSchedule(task, servers);
      break;
    case 'fcfs':
      result = fcfsSchedule(task, servers);
      break;
    case 'priority':
      result = prioritySchedule(task, servers, allTasks);
      break;
    case 'roundrobin':
      result = roundRobinSchedule(task, servers);
      break;
    default:
      result = greedySchedule(task, servers);
  }

  if (!result) return false;

  const { server, log, preempted } = result;

  // Handle preemption: remove evicted task from server
  if (preempted) {
    preempted.status = 'preempted';
    preempted.completedAt = new Date();
    resourceManager.deallocate(preempted);
    resourceManager.logDecision(`PREEMPTED Task#${preempted.id} to make room for Task#${task.id}`);
    // Re-queue the preempted task
    preempted.status = 'queued';
    preempted.assignedServer = null;
    preempted.scheduledAt = null;
    preempted.startedAt = null;
    preempted.completedAt = null;
    queue.push(preempted);
    sortQueue();
  }

  // Allocate resources
  const allocated = resourceManager.allocate(task, server);
  if (!allocated) return false;

  // Update task state
  task.assignedServer = server.id;
  task.scheduledBy = currentAlgorithm;
  task.scheduledAt = new Date();
  task.startedAt = new Date();
  task.status = 'running';
  task.waitTime = task.startedAt - task.createdAt;
  task.decisionLog = log;

  resourceManager.logDecision(log);

  // Simulate task execution: complete after executionTime seconds
  const execMs = task.executionTime * 1000;
  setTimeout(() => completeTask(task.id), execMs);

  return true;
}

// ─── Task Creation ──────────────────────────────────────────────────────────

function createTask(params) {
  // Validate required fields
  if (!params.cpu || !params.memory || !params.executionTime) {
    throw new Error('Task requires cpu, memory, and executionTime fields');
  }
  if (params.cpu <= 0 || params.cpu > 100) {
    throw new Error('cpu must be between 1 and 100');
  }
  if (params.memory <= 0 || params.memory > 65536) {
    throw new Error('memory must be between 1 and 65536 MB');
  }
  if (params.executionTime <= 0 || params.executionTime > 3600) {
    throw new Error('executionTime must be between 1 and 3600 seconds');
  }

  const task = new Task(params);
  tasks.set(task.id, task);
  queue.push(task);
  sortQueue();

  // Try to schedule immediately
  const scheduled = tryScheduleFromQueue();
  if (!scheduled) {
    resourceManager.logDecision(
      `Task#${task.id} queued (no resources available, queue depth: ${queue.length})`
    );
  }

  return task;
}

/**
 * Create multiple tasks as a batch
 */
function createBatch(taskParamsList, batchId = null) {
  const bid = batchId || `batch-${Date.now()}`;
  const created = taskParamsList.map(params => {
    const task = new Task({ ...params, batchId: bid });
    tasks.set(task.id, task);
    queue.push(task);
    return task;
  });
  sortQueue();
  // Schedule as many as possible
  let scheduled = 0;
  while (queue.length > 0) {
    const ok = tryScheduleFromQueue();
    if (!ok) break;
    scheduled++;
  }
  resourceManager.logDecision(
    `Batch ${bid}: created ${created.length} tasks, scheduled ${scheduled} immediately`
  );
  return { batchId: bid, tasks: created, scheduled };
}

// ─── Task State Management ───────────────────────────────────────────────────

function completeTask(taskId) {
  const task = tasks.get(taskId);
  if (!task || task.status !== 'running') return false;

  task.status = 'completed';
  task.completedAt = new Date();

  // Check SLA: did it meet its deadline?
  if (task.deadline && task.completedAt > task.deadline) {
    task.slaViolated = true;
    resourceManager.metrics.slaViolations++;
    resourceManager.logDecision(
      `SLA VIOLATION: Task#${task.id} completed at ${task.completedAt.toISOString()} ` +
      `but deadline was ${task.deadline.toISOString()}`
    );
  }

  resourceManager.metrics.totalTasksCompleted++;
  resourceManager.deallocate(task);

  // Try to schedule queued tasks now that resources are free
  tryScheduleFromQueue();

  return true;
}

function cancelTask(taskId) {
  const task = tasks.get(taskId);
  if (!task) return null;

  const prevStatus = task.status;
  if (prevStatus === 'completed' || prevStatus === 'cancelled') return task;

  // Remove from queue if queued
  const qIdx = queue.findIndex(t => t.id === task.id);
  if (qIdx !== -1) queue.splice(qIdx, 1);

  // Deallocate if running
  if (prevStatus === 'running') {
    resourceManager.deallocate(task);
    resourceManager.metrics.totalTasksFailed++;
    tryScheduleFromQueue();
  }

  task.status = 'cancelled';
  task.completedAt = new Date();
  resourceManager.metrics.totalTasksCancelled++;
  resourceManager.logDecision(`Task#${task.id} cancelled (was: ${prevStatus})`);

  return task;
}

// ─── Queue Processing ────────────────────────────────────────────────────────

function tryScheduleFromQueue() {
  if (queue.length === 0) return false;

  // Check for deadline-expired tasks first
  queue.forEach(t => {
    if (t.isDeadlineExpired() && t.status === 'queued') {
      t.slaViolated = true;
      resourceManager.metrics.slaViolations++;
    }
  });

  const task = queue[0]; // Highest urgency task
  const scheduled = scheduleTask(task);
  if (scheduled) {
    queue.shift(); // Remove from queue
    return true;
  }
  return false;
}

// ─── Query ───────────────────────────────────────────────────────────────────

function getTask(id) {
  return tasks.get(id) || null;
}

function getAllTasks() {
  return Array.from(tasks.values());
}

function getQueue() {
  return [...queue];
}

function getTasksByStatus(status) {
  return getAllTasks().filter(t => t.status === status);
}

function getTasksByUser(userId) {
  return getAllTasks().filter(t => t.userId === userId);
}

function getAlgorithmStats() {
  const all = getAllTasks().filter(t => t.scheduledBy);
  const stats = {};
  for (const algo of ALGORITHMS) {
    const byAlgo = all.filter(t => t.scheduledBy === algo);
    const completed = byAlgo.filter(t => t.status === 'completed');
    stats[algo] = {
      scheduled: byAlgo.length,
      completed: completed.length,
      avgWaitTime: completed.length
        ? Math.round(completed.reduce((s, t) => s + t.waitTime, 0) / completed.length)
        : 0,
      slaViolations: byAlgo.filter(t => t.slaViolated).length,
    };
  }
  return stats;
}

module.exports = {
  createTask,
  createBatch,
  cancelTask,
  completeTask,
  getTask,
  getAllTasks,
  getQueue,
  getTasksByStatus,
  getTasksByUser,
  setAlgorithm,
  getAlgorithm,
  getAlgorithmStats,
  ALGORITHMS,
};
