/**
 * Status / System Routes
 * GET  /api/status           - Full system status
 * GET  /api/servers          - Server list with metrics
 * GET  /api/servers/:id      - Single server details
 * POST /api/servers          - Add a server
 * DELETE /api/servers/:id    - Remove / drain a server
 * GET  /api/queue            - Current task queue
 * GET  /api/decisions        - Scheduler decision log
 * POST /api/scheduler        - Change scheduling algorithm
 * GET  /api/scheduler/stats  - Per-algorithm performance stats
 * GET  /api/contention       - Resource contention report
 */

const express = require('express');
const router = express.Router();
const resourceManager = require('../services/resourceManager');
const taskService = require('../services/taskService');

// GET /api/status - Comprehensive system status
router.get('/status', (req, res) => {
  const metrics = resourceManager.getSystemMetrics();
  const queue = taskService.getQueue();
  const allTasks = taskService.getAllTasks();

  const statusCounts = {};
  for (const t of allTasks) {
    statusCounts[t.status] = (statusCounts[t.status] || 0) + 1;
  }

  res.json({
    success: true,
    timestamp: new Date(),
    algorithm: taskService.getAlgorithm(),
    systemMetrics: metrics,
    servers: resourceManager.getServers().map(s => s.toJSON()),
    queueDepth: queue.length,
    taskStatusCounts: statusCounts,
    recentDecisions: resourceManager.getDecisionLog(10),
    contentionReport: resourceManager.getContentionReport(),
  });
});

// GET /api/servers
router.get('/servers', (req, res) => {
  res.json({
    success: true,
    count: resourceManager.getServers().length,
    servers: resourceManager.getServers().map(s => s.toJSON()),
  });
});

// GET /api/servers/:id
router.get('/servers/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const server = resourceManager.getServer(id);
  if (!server) return res.status(404).json({ success: false, error: `Server#${id} not found` });
  res.json({ success: true, server: server.toJSON() });
});

// POST /api/servers - Manually add a server
router.post('/servers', (req, res) => {
  const server = resourceManager.addServer(req.body);
  if (!server) {
    return res.status(400).json({ success: false, error: 'Maximum server limit reached (8)' });
  }
  res.status(201).json({ success: true, server: server.toJSON(), message: `${server.name} added` });
});

// DELETE /api/servers/:id - Remove / drain a server
router.delete('/servers/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const ok = resourceManager.removeServer(id);
  if (!ok) {
    return res.status(400).json({
      success: false,
      error: 'Cannot remove server: minimum server count reached or server not found',
    });
  }
  res.json({ success: true, message: `Server#${id} removed/draining` });
});

// GET /api/queue
router.get('/queue', (req, res) => {
  const queue = taskService.getQueue();
  res.json({
    success: true,
    depth: queue.length,
    algorithm: taskService.getAlgorithm(),
    tasks: queue.map(t => t.toJSON()),
  });
});

// GET /api/decisions - Scheduler decision log
router.get('/decisions', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || 50, 10), 500);
  res.json({
    success: true,
    count: resourceManager.decisionLog.length,
    decisions: resourceManager.getDecisionLog(limit),
  });
});

// POST /api/scheduler - Change algorithm
router.post('/scheduler', (req, res) => {
  const { algorithm } = req.body;
  if (!algorithm) {
    return res.status(400).json({ success: false, error: 'algorithm field required' });
  }
  try {
    const algo = taskService.setAlgorithm(algorithm);
    res.json({
      success: true,
      algorithm: algo,
      message: `Scheduling algorithm changed to: ${algo}`,
      available: taskService.ALGORITHMS,
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// GET /api/scheduler/stats - Per-algorithm performance
router.get('/scheduler/stats', (req, res) => {
  res.json({
    success: true,
    currentAlgorithm: taskService.getAlgorithm(),
    algorithms: taskService.ALGORITHMS,
    stats: taskService.getAlgorithmStats(),
  });
});

// GET /api/contention - Resource contention report
router.get('/contention', (req, res) => {
  res.json({
    success: true,
    report: resourceManager.getContentionReport(),
    overloadedServers: resourceManager.getServers().filter(s => s.status === 'overloaded').length,
  });
});

module.exports = router;
