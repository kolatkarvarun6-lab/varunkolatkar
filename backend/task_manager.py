"""
task_manager.py - Task schema, priority queue, deadline/SLA tracking, multi-tenant support
"""
import uuid
import time
import heapq
import threading
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional, List, Dict


class TaskStatus(str, Enum):
    NEW = "NEW"
    READY = "READY"
    RUNNING = "RUNNING"
    WAITING = "WAITING"
    COMPLETED = "COMPLETED"
    TERMINATED = "TERMINATED"
    PREEMPTED = "PREEMPTED"
    FAILED = "FAILED"


@dataclass
class Task:
    task_id: str = field(default_factory=lambda: str(uuid.uuid4())[:8])
    name: str = ""
    cpu_required: float = 1.0        # CPU cores required
    memory_required: float = 256.0   # MB of memory required
    execution_time: float = 5.0      # Expected execution time in seconds
    priority: int = 5                # 1 (lowest) to 10 (highest)
    deadline: Optional[float] = None # Unix timestamp deadline
    user_id: str = "default"         # Multi-tenant user ID
    tenant_id: str = "default"       # Tenant identifier
    status: TaskStatus = TaskStatus.NEW
    created_at: float = field(default_factory=time.time)
    started_at: Optional[float] = None
    completed_at: Optional[float] = None
    assigned_server: Optional[str] = None
    algorithm_used: Optional[str] = None
    decision_log: str = ""
    batch_id: Optional[str] = None   # For batch processing
    sla_threshold: float = 10.0      # Max acceptable response time (seconds)
    sla_met: Optional[bool] = None
    progress: float = 0.0            # 0-100%
    tags: List[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "task_id": self.task_id,
            "name": self.name,
            "cpu_required": self.cpu_required,
            "memory_required": self.memory_required,
            "execution_time": self.execution_time,
            "priority": self.priority,
            "deadline": self.deadline,
            "user_id": self.user_id,
            "tenant_id": self.tenant_id,
            "status": self.status.value,
            "created_at": self.created_at,
            "started_at": self.started_at,
            "completed_at": self.completed_at,
            "assigned_server": self.assigned_server,
            "algorithm_used": self.algorithm_used,
            "decision_log": self.decision_log,
            "batch_id": self.batch_id,
            "sla_threshold": self.sla_threshold,
            "sla_met": self.sla_met,
            "progress": self.progress,
            "tags": self.tags,
        }

    def time_to_deadline(self) -> Optional[float]:
        if self.deadline is None:
            return None
        return self.deadline - time.time()

    def is_overdue(self) -> bool:
        ttd = self.time_to_deadline()
        return ttd is not None and ttd < 0

    def effective_priority(self) -> float:
        """Compute urgency-adjusted priority for scheduling."""
        p = float(self.priority)
        ttd = self.time_to_deadline()
        if ttd is not None:
            if ttd < 0:
                p += 5   # Overdue – boost heavily
            elif ttd < 5:
                p += 3
            elif ttd < 15:
                p += 1
        return p


class PriorityQueue:
    """Thread-safe min-heap priority queue (higher effective_priority = popped first)."""

    def __init__(self):
        self._heap: list = []
        self._lock = threading.Lock()
        self._counter = 0  # Tie-breaker

    def push(self, task: Task):
        with self._lock:
            # Negate so highest effective_priority is popped first
            neg_pri = -task.effective_priority()
            heapq.heappush(self._heap, (neg_pri, self._counter, task))
            self._counter += 1

    def pop(self) -> Optional[Task]:
        with self._lock:
            if self._heap:
                _, _, task = heapq.heappop(self._heap)
                return task
            return None

    def peek(self) -> Optional[Task]:
        with self._lock:
            if self._heap:
                return self._heap[0][2]
            return None

    def preempt_lower(self, min_priority: float) -> List[Task]:
        """Remove all tasks with effective_priority < min_priority (preemption)."""
        with self._lock:
            remaining = []
            preempted = []
            for neg_pri, cnt, task in self._heap:
                if -neg_pri < min_priority:
                    task.status = TaskStatus.PREEMPTED
                    preempted.append(task)
                else:
                    remaining.append((neg_pri, cnt, task))
            heapq.heapify(remaining)
            self._heap = remaining
            return preempted

    def size(self) -> int:
        with self._lock:
            return len(self._heap)

    def all_tasks(self) -> List[Task]:
        with self._lock:
            return [t for _, _, t in self._heap]


class TaskRegistry:
    """Central store for all tasks across tenants."""

    def __init__(self):
        self._tasks: Dict[str, Task] = {}
        self._lock = threading.Lock()

    def register(self, task: Task):
        with self._lock:
            self._tasks[task.task_id] = task

    def get(self, task_id: str) -> Optional[Task]:
        with self._lock:
            return self._tasks.get(task_id)

    def update_status(self, task_id: str, status: TaskStatus):
        with self._lock:
            if task_id in self._tasks:
                self._tasks[task_id].status = status

    def delete(self, task_id: str) -> bool:
        with self._lock:
            if task_id in self._tasks:
                del self._tasks[task_id]
                return True
            return False

    def all(self) -> List[Task]:
        with self._lock:
            return list(self._tasks.values())

    def by_tenant(self, tenant_id: str) -> List[Task]:
        with self._lock:
            return [t for t in self._tasks.values() if t.tenant_id == tenant_id]

    def stats(self) -> dict:
        with self._lock:
            tasks = list(self._tasks.values())
            total = len(tasks)
            by_status: Dict[str, int] = {}
            sla_met = sla_missed = 0
            for t in tasks:
                key = t.status.value
                by_status[key] = by_status.get(key, 0) + 1
                if t.sla_met is True:
                    sla_met += 1
                elif t.sla_met is False:
                    sla_missed += 1
            return {
                "total": total,
                "by_status": by_status,
                "sla_met": sla_met,
                "sla_missed": sla_missed,
            }


# Batch processing helpers
def create_batch(tasks: List[Task]) -> str:
    batch_id = str(uuid.uuid4())[:8]
    for t in tasks:
        t.batch_id = batch_id
    return batch_id
