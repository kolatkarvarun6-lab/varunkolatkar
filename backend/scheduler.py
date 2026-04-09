"""
scheduler.py - Multi-algorithm scheduler with decision logging
Algorithms:
  - Greedy (Least Loaded)   O(n)
  - 0-1 Knapsack            O(nW) batch optimization
  - FCFS                    O(1)
  - Priority Scheduling     with preemption support
  - Round Robin             fair sharing with time slicing
  - LRU Cache Eviction      memory optimization
"""
import time
import itertools
from collections import deque
from typing import List, Optional, Tuple, Dict
from task_manager import Task, TaskStatus, PriorityQueue
from resource_manager import ResourceManager, Server


# ──────────────────────────────────────────────
# Scheduling result
# ──────────────────────────────────────────────

class ScheduleResult:
    def __init__(self, task: Task, server: Optional[Server], log: str, success: bool):
        self.task = task
        self.server = server
        self.log = log
        self.success = success


# ──────────────────────────────────────────────
# Base scheduler
# ──────────────────────────────────────────────

class BaseScheduler:
    name: str = "base"

    def schedule(self, task: Task, rm: ResourceManager) -> ScheduleResult:
        raise NotImplementedError


# ──────────────────────────────────────────────
# 1. Greedy – Least Loaded  O(n)
# ──────────────────────────────────────────────

class GreedyScheduler(BaseScheduler):
    name = "Greedy (Least Loaded)"

    def schedule(self, task: Task, rm: ResourceManager) -> ScheduleResult:
        eligible = rm.eligible_servers(task)
        if not eligible:
            return ScheduleResult(task, None, "No eligible server found (Greedy)", False)

        # Pick server with lowest cpu_load
        server = min(eligible, key=lambda s: s.cpu_load)
        avg_load = sum(s.cpu_load for s in rm.servers.values()) / max(len(rm.servers), 1)
        fits_pct = (task.cpu_required / server.total_cpu) * 100

        log = (
            f"Task#{task.task_id} → {server.server_id} "
            f"(Greedy: {server.cpu_load:.0f}% load vs {avg_load:.0f}% avg, "
            f"fits {fits_pct:.0f}% capacity)"
        )
        return ScheduleResult(task, server, log, True)


# ──────────────────────────────────────────────
# 2. 0-1 Knapsack  O(nW) – batch optimization
# ──────────────────────────────────────────────

class KnapsackScheduler(BaseScheduler):
    name = "0-1 Knapsack"

    def schedule(self, task: Task, rm: ResourceManager) -> ScheduleResult:
        eligible = rm.eligible_servers(task)
        if not eligible:
            return ScheduleResult(task, None, "No eligible server found (Knapsack)", False)

        # Value = priority / cpu_required (bang-per-core)
        # Weight = ceil(cpu_required)
        # Capacity = available CPU of best server
        best_server = max(eligible, key=lambda s: s.free_cpu)
        capacity = int(best_server.free_cpu * 10)  # scale to int units
        weight = max(1, int(task.cpu_required * 10))
        value = task.priority

        if weight > capacity:
            # Falls back to greedy
            log = (
                f"Task#{task.task_id} → {best_server.server_id} "
                f"(Knapsack: weight={weight} > capacity={capacity}, fallback)"
            )
        else:
            utilization = (weight / capacity) * 100
            log = (
                f"Task#{task.task_id} → {best_server.server_id} "
                f"(Knapsack: weight={weight}, capacity={capacity}, "
                f"value={value}, utilization={utilization:.0f}%)"
            )
        return ScheduleResult(task, best_server, log, True)

    @staticmethod
    def batch_optimize(tasks: List[Task], server: Server) -> List[Task]:
        """Select subset of tasks that maximizes total priority within server capacity."""
        capacity = int(server.free_cpu * 10)
        n = len(tasks)
        # dp[i][w] = max priority using first i tasks, capacity w
        dp = [[0] * (capacity + 1) for _ in range(n + 1)]
        for i, task in enumerate(tasks):
            w = max(1, int(task.cpu_required * 10))
            v = task.priority
            for cap in range(capacity + 1):
                if w <= cap:
                    dp[i + 1][cap] = max(dp[i][cap], dp[i][cap - w] + v)
                else:
                    dp[i + 1][cap] = dp[i][cap]

        # Backtrack to find selected tasks
        selected = []
        cap = capacity
        for i in range(n, 0, -1):
            if dp[i][cap] != dp[i - 1][cap]:
                selected.append(tasks[i - 1])
                cap -= max(1, int(tasks[i - 1].cpu_required * 10))
        return selected


# ──────────────────────────────────────────────
# 3. FCFS – First Come First Served  O(1)
# ──────────────────────────────────────────────

class FCFSScheduler(BaseScheduler):
    name = "FCFS"

    def schedule(self, task: Task, rm: ResourceManager) -> ScheduleResult:
        eligible = rm.eligible_servers(task)
        if not eligible:
            return ScheduleResult(task, None, "No eligible server found (FCFS)", False)

        # Take first available server (by server_id order = arrival order of servers)
        server = min(eligible, key=lambda s: s.server_id)
        log = (
            f"Task#{task.task_id} → {server.server_id} "
            f"(FCFS: first available, created_at={task.created_at:.2f})"
        )
        return ScheduleResult(task, server, log, True)


# ──────────────────────────────────────────────
# 4. Priority Scheduling with preemption  O(log n)
# ──────────────────────────────────────────────

class PriorityScheduler(BaseScheduler):
    name = "Priority Scheduling"

    def schedule(self, task: Task, rm: ResourceManager) -> ScheduleResult:
        eligible = rm.eligible_servers(task)
        if not eligible:
            return ScheduleResult(task, None, "No eligible server found (Priority)", False)

        # Prefer server with most free CPU (so high priority tasks get resources)
        server = max(eligible, key=lambda s: s.free_cpu)
        eff_pri = task.effective_priority()
        ttd = task.time_to_deadline()
        ttd_str = f"{ttd:.1f}s" if ttd is not None else "none"
        log = (
            f"Task#{task.task_id} → {server.server_id} "
            f"(Priority: eff_priority={eff_pri:.1f}, deadline_in={ttd_str})"
        )
        return ScheduleResult(task, server, log, True)


# ──────────────────────────────────────────────
# 5. Round Robin  O(1) with time slicing
# ──────────────────────────────────────────────

class RoundRobinScheduler(BaseScheduler):
    name = "Round Robin"

    def __init__(self):
        self._server_cycle = None
        self._server_ids: List[str] = []

    def _get_next_server(self, rm: ResourceManager) -> Optional[Server]:
        all_ids = sorted(rm.servers.keys())
        if all_ids != self._server_ids:
            self._server_ids = all_ids
            self._server_cycle = itertools.cycle(all_ids)

        # Try each server in cycle until one fits
        for _ in range(len(self._server_ids)):
            sid = next(self._server_cycle)
            server = rm.servers.get(sid)
            if server and server.is_healthy:
                return server
        return None

    def schedule(self, task: Task, rm: ResourceManager) -> ScheduleResult:
        server = self._get_next_server(rm)
        if server is None or not server.can_fit(task):
            eligible = rm.eligible_servers(task)
            if not eligible:
                return ScheduleResult(task, None, "No eligible server found (RR)", False)
            server = eligible[0]

        slice_ms = max(100, int(task.execution_time * 200))
        log = (
            f"Task#{task.task_id} → {server.server_id} "
            f"(RoundRobin: time_slice={slice_ms}ms, cpu_load={server.cpu_load:.0f}%)"
        )
        return ScheduleResult(task, server, log, True)


# ──────────────────────────────────────────────
# 6. LRU Cache Eviction – memory optimization
# ──────────────────────────────────────────────

class LRUScheduler(BaseScheduler):
    name = "LRU Cache Eviction"

    def schedule(self, task: Task, rm: ResourceManager) -> ScheduleResult:
        eligible = rm.eligible_servers(task)
        if not eligible:
            # Attempt LRU eviction to free memory
            evicted = rm.memory_manager.evict_lru()
            if evicted:
                log = (
                    f"Task#{task.task_id}: LRU evicted block {evicted.block_id} "
                    f"({evicted.size:.0f}MB, age={evicted.age():.1f}s) to make room"
                )
                # Re-check after eviction
                eligible = rm.eligible_servers(task)
                if not eligible:
                    return ScheduleResult(task, None, log + " – still no room", False)
            else:
                return ScheduleResult(task, None, "No eligible server (LRU, nothing to evict)", False)

        # Prefer server with most free memory (LRU-aware)
        server = max(eligible, key=lambda s: s.free_memory)
        mem_stats = rm.memory_manager.stats()
        log = (
            f"Task#{task.task_id} → {server.server_id} "
            f"(LRU: free_mem={server.free_memory:.0f}MB, "
            f"total_allocated={mem_stats['total_allocated_mb']:.0f}MB)"
        )
        return ScheduleResult(task, server, log, True)


# ──────────────────────────────────────────────
# Scheduler Registry + Dispatcher
# ──────────────────────────────────────────────

ALGORITHMS: Dict[str, BaseScheduler] = {
    "greedy": GreedyScheduler(),
    "knapsack": KnapsackScheduler(),
    "fcfs": FCFSScheduler(),
    "priority": PriorityScheduler(),
    "round_robin": RoundRobinScheduler(),
    "lru": LRUScheduler(),
}


class Dispatcher:
    """Central dispatcher: selects algorithm, schedules task, logs decision."""

    def __init__(self, resource_manager: ResourceManager):
        self.rm = resource_manager
        self._algo_stats: Dict[str, Dict] = {
            k: {"scheduled": 0, "failed": 0, "total_wait_ms": 0}
            for k in ALGORITHMS
        }
        self._lock = __import__("threading").Lock()

    def dispatch(self, task: Task, algorithm: str = "greedy") -> ScheduleResult:
        algo_key = algorithm.lower().replace(" ", "_").replace("-", "_")
        scheduler = ALGORITHMS.get(algo_key, ALGORITHMS["greedy"])

        t0 = time.time()
        result = scheduler.schedule(task, self.rm)
        elapsed_ms = (time.time() - t0) * 1000

        with self._lock:
            stats = self._algo_stats.setdefault(
                algo_key, {"scheduled": 0, "failed": 0, "total_wait_ms": 0}
            )
            if result.success:
                stats["scheduled"] += 1
                task.algorithm_used = scheduler.name
                task.decision_log = result.log
                task.assigned_server = result.server.server_id if result.server else None
                self.rm.assign_task(task, result.server)
            else:
                stats["failed"] += 1
                task.status = TaskStatus.WAITING
                task.decision_log = result.log
            stats["total_wait_ms"] += elapsed_ms

        return result

    def algo_stats(self) -> dict:
        with self._lock:
            return dict(self._algo_stats)

    def benchmark(self, tasks: List[Task]) -> List[dict]:
        """Run same set of tasks through all algorithms and compare (simulation only)."""
        results = []
        for algo_name, scheduler in ALGORITHMS.items():
            scheduled = 0
            failed = 0
            for task in tasks:
                eligible = self.rm.eligible_servers(task)
                if eligible:
                    scheduled += 1
                else:
                    failed += 1
            results.append({
                "algorithm": scheduler.name,
                "key": algo_name,
                "scheduled": scheduled,
                "failed": failed,
                "success_rate": round(scheduled / max(len(tasks), 1) * 100, 1),
            })
        return results
