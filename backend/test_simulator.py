"""
test_simulator.py - Unit and integration tests for the cloud resource management simulator
"""
import time
import pytest
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from task_manager import Task, TaskStatus, PriorityQueue, TaskRegistry, create_batch
from resource_manager import ResourceManager, Server, MemoryManager
from scheduler import (
    GreedyScheduler,
    KnapsackScheduler,
    FCFSScheduler,
    PriorityScheduler,
    RoundRobinScheduler,
    LRUScheduler,
    Dispatcher,
    ALGORITHMS,
)


# ──────────────────────────────────────────────
# Fixtures
# ──────────────────────────────────────────────

@pytest.fixture
def simple_task():
    return Task(
        name="test-task",
        cpu_required=1.0,
        memory_required=512.0,
        execution_time=1.0,
        priority=5,
    )


@pytest.fixture
def high_priority_task():
    return Task(
        name="urgent",
        cpu_required=0.5,
        memory_required=256.0,
        execution_time=0.5,
        priority=10,
        deadline=time.time() + 3,
    )


@pytest.fixture
def resource_manager():
    return ResourceManager()


@pytest.fixture
def dispatcher(resource_manager):
    return Dispatcher(resource_manager)


# ──────────────────────────────────────────────
# Task schema tests
# ──────────────────────────────────────────────

class TestTask:
    def test_task_defaults(self):
        task = Task()
        assert task.status == TaskStatus.NEW
        assert task.priority == 5
        assert task.cpu_required == 1.0
        assert task.memory_required == 256.0
        assert task.task_id is not None
        assert len(task.task_id) == 8

    def test_task_to_dict(self, simple_task):
        d = simple_task.to_dict()
        assert d["cpu_required"] == 1.0
        assert d["memory_required"] == 512.0
        assert d["status"] == "NEW"
        assert "task_id" in d

    def test_effective_priority_no_deadline(self, simple_task):
        assert simple_task.effective_priority() == 5.0

    def test_effective_priority_near_deadline(self):
        task = Task(priority=5, deadline=time.time() + 2)
        ep = task.effective_priority()
        assert ep > 5.0  # boosted

    def test_effective_priority_overdue(self):
        task = Task(priority=5, deadline=time.time() - 1)
        ep = task.effective_priority()
        assert ep >= 10.0  # heavily boosted

    def test_is_overdue(self):
        task = Task(deadline=time.time() - 5)
        assert task.is_overdue()

    def test_not_overdue(self):
        task = Task(deadline=time.time() + 100)
        assert not task.is_overdue()

    def test_no_deadline_not_overdue(self, simple_task):
        assert not simple_task.is_overdue()


# ──────────────────────────────────────────────
# Priority queue tests
# ──────────────────────────────────────────────

class TestPriorityQueue:
    def test_push_pop_order(self):
        pq = PriorityQueue()
        low = Task(priority=2)
        high = Task(priority=9)
        pq.push(low)
        pq.push(high)
        popped = pq.pop()
        assert popped.priority == 9  # high priority first

    def test_empty_pop(self):
        pq = PriorityQueue()
        assert pq.pop() is None

    def test_size(self):
        pq = PriorityQueue()
        for _ in range(5):
            pq.push(Task())
        assert pq.size() == 5

    def test_preempt_lower(self):
        pq = PriorityQueue()
        low = Task(priority=2)
        mid = Task(priority=5)
        high = Task(priority=8)
        pq.push(low)
        pq.push(mid)
        pq.push(high)
        preempted = pq.preempt_lower(5.0)
        # Tasks with effective_priority < 5 are preempted
        assert all(t.status == TaskStatus.PREEMPTED for t in preempted)
        # Queue should have mid and high remaining
        assert pq.size() >= 1

    def test_all_tasks(self):
        pq = PriorityQueue()
        for i in range(3):
            pq.push(Task(priority=i + 1))
        tasks = pq.all_tasks()
        assert len(tasks) == 3


# ──────────────────────────────────────────────
# Task registry tests
# ──────────────────────────────────────────────

class TestTaskRegistry:
    def test_register_and_get(self):
        reg = TaskRegistry()
        task = Task()
        reg.register(task)
        assert reg.get(task.task_id) is not None

    def test_delete(self):
        reg = TaskRegistry()
        task = Task()
        reg.register(task)
        assert reg.delete(task.task_id)
        assert reg.get(task.task_id) is None

    def test_by_tenant(self):
        reg = TaskRegistry()
        t1 = Task(tenant_id="acme")
        t2 = Task(tenant_id="beta")
        reg.register(t1)
        reg.register(t2)
        acme_tasks = reg.by_tenant("acme")
        assert len(acme_tasks) == 1
        assert acme_tasks[0].tenant_id == "acme"

    def test_stats(self):
        reg = TaskRegistry()
        t1 = Task()
        t1.status = TaskStatus.COMPLETED
        t1.sla_met = True
        t2 = Task()
        t2.status = TaskStatus.FAILED
        t2.sla_met = False
        reg.register(t1)
        reg.register(t2)
        stats = reg.stats()
        assert stats["total"] == 2
        assert stats["sla_met"] == 1
        assert stats["sla_missed"] == 1

    def test_update_status(self):
        reg = TaskRegistry()
        task = Task()
        reg.register(task)
        reg.update_status(task.task_id, TaskStatus.RUNNING)
        assert reg.get(task.task_id).status == TaskStatus.RUNNING


# ──────────────────────────────────────────────
# Batch processing tests
# ──────────────────────────────────────────────

class TestBatchProcessing:
    def test_create_batch(self):
        tasks = [Task() for _ in range(3)]
        batch_id = create_batch(tasks)
        assert all(t.batch_id == batch_id for t in tasks)
        assert len(batch_id) == 8


# ──────────────────────────────────────────────
# Server / resource tests
# ──────────────────────────────────────────────

class TestServer:
    def test_server_can_fit(self):
        server = Server("s1", total_cpu=8.0, total_memory=16384)
        task = Task(cpu_required=2.0, memory_required=1024)
        assert server.can_fit(task)

    def test_server_cannot_fit_cpu(self):
        server = Server("s1", total_cpu=1.0, total_memory=16384)
        task = Task(cpu_required=2.0, memory_required=256)
        assert not server.can_fit(task)

    def test_server_cannot_fit_memory(self):
        server = Server("s1", total_cpu=8.0, total_memory=512)
        task = Task(cpu_required=1.0, memory_required=1024)
        assert not server.can_fit(task)

    def test_server_allocate_release(self):
        server = Server("s1", total_cpu=8.0, total_memory=16384)
        task = Task(cpu_required=2.0, memory_required=1024)
        server.allocate(task)
        assert server.used_cpu == 2.0
        assert server.used_memory == 1024.0
        server.release(task)
        assert server.used_cpu == 0.0
        assert server.used_memory == 0.0

    def test_server_unhealthy_cannot_fit(self):
        server = Server("s1", total_cpu=8.0, total_memory=16384, is_healthy=False)
        task = Task(cpu_required=1.0, memory_required=256)
        assert not server.can_fit(task)

    def test_cpu_load(self):
        server = Server("s1", total_cpu=8.0, total_memory=16384)
        task = Task(cpu_required=4.0, memory_required=256)
        server.allocate(task)
        assert server.cpu_load == 50.0


# ──────────────────────────────────────────────
# Memory manager tests
# ──────────────────────────────────────────────

class TestMemoryManager:
    def test_allocate_deallocate(self):
        mm = MemoryManager()
        task = Task(memory_required=512)
        task.task_id = "task001"
        block_id = mm.allocate(task, "server-1")
        assert block_id in [b.block_id for b in mm.all_blocks()]
        freed = mm.deallocate(task.task_id)
        assert block_id in freed
        assert len(mm.all_blocks()) == 0

    def test_lru_eviction_order(self):
        mm = MemoryManager()
        task1 = Task(memory_required=256)
        task1.task_id = "t1"
        task2 = Task(memory_required=512)
        task2.task_id = "t2"
        b1 = mm.allocate(task1, "s1")
        b2 = mm.allocate(task2, "s1")
        # Access block2 → makes block1 the LRU
        mm.access(b2)
        evicted = mm.evict_lru()
        assert evicted is not None
        assert evicted.block_id == b1  # Least recently used

    def test_stats(self):
        mm = MemoryManager()
        task = Task(memory_required=1024)
        task.task_id = "t1"
        mm.allocate(task, "s1")
        stats = mm.stats()
        assert stats["total_allocated_mb"] == 1024.0
        assert stats["block_count"] == 1


# ──────────────────────────────────────────────
# Resource manager tests
# ──────────────────────────────────────────────

class TestResourceManager:
    def test_init_servers(self, resource_manager):
        assert len(resource_manager.servers) == 5

    def test_eligible_servers(self, resource_manager, simple_task):
        eligible = resource_manager.eligible_servers(simple_task)
        assert len(eligible) > 0

    def test_no_eligible_servers_when_overloaded(self, resource_manager):
        task = Task(cpu_required=100.0, memory_required=999999)
        eligible = resource_manager.eligible_servers(task)
        assert len(eligible) == 0

    def test_system_stats(self, resource_manager):
        stats = resource_manager.system_stats()
        assert "total_cpu" in stats
        assert "used_cpu" in stats
        assert "avg_cpu_load" in stats
        assert stats["server_count"] == 5


# ──────────────────────────────────────────────
# Scheduler tests
# ──────────────────────────────────────────────

class TestGreedyScheduler:
    def test_schedules_to_least_loaded(self, resource_manager, simple_task):
        scheduler = GreedyScheduler()
        result = scheduler.schedule(simple_task, resource_manager)
        assert result.success
        assert result.server is not None
        assert "Greedy" in result.log

    def test_no_servers_available(self, resource_manager):
        task = Task(cpu_required=999, memory_required=999999)
        scheduler = GreedyScheduler()
        result = scheduler.schedule(task, resource_manager)
        assert not result.success


class TestKnapsackScheduler:
    def test_schedules_task(self, resource_manager, simple_task):
        scheduler = KnapsackScheduler()
        result = scheduler.schedule(simple_task, resource_manager)
        assert result.success
        assert "Knapsack" in result.log

    def test_batch_optimize_returns_subset(self, resource_manager):
        tasks = [Task(cpu_required=3.0, memory_required=1024, priority=i + 1) for i in range(5)]
        server = list(resource_manager.servers.values())[0]
        selected = KnapsackScheduler.batch_optimize(tasks, server)
        # Should return at most as many tasks as fit
        assert len(selected) <= len(tasks)
        # Selected tasks should all be real tasks
        assert all(isinstance(t, Task) for t in selected)


class TestFCFSScheduler:
    def test_schedules_in_order(self, resource_manager, simple_task):
        scheduler = FCFSScheduler()
        result = scheduler.schedule(simple_task, resource_manager)
        assert result.success
        assert "FCFS" in result.log


class TestPriorityScheduler:
    def test_schedules_high_priority(self, resource_manager, high_priority_task):
        scheduler = PriorityScheduler()
        result = scheduler.schedule(high_priority_task, resource_manager)
        assert result.success
        assert "Priority" in result.log

    def test_chooses_server_with_most_cpu(self, resource_manager, simple_task):
        scheduler = PriorityScheduler()
        result = scheduler.schedule(simple_task, resource_manager)
        assert result.success
        # Server should have maximum free CPU among eligible servers
        eligible = resource_manager.eligible_servers(simple_task)
        best = max(eligible, key=lambda s: s.free_cpu)
        assert result.server.server_id == best.server_id


class TestRoundRobinScheduler:
    def test_schedules_tasks(self, resource_manager):
        scheduler = RoundRobinScheduler()
        servers_used = set()
        for i in range(6):
            task = Task(cpu_required=0.5, memory_required=256)
            result = scheduler.schedule(task, resource_manager)
            assert result.success
            servers_used.add(result.server.server_id)
        # Should spread across multiple servers
        assert len(servers_used) > 1


class TestLRUScheduler:
    def test_schedules_to_most_free_memory(self, resource_manager, simple_task):
        scheduler = LRUScheduler()
        result = scheduler.schedule(simple_task, resource_manager)
        assert result.success
        assert "LRU" in result.log


# ──────────────────────────────────────────────
# Dispatcher tests
# ──────────────────────────────────────────────

class TestDispatcher:
    def test_dispatch_greedy(self, dispatcher, simple_task):
        result = dispatcher.dispatch(simple_task, "greedy")
        assert result.success
        assert simple_task.algorithm_used is not None
        assert simple_task.decision_log != ""

    def test_dispatch_all_algorithms(self, resource_manager):
        d = Dispatcher(resource_manager)
        for algo_key in ALGORITHMS:
            task = Task(cpu_required=0.5, memory_required=256, priority=5)
            result = d.dispatch(task, algo_key)
            assert result.success, f"Algorithm {algo_key} failed to schedule"

    def test_dispatch_records_stats(self, dispatcher, simple_task):
        dispatcher.dispatch(simple_task, "greedy")
        stats = dispatcher.algo_stats()
        assert stats.get("greedy", {}).get("scheduled", 0) >= 1

    def test_benchmark_returns_all_algos(self, dispatcher):
        tasks = [Task(cpu_required=0.5, memory_required=256) for _ in range(3)]
        results = dispatcher.benchmark(tasks)
        names = {r["key"] for r in results}
        assert names == set(ALGORITHMS.keys())

    def test_dispatch_overloaded_marks_waiting(self, resource_manager):
        d = Dispatcher(resource_manager)
        task = Task(cpu_required=1000.0, memory_required=999999)
        result = d.dispatch(task, "greedy")
        assert not result.success
        assert task.status == TaskStatus.WAITING


# ──────────────────────────────────────────────
# Flask REST API integration tests
# ──────────────────────────────────────────────

class TestFlaskAPI:
    @pytest.fixture(autouse=True)
    def app_client(self):
        import backend.app as app_module
        app_module.app.config["TESTING"] = True
        self.client = app_module.app.test_client()

    def test_get_status(self):
        resp = self.client.get("/status")
        assert resp.status_code == 200
        data = resp.get_json()
        assert "servers" in data
        assert "system_stats" in data
        assert "task_stats" in data

    def test_get_servers(self):
        resp = self.client.get("/servers")
        assert resp.status_code == 200
        data = resp.get_json()
        assert isinstance(data, list)
        assert len(data) == 5

    def test_create_task(self):
        resp = self.client.post("/tasks", json={
            "name": "api-test-task",
            "cpu_required": 1.0,
            "memory_required": 512,
            "execution_time": 2,
            "priority": 7,
            "algorithm": "greedy",
        })
        assert resp.status_code == 201
        data = resp.get_json()
        assert data["name"] == "api-test-task"
        assert data["task_id"] is not None

    def test_get_task(self):
        # Create then retrieve
        create_resp = self.client.post("/tasks", json={"name": "fetch-me", "priority": 3})
        task_id = create_resp.get_json()["task_id"]
        get_resp = self.client.get(f"/tasks/{task_id}")
        assert get_resp.status_code == 200
        assert get_resp.get_json()["task_id"] == task_id

    def test_get_task_not_found(self):
        resp = self.client.get("/tasks/nonexistent")
        assert resp.status_code == 404

    def test_delete_task(self):
        create_resp = self.client.post("/tasks", json={"name": "delete-me"})
        task_id = create_resp.get_json()["task_id"]
        del_resp = self.client.delete(f"/tasks/{task_id}")
        assert del_resp.status_code == 200
        assert del_resp.get_json()["deleted"] == task_id

    def test_list_algorithms(self):
        resp = self.client.get("/algorithms")
        assert resp.status_code == 200
        data = resp.get_json()
        keys = {a["key"] for a in data}
        assert "greedy" in keys
        assert "knapsack" in keys
        assert "fcfs" in keys

    def test_batch_create(self):
        resp = self.client.post("/tasks/batch", json={
            "tasks": [
                {"name": f"batch-{i}", "cpu_required": 0.5, "priority": i + 1}
                for i in range(3)
            ],
            "algorithm": "round_robin",
        })
        assert resp.status_code == 201
        data = resp.get_json()
        assert data["count"] == 3
        assert "batch_id" in data

    def test_algorithm_compare(self):
        resp = self.client.post("/algorithms/compare", json={"sample_tasks": 3})
        assert resp.status_code == 200
        data = resp.get_json()
        assert isinstance(data, list)
        assert len(data) == len(ALGORITHMS)

    def test_memory_status(self):
        resp = self.client.get("/memory")
        assert resp.status_code == 200
        data = resp.get_json()
        assert "blocks" in data
        assert "stats" in data

    def test_demo_load(self):
        resp = self.client.post("/demo/load", json={"count": 5})
        assert resp.status_code == 201
        data = resp.get_json()
        assert data["generated"] == 5
