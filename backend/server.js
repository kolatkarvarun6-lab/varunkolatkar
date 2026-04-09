/**
 * Cloud Resource Management Simulator - Main Server
 * Production-grade REST API with multi-algorithm scheduler
 */

'use strict';

const express = require('express');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');

const taskRoutes = require('./routes/tasks');
const statusRoutes = require('./routes/status');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Rate Limiting ────────────────────────────────────────────────────────────

// General API rate limit: 200 requests per minute per IP
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests, please try again later.' },
});

// Stricter limit for task creation: 60 tasks per minute per IP
const taskCreateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Task submission rate limit exceeded.' },
});

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (process.env.NODE_ENV !== 'test') {
      console.log(`${req.method} ${req.originalUrl} ${res.statusCode} [${duration}ms]`);
    }
  });
  next();
});

// ─── Serve Frontend ───────────────────────────────────────────────────────────

const frontendPath = path.join(__dirname, '..', 'frontend');
app.use(express.static(frontendPath));

// ─── API Routes ───────────────────────────────────────────────────────────────

app.use('/api/tasks', apiLimiter, taskCreateLimiter, taskRoutes);
app.use('/api', apiLimiter, statusRoutes);

// ─── Health Check ─────────────────────────────────────────────────────────────

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date(), version: '1.0.0' });
});

// ─── Root redirect ────────────────────────────────────────────────────────────

app.get('/', (req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});

// ─── 404 Handler ─────────────────────────────────────────────────────────────

app.use((req, res) => {
  res.status(404).json({ success: false, error: `Route ${req.originalUrl} not found` });
});

// ─── Error Handler ────────────────────────────────────────────────────────────

app.use((err, req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ success: false, error: 'Internal server error' });
});

// ─── Start Server ─────────────────────────────────────────────────────────────

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════════════════╗
║   Cloud Resource Management Simulator v1.0.0         ║
║   Server: http://localhost:${PORT}                      ║
║   Dashboard: http://localhost:${PORT}/                  ║
╚══════════════════════════════════════════════════════╝

Endpoints:
  POST   /api/tasks          - Submit a task
  POST   /api/tasks/batch    - Submit a task batch
  GET    /api/tasks          - List all tasks
  GET    /api/tasks/:id      - Get task details
  DELETE /api/tasks/:id      - Cancel a task
  GET    /api/status         - System overview
  GET    /api/servers        - Server list
  POST   /api/servers        - Add a server
  DELETE /api/servers/:id    - Remove a server
  GET    /api/queue          - Task queue
  GET    /api/decisions      - Scheduler decision log
  POST   /api/scheduler      - Change algorithm
  GET    /api/scheduler/stats - Algorithm performance
  GET    /api/contention     - Resource contention
  GET    /api/health         - Health check
`);
  });
}

module.exports = app;
