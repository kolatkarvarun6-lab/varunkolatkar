/**
 * Tasks API Routes
 * POST   /api/tasks          - Create a single task
 * POST   /api/tasks/batch    - Create a batch of tasks
 * GET    /api/tasks          - List all tasks (with filters)
 * GET    /api/tasks/:id      - Get a specific task
 * DELETE /api/tasks/:id      - Cancel a task
 * GET    /api/queue          - View the pending task queue
 * GET    /api/decisions      - Get scheduler decision log
 * POST   /api/scheduler      - Change scheduling algorithm
 * GET    /api/scheduler/stats - Get per-algorithm statistics
 */

const express = require('express');
const router = express.Router();
const taskService = require('../services/taskService');
const resourceManager = require('../services/resourceManager');

// POST /api/tasks - Create a task
router.post('/', (req, res) => {
  try {
    const task = taskService.createTask(req.body);
    res.status(201).json({
      success: true,
      task: task.toJSON(),
      message: `Task#${task.id} created with status: ${task.status}`,
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// POST /api/tasks/batch - Create multiple tasks
router.post('/batch', (req, res) => {
  try {
    const { tasks, batchId } = req.body;
    if (!Array.isArray(tasks) || tasks.length === 0) {
      return res.status(400).json({ success: false, error: 'tasks must be a non-empty array' });
    }
    if (tasks.length > 100) {
      return res.status(400).json({ success: false, error: 'Batch size cannot exceed 100 tasks' });
    }
    const result = taskService.createBatch(tasks, batchId);
    res.status(201).json({
      success: true,
      batchId: result.batchId,
      created: result.tasks.length,
      scheduledImmediately: result.scheduled,
      tasks: result.tasks.map(t => t.toJSON()),
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// GET /api/tasks - List tasks with optional filters
router.get('/', (req, res) => {
  const { status, userId, batchId, algorithm, limit = 100, offset = 0 } = req.query;
  let result = taskService.getAllTasks();

  if (status) result = result.filter(t => t.status === status);
  if (userId) result = result.filter(t => t.userId === userId);
  if (batchId) result = result.filter(t => t.batchId === batchId);
  if (algorithm) result = result.filter(t => t.scheduledBy === algorithm);

  // Sort newest first
  result.sort((a, b) => b.createdAt - a.createdAt);

  const total = result.length;
  result = result.slice(Number(offset), Number(offset) + Number(limit));

  res.json({
    success: true,
    total,
    count: result.length,
    tasks: result.map(t => t.toJSON()),
  });
});

// GET /api/tasks/:id - Get specific task
router.get('/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const task = taskService.getTask(id);
  if (!task) return res.status(404).json({ success: false, error: `Task#${id} not found` });
  res.json({ success: true, task: task.toJSON() });
});

// DELETE /api/tasks/:id - Cancel a task
router.delete('/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const task = taskService.cancelTask(id);
  if (!task) return res.status(404).json({ success: false, error: `Task#${id} not found` });
  res.json({
    success: true,
    task: task.toJSON(),
    message: `Task#${id} cancelled`,
  });
});

module.exports = router;
