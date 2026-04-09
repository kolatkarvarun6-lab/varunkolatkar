"""
resource_manager.py - OS-level resource simulation
  - Process management with multi-threaded workers
  - Memory management with dynamic allocation/deallocation
  - CPU scheduling with realistic utilization
  - Resource contention and overcommitment rejection
  - Process state tracking
"""
import time
import uuid
import threading
import random
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Callable
from task_manager import Task, TaskStatus


# ──────────────────────────────────────────────
# Server / Node model
# ──────────────────────────────────────────────

@dataclass
class Server:
    server_id: str
    total_cpu: float       # Total CPU cores
    total_memory: float    # Total memory in MB
    used_cpu: float = 0.0
    used_memory: float = 0.0
    running_tasks: List[str] = field(default_factory=list)
    context_switches: int = 0
    is_healthy: bool = True

    @property
    def cpu_load(self) -> float:
        return (self.used_cpu / self.total_cpu * 100) if self.total_cpu > 0 else 0.0

    @property
    def memory_load(self) -> float:
        return (self.used_memory / self.total_memory * 100) if self.total_memory > 0 else 0.0

    @property
    def free_cpu(self) -> float:
        return self.total_cpu - self.used_cpu

    @property
    def free_memory(self) -> float:
        return self.total_memory - self.used_memory

    def can_fit(self, task: Task) -> bool:
        return (
            self.is_healthy
            and self.free_cpu >= task.cpu_required
            and self.free_memory >= task.memory_required
        )

    def allocate(self, task: Task):
        self.used_cpu += task.cpu_required
        self.used_memory += task.memory_required
        self.running_tasks.append(task.task_id)

    def release(self, task: Task):
        self.used_cpu = max(0.0, self.used_cpu - task.cpu_required)
        self.used_memory = max(0.0, self.used_memory - task.memory_required)
        if task.task_id in self.running_tasks:
            self.running_tasks.remove(task.task_id)
        self.context_switches += 1

    def to_dict(self) -> dict:
        return {
            "server_id": self.server_id,
            "total_cpu": self.total_cpu,
            "total_memory": self.total_memory,
            "used_cpu": round(self.used_cpu, 2),
            "used_memory": round(self.used_memory, 2),
            "cpu_load": round(self.cpu_load, 1),
            "memory_load": round(self.memory_load, 1),
            "free_cpu": round(self.free_cpu, 2),
            "free_memory": round(self.free_memory, 2),
            "running_tasks": list(self.running_tasks),
            "context_switches": self.context_switches,
            "is_healthy": self.is_healthy,
        }


# ──────────────────────────────────────────────
# Memory Management
# ──────────────────────────────────────────────

@dataclass
class MemoryBlock:
    block_id: str
    size: float       # MB
    task_id: str
    server_id: str
    allocated_at: float = field(default_factory=time.time)

    def age(self) -> float:
        return time.time() - self.allocated_at

    def to_dict(self) -> dict:
        return {
            "block_id": self.block_id,
            "size": self.size,
            "task_id": self.task_id,
            "server_id": self.server_id,
            "age": round(self.age(), 2),
        }


class MemoryManager:
    """Tracks memory allocations across all servers with LRU eviction policy."""

    def __init__(self):
        self._blocks: Dict[str, MemoryBlock] = {}  # block_id -> MemoryBlock
        self._lru_order: List[str] = []             # block_ids in LRU order
        self._lock = threading.Lock()

    def allocate(self, task: Task, server_id: str) -> str:
        with self._lock:
            block_id = str(uuid.uuid4())[:8]
            block = MemoryBlock(
                block_id=block_id,
                size=task.memory_required,
                task_id=task.task_id,
                server_id=server_id,
            )
            self._blocks[block_id] = block
            self._lru_order.append(block_id)
            return block_id

    def access(self, block_id: str):
        """Mark a memory block as recently used (LRU update)."""
        with self._lock:
            if block_id in self._lru_order:
                self._lru_order.remove(block_id)
                self._lru_order.append(block_id)

    def deallocate(self, task_id: str) -> List[str]:
        """Free all memory blocks belonging to a task. Returns freed block IDs."""
        with self._lock:
            freed = []
            to_remove = [bid for bid, b in self._blocks.items() if b.task_id == task_id]
            for bid in to_remove:
                del self._blocks[bid]
                if bid in self._lru_order:
                    self._lru_order.remove(bid)
                freed.append(bid)
            return freed

    def evict_lru(self) -> Optional[MemoryBlock]:
        """Evict the least recently used memory block."""
        with self._lock:
            if not self._lru_order:
                return None
            lru_id = self._lru_order.pop(0)
            block = self._blocks.pop(lru_id, None)
            return block

    def all_blocks(self) -> List[MemoryBlock]:
        with self._lock:
            return list(self._blocks.values())

    def stats(self) -> dict:
        with self._lock:
            total_mb = sum(b.size for b in self._blocks.values())
            return {
                "total_allocated_mb": round(total_mb, 2),
                "block_count": len(self._blocks),
            }


# ──────────────────────────────────────────────
# Process Manager (thread-based workers)
# ──────────────────────────────────────────────

class ProcessManager:
    """Manages lifecycle of running tasks as OS processes."""

    def __init__(self, memory_manager: MemoryManager):
        self._memory = memory_manager
        self._active: Dict[str, threading.Thread] = {}
        self._lock = threading.Lock()

    def start(
        self,
        task: Task,
        server: Server,
        on_complete: Optional[Callable] = None,
    ):
        """Spawn a worker thread simulating task execution."""
        task.status = TaskStatus.RUNNING
        task.started_at = time.time()
        server.allocate(task)
        block_id = self._memory.allocate(task, server.server_id)

        def _run():
            steps = max(1, int(task.execution_time * 5))
            for i in range(steps):
                time.sleep(task.execution_time / steps)
                task.progress = round((i + 1) / steps * 100, 1)
                # Simulate occasional memory access for LRU
                if random.random() < 0.3:
                    self._memory.access(block_id)
                if task.status == TaskStatus.TERMINATED:
                    break

            task.completed_at = time.time()
            elapsed = task.completed_at - task.started_at
            task.sla_met = elapsed <= task.sla_threshold

            if task.status != TaskStatus.TERMINATED:
                task.status = TaskStatus.COMPLETED
                task.progress = 100.0

            server.release(task)
            self._memory.deallocate(task.task_id)

            with self._lock:
                self._active.pop(task.task_id, None)

            if on_complete:
                on_complete(task)

        t = threading.Thread(target=_run, daemon=True, name=f"task-{task.task_id}")
        with self._lock:
            self._active[task.task_id] = t
        task.status = TaskStatus.RUNNING
        t.start()

    def terminate(self, task_id: str) -> bool:
        """Mark a task for termination."""
        with self._lock:
            if task_id in self._active:
                # Signal via status; the thread checks it
                return True
        return False

    def running_count(self) -> int:
        with self._lock:
            return len(self._active)

    def running_ids(self) -> List[str]:
        with self._lock:
            return list(self._active.keys())


# ──────────────────────────────────────────────
# Resource Manager – top-level orchestrator
# ──────────────────────────────────────────────

class ResourceManager:
    """Manages servers, memory, and processes."""

    def __init__(self):
        self.servers: Dict[str, Server] = {}
        self.memory_manager = MemoryManager()
        self.process_manager = ProcessManager(self.memory_manager)
        self._lock = threading.Lock()
        self._on_task_complete: Optional[Callable] = None
        self._init_servers()

    def _init_servers(self):
        configs = [
            ("server-1", 8.0, 16384),
            ("server-2", 8.0, 16384),
            ("server-3", 4.0, 8192),
            ("server-4", 4.0, 8192),
            ("server-5", 16.0, 32768),
        ]
        for sid, cpu, mem in configs:
            self.servers[sid] = Server(server_id=sid, total_cpu=cpu, total_memory=mem)

    def set_on_complete(self, cb: Callable):
        self._on_task_complete = cb

    def get_server(self, server_id: str) -> Optional[Server]:
        return self.servers.get(server_id)

    def eligible_servers(self, task: Task) -> List[Server]:
        return [s for s in self.servers.values() if s.can_fit(task)]

    def assign_task(self, task: Task, server: Server):
        self.process_manager.start(task, server, on_complete=self._on_task_complete)

    def terminate_task(self, task: Task):
        task.status = TaskStatus.TERMINATED
        if task.assigned_server:
            server = self.servers.get(task.assigned_server)
            if server:
                server.release(task)
        self.process_manager.terminate(task.task_id)
        self.memory_manager.deallocate(task.task_id)

    def servers_status(self) -> List[dict]:
        return [s.to_dict() for s in self.servers.values()]

    def system_stats(self) -> dict:
        with self._lock:
            servers = list(self.servers.values())
            total_cpu = sum(s.total_cpu for s in servers)
            used_cpu = sum(s.used_cpu for s in servers)
            total_mem = sum(s.total_memory for s in servers)
            used_mem = sum(s.used_memory for s in servers)
            avg_cpu_load = sum(s.cpu_load for s in servers) / max(len(servers), 1)
            avg_mem_load = sum(s.memory_load for s in servers) / max(len(servers), 1)
            return {
                "total_cpu": total_cpu,
                "used_cpu": round(used_cpu, 2),
                "total_memory": total_mem,
                "used_memory": round(used_mem, 2),
                "avg_cpu_load": round(avg_cpu_load, 1),
                "avg_mem_load": round(avg_mem_load, 1),
                "active_processes": self.process_manager.running_count(),
                "memory_stats": self.memory_manager.stats(),
                "server_count": len(servers),
            }
