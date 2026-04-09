/**
 * Integration tests for Cloud Resource Management Simulator
 * Tests all core requirements: scheduling algorithms, REST API, resource management
 */

'use strict';

const http = require('http');

let server;
let baseUrl;
let passed = 0;
let failed = 0;

// ─── Test Framework ───────────────────────────────────────────────────────────
function test(name, fn) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      console.log(`  ✅ ${name}`);
      passed++;
    })
    .catch(err => {
      console.error(`  ❌ ${name}: ${err.message}`);
      failed++;
    });
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'Assertion failed');
}

// ─── HTTP Helper ──────────────────────────────────────────────────────────────
async function req(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'localhost',
      port: baseUrl.port,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    };
    const req = http.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ─── Test Suites ──────────────────────────────────────────────────────────────
async function runTests() {
  console.log('\n🚀 Starting Cloud Resource Management Simulator Tests\n');

  // ── Health & Status ──────────────────────────────────────────────────────────
  console.log('📡 Health & Status');
  await test('GET /api/health returns 200', async () => {
    const { status, body } = await req('GET', '/api/health');
    assert(status === 200, `Expected 200, got ${status}`);
    assert(body.status === 'ok', 'Status should be ok');
  });

  await test('GET /api/status returns system info', async () => {
    const { status, body } = await req('GET', '/api/status');
    assert(status === 200, `Expected 200, got ${status}`);
    assert(body.success, 'Should succeed');
    assert(Array.isArray(body.servers), 'servers should be array');
    assert(body.servers.length >= 2, 'Should have at least 2 servers');
    assert(typeof body.systemMetrics === 'object', 'systemMetrics should be object');
    assert(typeof body.algorithm === 'string', 'algorithm should be string');
  });

  await test('GET /api/servers returns server list', async () => {
    const { status, body } = await req('GET', '/api/servers');
    assert(status === 200);
    assert(body.success);
    assert(body.count >= 2);
    const server = body.servers[0];
    assert(typeof server.cpuUtilization === 'number');
    assert(typeof server.memoryUtilization === 'number');
    assert(typeof server.loadScore === 'number');
    assert(typeof server.taskCount === 'number');
  });

  // ── Task Management ───────────────────────────────────────────────────────────
  console.log('\n📋 Task Management');

  let createdTaskId;
  await test('POST /api/tasks creates a task', async () => {
    const { status, body } = await req('POST', '/api/tasks', {
      cpu: 10,
      memory: 256,
      executionTime: 60,
      priority: 5,
      userId: 'testuser',
    });
    assert(status === 201, `Expected 201, got ${status}`);
    assert(body.success);
    assert(body.task.id > 0);
    assert(body.task.cpu === 10);
    assert(body.task.memory === 256);
    assert(['running', 'queued'].includes(body.task.status));
    createdTaskId = body.task.id;
  });

  await test('POST /api/tasks validates required fields', async () => {
    const { status, body } = await req('POST', '/api/tasks', { cpu: 10 });
    assert(status === 400);
    assert(!body.success);
    assert(body.error);
  });

  await test('POST /api/tasks validates CPU range', async () => {
    const { status, body } = await req('POST', '/api/tasks', {
      cpu: 150, memory: 256, executionTime: 10,
    });
    assert(status === 400);
    assert(body.error.includes('cpu'));
  });

  await test('GET /api/tasks/:id retrieves task', async () => {
    if (!createdTaskId) return;
    const { status, body } = await req('GET', `/api/tasks/${createdTaskId}`);
    assert(status === 200);
    assert(body.task.id === createdTaskId);
  });

  await test('GET /api/tasks returns list', async () => {
    const { status, body } = await req('GET', '/api/tasks');
    assert(status === 200);
    assert(body.success);
    assert(Array.isArray(body.tasks));
    assert(body.total >= 1);
  });

  await test('GET /api/tasks supports status filter', async () => {
    const { status, body } = await req('GET', '/api/tasks?status=running');
    assert(status === 200);
    assert(body.tasks.every(t => t.status === 'running'));
  });

  await test('DELETE /api/tasks/:id cancels a task', async () => {
    // Create a long-running task to cancel
    const create = await req('POST', '/api/tasks', {
      cpu: 5, memory: 128, executionTime: 3600, priority: 1,
    });
    const tid = create.body.task.id;
    const { status, body } = await req('DELETE', `/api/tasks/${tid}`);
    assert(status === 200);
    assert(body.success);
    assert(body.task.status === 'cancelled');
  });

  await test('DELETE /api/tasks/:id returns 404 for nonexistent', async () => {
    const { status } = await req('DELETE', '/api/tasks/99999');
    assert(status === 404);
  });

  // ── Batch Processing ─────────────────────────────────────────────────────────
  console.log('\n📦 Batch Processing');

  await test('POST /api/tasks/batch creates multiple tasks', async () => {
    const tasks = Array.from({ length: 5 }, (_, i) => ({
      cpu: 5 + i * 2,
      memory: 128 * (i + 1),
      executionTime: 30,
      priority: i + 1,
    }));
    const { status, body } = await req('POST', '/api/tasks/batch', { tasks });
    assert(status === 201, `Expected 201, got ${status}`);
    assert(body.success);
    assert(body.created === 5);
    assert(body.batchId);
    assert(Array.isArray(body.tasks));
    assert(body.tasks.every(t => t.batchId === body.batchId));
  });

  await test('POST /api/tasks/batch validates max size', async () => {
    const tasks = Array.from({ length: 101 }, () => ({ cpu: 1, memory: 128, executionTime: 1 }));
    const { status, body } = await req('POST', '/api/tasks/batch', { tasks });
    assert(status === 400);
    assert(body.error.includes('100'));
  });

  // ── Scheduling Algorithms ─────────────────────────────────────────────────────
  console.log('\n🤖 Scheduling Algorithms');
  const algorithms = [
    { value: 'greedy', label: 'Greedy' },
    { value: 'knapsack', label: '0-1 Knapsack' },
    { value: 'fcfs', label: 'FCFS' },
    { value: 'priority', label: 'Priority' },
    { value: 'roundrobin', label: 'Round Robin' },
  ];

  for (const { value, label } of algorithms) {
    await test(`POST /api/scheduler sets ${label} algorithm`, async () => {
      const { status, body } = await req('POST', '/api/scheduler', { algorithm: value });
      assert(status === 200, `Expected 200, got ${status}`);
      assert(body.success);
      assert(body.algorithm === value);
    });

    await test(`${label} schedules tasks correctly`, async () => {
      const { status, body } = await req('POST', '/api/tasks', {
        cpu: 10, memory: 256, executionTime: 30, priority: 5,
      });
      assert(status === 201);
      assert(body.success);
      assert(['running', 'queued'].includes(body.task.status));
      if (body.task.status === 'running') {
        assert(body.task.scheduledBy === value, `scheduledBy should be ${value}`);
        assert(body.task.decisionLog, 'Should have decision log');
        assert(body.task.decisionLog.includes(`Task#${body.task.id}`));
      }
    });
  }

  // ── Algorithm Stats ────────────────────────────────────────────────────────
  console.log('\n📊 Algorithm Statistics');
  await test('GET /api/scheduler/stats returns comparison data', async () => {
    const { status, body } = await req('GET', '/api/scheduler/stats');
    assert(status === 200);
    assert(body.success);
    assert(typeof body.stats === 'object');
    assert(body.currentAlgorithm);
    for (const algo of ['greedy', 'knapsack', 'fcfs', 'priority', 'roundrobin']) {
      assert(algo in body.stats, `Missing stats for ${algo}`);
      assert(typeof body.stats[algo].scheduled === 'number');
      assert(typeof body.stats[algo].completed === 'number');
    }
  });

  // ── Decision Logging ─────────────────────────────────────────────────────────
  console.log('\n📝 Decision Logging');
  await test('GET /api/decisions returns log entries', async () => {
    const { status, body } = await req('GET', '/api/decisions');
    assert(status === 200);
    assert(body.success);
    assert(Array.isArray(body.decisions));
    if (body.decisions.length > 0) {
      const entry = body.decisions[0];
      assert(entry.timestamp);
      assert(typeof entry.message === 'string');
      assert(entry.message.length > 0);
    }
  });

  await test('Decision log contains Task# references', async () => {
    const { body } = await req('GET', '/api/decisions?limit=100');
    const taskDecisions = body.decisions.filter(d => d.message.includes('Task#'));
    assert(taskDecisions.length > 0, 'Should have task-related decisions');
  });

  // ── Resource Management ───────────────────────────────────────────────────────
  console.log('\n⚙️  Resource Management');
  await test('POST /api/servers adds a server', async () => {
    const before = await req('GET', '/api/servers');
    const { status, body } = await req('POST', '/api/servers', {});
    assert(status === 201, `Expected 201, got ${status}`);
    assert(body.success);
    assert(body.server.id);
    const after = await req('GET', '/api/servers');
    assert(after.body.count === before.body.count + 1);
  });

  await test('DELETE /api/servers/:id removes a server', async () => {
    const servers = await req('GET', '/api/servers');
    const emptyServer = servers.body.servers.find(s => s.taskCount === 0);
    if (!emptyServer) { console.log('    (skipped: no empty server)'); return; }
    const { status, body } = await req('DELETE', `/api/servers/${emptyServer.id}`);
    assert(status === 200);
    assert(body.success);
  });

  await test('GET /api/contention returns contention report', async () => {
    const { status, body } = await req('GET', '/api/contention');
    assert(status === 200);
    assert(body.success);
    assert(Array.isArray(body.report));
  });

  // ── Priority & Preemption ──────────────────────────────────────────────────
  console.log('\n🔥 Priority & Preemption');
  await test('High-priority task has higher urgency score than low-priority', async () => {
    const { getUrgency } = require('../schedulers/priority');
    const high = { priority: 10, deadline: null };
    const low  = { priority: 1, deadline: null };
    assert(getUrgency(high) > getUrgency(low));
  });

  await test('Deadline-approaching task gets urgency boost', async () => {
    const { getUrgency } = require('../schedulers/priority');
    const urgent = { priority: 5, deadline: new Date(Date.now() + 4 * 60000) }; // 4 min
    const normal = { priority: 5, deadline: null };
    assert(getUrgency(urgent) > getUrgency(normal));
  });

  // ── Knapsack Algorithm ───────────────────────────────────────────────────────
  console.log('\n🎒 Knapsack Algorithm');
  await test('knapsackSolve selects optimal subset', async () => {
    const { knapsackSolve } = require('../schedulers/knapsack');
    const tasks = [
      { cpu: 30, priority: 3 },
      { cpu: 20, priority: 5 },
      { cpu: 25, priority: 4 },
      { cpu: 10, priority: 2 },
    ];
    const selected = knapsackSolve(tasks, 40);
    const totalCpu = selected.reduce((s, t) => s + Math.ceil(t.cpu), 0);
    const totalPriority = selected.reduce((s, t) => s + t.priority, 0);
    assert(totalCpu <= 40, `CPU ${totalCpu} exceeds capacity 40`);
    // Optimal should include task with cpu=20,priority=5 and cpu=10,priority=2
    assert(totalPriority >= 7, `Priority sum ${totalPriority} should be >= 7`);
  });

  // ── Queue Management ─────────────────────────────────────────────────────────
  console.log('\n📋 Queue Management');
  await test('GET /api/queue returns queue info', async () => {
    const { status, body } = await req('GET', '/api/queue');
    assert(status === 200);
    assert(body.success);
    assert(typeof body.depth === 'number');
    assert(Array.isArray(body.tasks));
  });

  // ── Summary ──────────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed === 0) {
    console.log('✅ All tests passed!\n');
  } else {
    console.log(`❌ ${failed} test(s) failed\n`);
    process.exitCode = 1;
  }
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────
async function main() {
  // Reset task counter for deterministic tests
  process.env.NODE_ENV = 'test';
  const app = require('../server');

  server = app.listen(0, async () => {
    baseUrl = { port: server.address().port };
    console.log(`Test server running on port ${baseUrl.port}`);
    try {
      await runTests();
    } finally {
      server.close();
      // Clean up resource manager intervals so process can exit
      const rm = require('../services/resourceManager');
      rm.destroy();
      // Exit after a short delay to let pending logs flush
      setTimeout(() => process.exit(failed > 0 ? 1 : 0), 200);
    }
  });
}

main().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
