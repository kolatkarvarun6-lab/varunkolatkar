/**
 * Task Model
 * Represents a cloud workload task with resource requirements and scheduling metadata
 */

class Task {
  constructor({
    cpu,
    memory,
    executionTime,
    priority = 5,
    deadline = null,
    userId = 'anonymous',
    batchId = null,
  }) {
    this.id = Task.generateId();
    this.cpu = cpu;           // CPU percentage required (0-100)
    this.memory = memory;     // Memory in MB required
    this.executionTime = executionTime; // Execution time in seconds
    this.priority = Math.max(1, Math.min(10, priority)); // 1-10, higher = more important
    this.deadline = deadline ? new Date(deadline) : null;
    this.userId = userId;
    this.batchId = batchId;

    this.status = 'queued';   // queued | running | completed | failed | cancelled | preempted
    this.assignedServer = null;
    this.scheduledBy = null;  // Which algorithm scheduled this
    this.scheduledAt = null;
    this.startedAt = null;
    this.completedAt = null;
    this.createdAt = new Date();
    this.decisionLog = null;  // Human-readable scheduling decision

    // SLA tracking
    this.slaViolated = false;
    this.waitTime = 0;        // ms spent in queue
  }

  static generateId() {
    return ++Task._counter;
  }

  isDeadlineExpired() {
    if (!this.deadline) return false;
    return new Date() > this.deadline;
  }

  getUrgencyScore() {
    if (!this.deadline) return this.priority;
    const msUntilDeadline = this.deadline - new Date();
    const hoursUntilDeadline = msUntilDeadline / 3600000;
    if (hoursUntilDeadline <= 0) return 100;
    if (hoursUntilDeadline <= 1) return this.priority + 5;
    return this.priority;
  }

  toJSON() {
    return {
      id: this.id,
      cpu: this.cpu,
      memory: this.memory,
      executionTime: this.executionTime,
      priority: this.priority,
      deadline: this.deadline,
      userId: this.userId,
      batchId: this.batchId,
      status: this.status,
      assignedServer: this.assignedServer,
      scheduledBy: this.scheduledBy,
      scheduledAt: this.scheduledAt,
      startedAt: this.startedAt,
      completedAt: this.completedAt,
      createdAt: this.createdAt,
      decisionLog: this.decisionLog,
      slaViolated: this.slaViolated,
      waitTime: this.waitTime,
    };
  }
}

Task._counter = 0;

module.exports = Task;
