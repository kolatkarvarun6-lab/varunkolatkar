import sys
import os

sys.path.insert(0, os.path.dirname(__file__))

import pytest
from datetime import datetime, timezone, timedelta

from models.task import Task, TaskStatus
from models.server import Server, ServerStatus
from services.scheduler import SchedulerService
from services.resource_manager import ResourceManager
from services.task_service import TaskService


# ── Helpers ────────────────────────────────────────────────────────────────────

def make_task(cpu=2.0, mem=4.0, priority=5, deadline=None, name="test"):
    return Task(name=name, description="desc", cpu_required=cpu,
                memory_required=mem, priority=priority, deadline=deadline)


def make_server(cpu=16.0, mem=64.0, name="srv"):
    return Server(name=name, total_cpu=cpu, total_memory=mem)


def future_deadline(hours=10):
    return (datetime.now(timezone.utc) + timedelta(hours=hours)).isoformat()


def past_deadline(hours=1):
    return (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()


# ── Task Model ─────────────────────────────────────────────────────────────────

class TestTaskModel:
    def test_task_creation_defaults(self):
        task = make_task()
        assert task.status == TaskStatus.PENDING
        assert task.server_id is None
        assert task.started_at is None
        assert task.completed_at is None
        assert task.id is not None

    def test_task_urgency_no_deadline(self):
        task = make_task(priority=5)
        assert task.urgency_score == 50.0

    def test_task_urgency_high_priority(self):
        task = make_task(priority=10)
        assert task.urgency_score == 100.0

    def test_task_urgency_with_close_deadline(self):
        dl = (datetime.now(timezone.utc) + timedelta(minutes=30)).isoformat()
        task = make_task(priority=5, deadline=dl)
        assert task.urgency_score > 50.0

    def test_task_urgency_with_past_deadline(self):
        task = make_task(priority=5, deadline=past_deadline())
        assert task.urgency_score >= 100.0

    def test_sla_at_risk_true(self):
        dl = (datetime.now(timezone.utc) + timedelta(minutes=30)).isoformat()
        task = make_task(deadline=dl)
        assert task.is_sla_at_risk() is True

    def test_sla_at_risk_false_no_deadline(self):
        task = make_task()
        assert task.is_sla_at_risk() is False

    def test_sla_at_risk_false_far_deadline(self):
        task = make_task(deadline=future_deadline(hours=48))
        assert task.is_sla_at_risk() is False

    def test_sla_not_at_risk_when_completed(self):
        dl = (datetime.now(timezone.utc) + timedelta(minutes=30)).isoformat()
        task = make_task(deadline=dl)
        task.update_status(TaskStatus.COMPLETED)
        assert task.is_sla_at_risk() is False

    def test_update_status_running_sets_started_at(self):
        task = make_task()
        task.update_status(TaskStatus.RUNNING)
        assert task.started_at is not None

    def test_update_status_completed_sets_completed_at(self):
        task = make_task()
        task.update_status(TaskStatus.COMPLETED)
        assert task.completed_at is not None

    def test_to_dict_keys(self):
        task = make_task()
        d = task.to_dict()
        for key in ["id", "name", "status", "cpu_required", "memory_required",
                    "priority", "urgency_score", "sla_at_risk"]:
            assert key in d

    def test_from_dict_roundtrip(self):
        task = make_task(cpu=4.0, mem=8.0, priority=7)
        d = task.to_dict()
        task2 = Task.from_dict(d)
        assert task2.id == task.id
        assert task2.cpu_required == 4.0
        assert task2.memory_required == 8.0
        assert task2.priority == 7


# ── Server Model ───────────────────────────────────────────────────────────────

class TestServerModel:
    def test_server_creation(self):
        server = make_server()
        assert server.status == ServerStatus.ACTIVE
        assert server.available_cpu == server.total_cpu
        assert server.available_memory == server.total_memory
        assert server.tasks == []

    def test_can_accommodate_true(self):
        server = make_server(cpu=16.0, mem=64.0)
        assert server.can_accommodate(4.0, 8.0) is True

    def test_can_accommodate_false_insufficient(self):
        server = make_server(cpu=2.0, mem=4.0)
        assert server.can_accommodate(4.0, 8.0) is False

    def test_can_accommodate_false_inactive(self):
        server = make_server()
        server.status = ServerStatus.INACTIVE
        assert server.can_accommodate(1.0, 1.0) is False

    def test_allocate_updates_resources(self):
        server = make_server(cpu=16.0, mem=64.0)
        server.allocate(4.0, 8.0, "task1")
        assert server.available_cpu == 12.0
        assert server.available_memory == 56.0
        assert "task1" in server.tasks

    def test_allocate_raises_if_insufficient(self):
        server = make_server(cpu=2.0, mem=4.0)
        with pytest.raises(ValueError):
            server.allocate(4.0, 8.0, "task1")

    def test_deallocate_returns_resources(self):
        server = make_server(cpu=16.0, mem=64.0)
        server.allocate(4.0, 8.0, "task1")
        server.deallocate(4.0, 8.0, "task1")
        assert server.available_cpu == 16.0
        assert server.available_memory == 64.0
        assert "task1" not in server.tasks

    def test_utilization_idle(self):
        server = make_server()
        util = server.utilization()
        assert util["cpu_pct"] == 0.0
        assert util["memory_pct"] == 0.0
        assert util["overall"] == 0.0

    def test_utilization_partial(self):
        server = make_server(cpu=10.0, mem=10.0)
        server.allocate(5.0, 5.0, "t1")
        util = server.utilization()
        assert util["cpu_pct"] == 50.0
        assert util["memory_pct"] == 50.0

    def test_health_score_idle(self):
        server = make_server()
        assert server.health_score() == 1.0

    def test_health_score_inactive(self):
        server = make_server()
        server.status = ServerStatus.INACTIVE
        assert server.health_score() == 0.0

    def test_health_score_maintenance(self):
        server = make_server()
        server.status = ServerStatus.MAINTENANCE
        assert server.health_score() == 0.3

    def test_from_dict_roundtrip(self):
        server = make_server(cpu=8.0, mem=32.0)
        d = server.to_dict()
        server2 = Server.from_dict(d)
        assert server2.id == server.id
        assert server2.total_cpu == 8.0


# ── Scheduler ─────────────────────────────────────────────────────────────────

class TestScheduler:
    def _setup(self):
        servers = [make_server(cpu=16, mem=64, name="s1"),
                   make_server(cpu=8, mem=32, name="s2"),
                   make_server(cpu=32, mem=128, name="s3")]
        tasks = [make_task(cpu=2, mem=4, priority=5, name=f"t{i}") for i in range(3)]
        return servers, tasks

    def test_greedy_picks_least_loaded(self):
        servers, tasks = self._setup()
        servers[0].allocate(14, 60, "dummy")
        sched = SchedulerService(servers, "greedy")
        result = sched.find_server(tasks[0], servers, tasks)
        assert result is not None
        assert result.name in ("s2", "s3")

    def test_greedy_returns_none_no_fit(self):
        servers = [make_server(cpu=1, mem=1, name="tiny")]
        sched = SchedulerService(servers, "greedy")
        task = make_task(cpu=4, mem=8)
        assert sched.find_server(task, servers, [task]) is None

    def test_fcfs_picks_first_fitting(self):
        servers, tasks = self._setup()
        sched = SchedulerService(servers, "fcfs")
        result = sched.find_server(tasks[0], servers, tasks)
        assert result is not None
        assert result.name == "s1"

    def test_priority_schedules_high_priority_first(self):
        servers, _ = self._setup()
        low = make_task(cpu=1, mem=1, priority=2, name="low")
        high = make_task(cpu=1, mem=1, priority=9, name="high")
        sched = SchedulerService(servers, "priority")
        assignments = sched.schedule_tasks([low, high], servers, [low, high])
        assigned_tasks = [a[0].name for a in assignments]
        assert assigned_tasks.index("high") < assigned_tasks.index("low")

    def test_priority_preemption(self):
        server = make_server(cpu=4, mem=8, name="small")
        running_task = make_task(cpu=4, mem=8, priority=2, name="running")
        running_task.update_status(TaskStatus.RUNNING)
        server.allocate(4, 8, running_task.id)
        new_task = make_task(cpu=4, mem=8, priority=8, name="new")
        sched = SchedulerService([server], "priority")
        result = sched.find_server(new_task, [server], [running_task, new_task])
        assert result is not None

    def test_round_robin_cycles(self):
        servers = [make_server(cpu=16, mem=64, name=f"s{i}") for i in range(3)]
        sched = SchedulerService(servers, "round_robin")
        task = make_task(cpu=1, mem=1)
        first = sched.find_server(task, servers, [task])
        second = sched.find_server(task, servers, [task])
        assert first is not second

    def test_set_algorithm_invalid(self):
        sched = SchedulerService([], "greedy")
        with pytest.raises(ValueError):
            sched.set_algorithm("invalid_algo")

    def test_schedule_tasks_returns_list(self):
        servers, tasks = self._setup()
        sched = SchedulerService(servers, "greedy")
        results = sched.schedule_tasks(tasks, servers, tasks)
        assert isinstance(results, list)
        assert len(results) > 0


# ── Resource Manager ──────────────────────────────────────────────────────────

class TestResourceManager:
    def test_allocate_sets_running(self):
        rm = ResourceManager()
        task = make_task()
        server = make_server()
        rm.allocate_task(task, server)
        assert task.status == TaskStatus.RUNNING
        assert task.server_id == server.id
        assert task.id in server.tasks

    def test_deallocate_sets_completed(self):
        rm = ResourceManager()
        task = make_task()
        server = make_server()
        rm.allocate_task(task, server)
        rm.deallocate_task(task, server)
        assert task.status == TaskStatus.COMPLETED
        assert task.server_id is None
        assert task.id not in server.tasks

    def test_cancel_task_frees_resources(self):
        rm = ResourceManager()
        task = make_task(cpu=4, mem=8)
        server = make_server(cpu=16, mem=64)
        rm.allocate_task(task, server)
        rm.cancel_task(task, server)
        assert task.status == TaskStatus.CANCELLED
        assert server.available_cpu == 16.0

    def test_fail_task(self):
        rm = ResourceManager()
        task = make_task()
        server = make_server()
        rm.allocate_task(task, server)
        rm.fail_task(task, server)
        assert task.status == TaskStatus.FAILED
        assert task.id not in server.tasks

    def test_cancel_pending_task_no_server(self):
        rm = ResourceManager()
        task = make_task()
        rm.cancel_task(task, None)
        assert task.status == TaskStatus.CANCELLED


# ── Task Service ──────────────────────────────────────────────────────────────

class TestTaskService:
    def setup_method(self):
        self.svc = TaskService()
        self.svc.create_server({"name": "srv1", "total_cpu": 16, "total_memory": 64})
        self.svc.create_server({"name": "srv2", "total_cpu": 8, "total_memory": 32})

    def test_create_task_success(self):
        task = self.svc.create_task({
            "name": "Job", "description": "d",
            "cpu_required": 2, "memory_required": 4, "priority": 5
        })
        assert task.id in {t.id for t in self.svc.list_tasks()}

    def test_create_task_missing_field(self):
        with pytest.raises(ValueError):
            self.svc.create_task({"name": "x", "cpu_required": 1})

    def test_create_task_invalid_priority(self):
        with pytest.raises(ValueError):
            self.svc.create_task({"name": "x", "cpu_required": 1, "memory_required": 1, "priority": 0})

    def test_get_task_not_found(self):
        with pytest.raises(KeyError):
            self.svc.get_task("nonexistent")

    def test_list_tasks_filter_by_status(self):
        self.svc.create_task({"name": "t1", "cpu_required": 1, "memory_required": 1, "priority": 3})
        tasks = self.svc.list_tasks(status="PENDING")
        assert all(t.status == TaskStatus.PENDING for t in tasks)

    def test_update_task(self):
        task = self.svc.create_task({"name": "t", "cpu_required": 1, "memory_required": 1, "priority": 3})
        updated = self.svc.update_task(task.id, {"name": "Updated", "priority": 8})
        assert updated.name == "Updated"
        assert updated.priority == 8

    def test_cancel_task(self):
        task = self.svc.create_task({"name": "t", "cpu_required": 1, "memory_required": 1, "priority": 3})
        cancelled = self.svc.cancel_task(task.id)
        assert cancelled.status == TaskStatus.CANCELLED

    def test_cancel_already_cancelled(self):
        task = self.svc.create_task({"name": "t", "cpu_required": 1, "memory_required": 1, "priority": 3})
        self.svc.cancel_task(task.id)
        with pytest.raises(ValueError):
            self.svc.cancel_task(task.id)

    def test_create_server_success(self):
        srv = self.svc.create_server({"name": "new", "total_cpu": 4, "total_memory": 16})
        assert srv.id in {s.id for s in self.svc.list_servers()}

    def test_remove_server_with_tasks_fails(self):
        srv = self.svc.create_server({"name": "s", "total_cpu": 8, "total_memory": 16})
        task = self.svc.create_task({"name": "t", "cpu_required": 1, "memory_required": 1, "priority": 5})
        self.svc.run_scheduler("greedy")
        running = [t for t in self.svc.list_tasks() if t.status == TaskStatus.RUNNING]
        if running:
            with pytest.raises(ValueError):
                self.svc.remove_server(running[0].server_id)

    def test_run_scheduler_greedy(self):
        self.svc.create_task({"name": "t", "cpu_required": 2, "memory_required": 4, "priority": 5})
        result = self.svc.run_scheduler("greedy")
        assert result["scheduled_count"] >= 1

    def test_run_scheduler_fcfs(self):
        self.svc.create_task({"name": "t", "cpu_required": 1, "memory_required": 2, "priority": 3})
        result = self.svc.run_scheduler("fcfs")
        assert "assignments" in result

    def test_run_scheduler_priority(self):
        self.svc.create_task({"name": "high", "cpu_required": 1, "memory_required": 1, "priority": 9})
        self.svc.create_task({"name": "low", "cpu_required": 1, "memory_required": 1, "priority": 2})
        result = self.svc.run_scheduler("priority")
        assert result["scheduled_count"] >= 2

    def test_run_scheduler_round_robin(self):
        self.svc.create_task({"name": "t", "cpu_required": 1, "memory_required": 1, "priority": 5})
        result = self.svc.run_scheduler("round_robin")
        assert result["scheduled_count"] >= 1

    def test_get_stats(self):
        stats = self.svc.get_stats()
        assert "total_tasks" in stats
        assert "total_servers" in stats
        assert "cluster_cpu_utilization_pct" in stats


# ── REST API ──────────────────────────────────────────────────────────────────

class TestAPI:
    @pytest.fixture(autouse=True)
    def setup_app(self):
        import importlib
        import app as app_module
        importlib.reload(app_module)
        self.app = app_module.app
        self.client = self.app.test_client()

    def test_health(self):
        r = self.client.get("/api/health")
        assert r.status_code == 200
        assert r.get_json()["status"] == "ok"

    def test_create_task_api(self):
        r = self.client.post("/api/tasks", json={
            "name": "API Task", "description": "d",
            "cpu_required": 1.0, "memory_required": 2.0, "priority": 5
        })
        assert r.status_code == 201
        assert r.get_json()["name"] == "API Task"

    def test_create_task_missing_field(self):
        r = self.client.post("/api/tasks", json={"name": "x"})
        assert r.status_code == 400

    def test_list_tasks(self):
        r = self.client.get("/api/tasks")
        assert r.status_code == 200
        assert isinstance(r.get_json(), list)

    def test_get_task_not_found(self):
        r = self.client.get("/api/tasks/nonexistent-id")
        assert r.status_code == 404

    def test_delete_task(self):
        r = self.client.post("/api/tasks", json={
            "name": "To Cancel", "cpu_required": 1, "memory_required": 1, "priority": 3
        })
        task_id = r.get_json()["id"]
        r2 = self.client.delete(f"/api/tasks/{task_id}")
        assert r2.status_code == 200
        assert r2.get_json()["status"] == "CANCELLED"

    def test_list_servers(self):
        r = self.client.get("/api/servers")
        assert r.status_code == 200
        data = r.get_json()
        assert isinstance(data, list)
        assert len(data) == 3

    def test_create_server_api(self):
        r = self.client.post("/api/servers", json={
            "name": "new-node", "total_cpu": 4.0, "total_memory": 16.0
        })
        assert r.status_code == 201
        assert r.get_json()["name"] == "new-node"

    def test_get_server_not_found(self):
        r = self.client.get("/api/servers/no-such-server")
        assert r.status_code == 404

    def test_schedule_api(self):
        r = self.client.post("/api/schedule", json={"algorithm": "greedy"})
        assert r.status_code == 200
        data = r.get_json()
        assert "scheduled_count" in data

    def test_schedule_invalid_algorithm(self):
        r = self.client.post("/api/schedule", json={"algorithm": "unknown"})
        assert r.status_code == 400

    def test_stats_api(self):
        r = self.client.get("/api/stats")
        assert r.status_code == 200
        data = r.get_json()
        assert "total_tasks" in data
        assert "total_servers" in data

    def test_update_task_api(self):
        r = self.client.post("/api/tasks", json={
            "name": "Old Name", "cpu_required": 1, "memory_required": 1, "priority": 3
        })
        task_id = r.get_json()["id"]
        r2 = self.client.put(f"/api/tasks/{task_id}", json={"name": "New Name"})
        assert r2.status_code == 200
        assert r2.get_json()["name"] == "New Name"

    def test_update_server_api(self):
        servers = self.client.get("/api/servers").get_json()
        sid = servers[0]["id"]
        r = self.client.put(f"/api/servers/{sid}", json={"name": "renamed"})
        assert r.status_code == 200
        assert r.get_json()["name"] == "renamed"
