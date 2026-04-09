/**
 * Server Model
 * Represents a virtual server node in the cluster
 */

class Server {
  constructor({ id, totalCpu = 100, totalMemory = 4096, region = 'us-east-1' }) {
    this.id = id;
    this.name = `Server-${id}`;
    this.region = region;

    // Resources (CPU in %, Memory in MB)
    this.totalCpu = totalCpu;
    this.totalMemory = totalMemory;
    this.usedCpu = 0;
    this.usedMemory = 0;

    this.tasks = [];          // Active task IDs
    this.status = 'active';   // active | overloaded | draining | offline
    this.createdAt = new Date();

    // Metrics history (last 60 data points)
    this.cpuHistory = [];
    this.memoryHistory = [];
    this.taskHistory = [];

    // Context switching overhead tracking
    this.contextSwitches = 0;
    this.totalTasksProcessed = 0;
  }

  get availableCpu() {
    return this.totalCpu - this.usedCpu;
  }

  get availableMemory() {
    return this.totalMemory - this.usedMemory;
  }

  get cpuUtilization() {
    return (this.usedCpu / this.totalCpu) * 100;
  }

  get memoryUtilization() {
    return (this.usedMemory / this.totalMemory) * 100;
  }

  get loadScore() {
    // Combined load score (0-100) weighted average of CPU and memory
    return (this.cpuUtilization * 0.6 + this.memoryUtilization * 0.4);
  }

  canFit(task) {
    return (
      this.status !== 'offline' &&
      this.status !== 'draining' &&
      this.availableCpu >= task.cpu &&
      this.availableMemory >= task.memory
    );
  }

  allocate(task) {
    if (!this.canFit(task)) return false;
    this.usedCpu += task.cpu;
    this.usedMemory += task.memory;
    this.tasks.push(task.id);
    if (this.tasks.length > 1) this.contextSwitches++;
    this.updateStatus();
    return true;
  }

  deallocate(task) {
    const idx = this.tasks.indexOf(task.id);
    if (idx === -1) return false;
    this.usedCpu = Math.max(0, this.usedCpu - task.cpu);
    this.usedMemory = Math.max(0, this.usedMemory - task.memory);
    this.tasks.splice(idx, 1);
    this.totalTasksProcessed++;
    this.updateStatus();
    return true;
  }

  updateStatus() {
    if (this.status === 'offline' || this.status === 'draining') return;
    if (this.cpuUtilization >= 90 || this.memoryUtilization >= 90) {
      this.status = 'overloaded';
    } else {
      this.status = 'active';
    }
  }

  recordMetrics() {
    const now = Date.now();
    this.cpuHistory.push({ t: now, v: Math.round(this.cpuUtilization) });
    this.memoryHistory.push({ t: now, v: Math.round(this.memoryUtilization) });
    this.taskHistory.push({ t: now, v: this.tasks.length });
    // Keep only last 60 data points
    if (this.cpuHistory.length > 60) this.cpuHistory.shift();
    if (this.memoryHistory.length > 60) this.memoryHistory.shift();
    if (this.taskHistory.length > 60) this.taskHistory.shift();
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      region: this.region,
      totalCpu: this.totalCpu,
      totalMemory: this.totalMemory,
      usedCpu: Math.round(this.usedCpu * 10) / 10,
      usedMemory: Math.round(this.usedMemory),
      availableCpu: Math.round(this.availableCpu * 10) / 10,
      availableMemory: Math.round(this.availableMemory),
      cpuUtilization: Math.round(this.cpuUtilization * 10) / 10,
      memoryUtilization: Math.round(this.memoryUtilization * 10) / 10,
      loadScore: Math.round(this.loadScore * 10) / 10,
      taskCount: this.tasks.length,
      tasks: [...this.tasks],
      status: this.status,
      contextSwitches: this.contextSwitches,
      totalTasksProcessed: this.totalTasksProcessed,
      cpuHistory: this.cpuHistory,
      memoryHistory: this.memoryHistory,
    };
  }
}

module.exports = Server;
