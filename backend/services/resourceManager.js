/**
 * Resource Manager Service
 * Handles OS-level CPU/Memory simulation, process lifecycle,
 * auto-scaling, and resource contention detection
 */

const Server = require('../models/Server');

const DEFAULT_SERVERS = [
  { id: 1, totalCpu: 100, totalMemory: 4096, region: 'us-east-1' },
  { id: 2, totalCpu: 100, totalMemory: 4096, region: 'us-east-1' },
  { id: 3, totalCpu: 80,  totalMemory: 2048, region: 'us-west-2' },
  { id: 4, totalCpu: 80,  totalMemory: 2048, region: 'us-west-2' },
];

const AUTO_SCALE_UP_THRESHOLD = 80;   // % avg load -> add server
const AUTO_SCALE_DOWN_THRESHOLD = 20; // % avg load -> remove server
const MAX_SERVERS = 8;
const MIN_SERVERS = 2;

class ResourceManager {
  constructor() {
    this.servers = DEFAULT_SERVERS.map(cfg => new Server(cfg));
    this.nextServerId = DEFAULT_SERVERS.length + 1;
    this.decisionLog = [];        // Array of log entries
    this.autoScaleLog = [];
    this.metrics = {
      totalTasksScheduled: 0,
      totalTasksCompleted: 0,
      totalTasksFailed: 0,
      totalTasksCancelled: 0,
      slaViolations: 0,
      contextSwitches: 0,
      autoScaleEvents: 0,
    };

    // Start metrics collection loop
    this._metricsInterval = setInterval(() => this._collectMetrics(), 2000);
    // Start auto-scaler
    this._autoScaleInterval = setInterval(() => this._autoScale(), 5000);
  }

  // ─── Server Management ──────────────────────────────────────────────────────

  getServers() {
    return this.servers;
  }

  getServer(id) {
    return this.servers.find(s => s.id === id);
  }

  addServer(config = {}) {
    if (this.servers.length >= MAX_SERVERS) return null;
    const server = new Server({
      id: this.nextServerId++,
      totalCpu: config.totalCpu || 100,
      totalMemory: config.totalMemory || 4096,
      region: config.region || 'auto-scaled',
    });
    this.servers.push(server);
    this.logAutoScale(`Auto-scaled UP: added ${server.name} (total: ${this.servers.length} servers)`);
    this.metrics.autoScaleEvents++;
    return server;
  }

  removeServer(id) {
    const idx = this.servers.findIndex(s => s.id === id);
    if (idx === -1) return false;
    if (this.servers.length <= MIN_SERVERS) return false;
    const server = this.servers[idx];
    if (server.tasks.length > 0) {
      server.status = 'draining'; // Mark for graceful drain
      return true;
    }
    this.servers.splice(idx, 1);
    this.logAutoScale(`Auto-scaled DOWN: removed ${server.name} (total: ${this.servers.length} servers)`);
    return true;
  }

  // ─── Resource Allocation / Deallocation ────────────────────────────────────

  /**
   * Allocate resources for a task on a specific server
   * Returns false if resources are insufficient (overcommitment rejection)
   */
  allocate(task, server) {
    if (!server.canFit(task)) {
      // Overcommitment rejection
      this.logDecision(
        `REJECTED Task#${task.id} on ${server.name}: ` +
        `needs ${task.cpu}% CPU/${task.memory}MB but only ` +
        `${server.availableCpu.toFixed(1)}% CPU/${server.availableMemory}MB available`
      );
      return false;
    }
    server.allocate(task);
    this.metrics.totalTasksScheduled++;
    this.metrics.contextSwitches += server.contextSwitches;
    return true;
  }

  /**
   * Deallocate resources when a task completes or is cancelled
   */
  deallocate(task) {
    if (task.assignedServer == null) return false;
    const server = this.getServer(task.assignedServer);
    if (!server) return false;
    const ok = server.deallocate(task);
    if (ok) {
      // If server was draining and now empty, remove it
      if (server.status === 'draining' && server.tasks.length === 0) {
        const idx = this.servers.findIndex(s => s.id === server.id);
        if (idx !== -1) {
          this.servers.splice(idx, 1);
          this.logAutoScale(`Drained and removed ${server.name}`);
        }
      }
    }
    return ok;
  }

  // ─── Decision Logging ───────────────────────────────────────────────────────

  logDecision(message) {
    const entry = { timestamp: new Date(), message };
    this.decisionLog.unshift(entry);
    if (this.decisionLog.length > 500) this.decisionLog.pop();
    return entry;
  }

  logAutoScale(message) {
    const entry = { timestamp: new Date(), message };
    this.autoScaleLog.unshift(entry);
    if (this.autoScaleLog.length > 100) this.autoScaleLog.pop();
    console.log(`[AutoScale] ${message}`);
  }

  getDecisionLog(limit = 50) {
    return this.decisionLog.slice(0, limit);
  }

  // ─── System Metrics ─────────────────────────────────────────────────────────

  getSystemMetrics() {
    const active = this.servers.filter(s => s.status !== 'offline');
    const avgCpu = active.length
      ? active.reduce((s, srv) => s + srv.cpuUtilization, 0) / active.length
      : 0;
    const avgMemory = active.length
      ? active.reduce((s, srv) => s + srv.memoryUtilization, 0) / active.length
      : 0;
    const totalTasks = active.reduce((s, srv) => s + srv.tasks.length, 0);

    return {
      serverCount: this.servers.length,
      activeServers: active.length,
      avgCpuUtilization: Math.round(avgCpu * 10) / 10,
      avgMemoryUtilization: Math.round(avgMemory * 10) / 10,
      activeTasks: totalTasks,
      ...this.metrics,
      autoScaleLog: this.autoScaleLog.slice(0, 10),
    };
  }

  // ─── Auto-Scaling Logic ─────────────────────────────────────────────────────

  _autoScale() {
    const active = this.servers.filter(s => s.status !== 'offline');
    if (active.length === 0) return;

    const avgLoad = active.reduce((s, srv) => s + srv.loadScore, 0) / active.length;

    if (avgLoad > AUTO_SCALE_UP_THRESHOLD && active.length < MAX_SERVERS) {
      this.addServer();
    } else if (avgLoad < AUTO_SCALE_DOWN_THRESHOLD && active.length > MIN_SERVERS) {
      // Remove least loaded server with no tasks
      const empty = active
        .filter(s => s.tasks.length === 0)
        .sort((a, b) => a.loadScore - b.loadScore);
      if (empty.length > 0) {
        this.removeServer(empty[0].id);
      }
    }
  }

  _collectMetrics() {
    this.servers.forEach(s => s.recordMetrics());
  }

  // ─── Resource Contention Detection ─────────────────────────────────────────

  getContentionReport() {
    return this.servers
      .filter(s => s.status === 'overloaded')
      .map(s => ({
        server: s.name,
        cpuUtilization: s.cpuUtilization,
        memoryUtilization: s.memoryUtilization,
        taskCount: s.tasks.length,
        recommendation: 'Migrate tasks or scale up',
      }));
  }

  // Cleanup intervals on shutdown
  destroy() {
    clearInterval(this._metricsInterval);
    clearInterval(this._autoScaleInterval);
  }
}

// Singleton instance
module.exports = new ResourceManager();
