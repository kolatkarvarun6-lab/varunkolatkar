from models.task import Task, TaskStatus
from models.server import Server, ServerStatus
from services.scheduler import SchedulerService
from services.resource_manager import ResourceManager


class TaskService:
    def __init__(self):
        self._tasks: dict[str, Task] = {}
        self._servers: dict[str, Server] = {}
        self._scheduler = SchedulerService([], algorithm="greedy")
        self._resource_manager = ResourceManager()

    # ── Task CRUD ──────────────────────────────────────────────────────────────

    def create_task(self, data: dict) -> Task:
        required = ["name", "cpu_required", "memory_required", "priority"]
        for field in required:
            if field not in data:
                raise ValueError(f"Missing required field: {field}")
        priority = int(data["priority"])
        if not 1 <= priority <= 10:
            raise ValueError("priority must be between 1 and 10")
        cpu = float(data["cpu_required"])
        mem = float(data["memory_required"])
        if cpu <= 0 or mem <= 0:
            raise ValueError("cpu_required and memory_required must be positive")

        task = Task(
            name=str(data["name"]),
            description=str(data.get("description", "")),
            cpu_required=cpu,
            memory_required=mem,
            priority=priority,
            deadline=data.get("deadline"),
        )
        self._tasks[task.id] = task
        return task

    def get_task(self, task_id: str) -> Task:
        task = self._tasks.get(task_id)
        if task is None:
            raise KeyError(f"Task {task_id} not found")
        return task

    def list_tasks(self, status: str | None = None) -> list[Task]:
        tasks = list(self._tasks.values())
        if status:
            tasks = [t for t in tasks if t.status.value == status.upper()]
        return tasks

    def update_task(self, task_id: str, data: dict) -> Task:
        task = self.get_task(task_id)
        if "name" in data:
            task.name = str(data["name"])
        if "description" in data:
            task.description = str(data["description"])
        if "priority" in data:
            priority = int(data["priority"])
            if not 1 <= priority <= 10:
                raise ValueError("priority must be between 1 and 10")
            task.priority = priority
        if "deadline" in data:
            task.deadline = data["deadline"]
        task.urgency_score = task.calculate_urgency()
        return task

    def cancel_task(self, task_id: str) -> Task:
        task = self.get_task(task_id)
        if task.status in (TaskStatus.COMPLETED, TaskStatus.CANCELLED, TaskStatus.FAILED):
            raise ValueError(f"Task is already {task.status.value}")
        server = self._servers.get(task.server_id) if task.server_id else None
        self._resource_manager.cancel_task(task, server)
        return task

    # ── Server CRUD ────────────────────────────────────────────────────────────

    def create_server(self, data: dict) -> Server:
        required = ["name", "total_cpu", "total_memory"]
        for field in required:
            if field not in data:
                raise ValueError(f"Missing required field: {field}")
        cpu = float(data["total_cpu"])
        mem = float(data["total_memory"])
        if cpu <= 0 or mem <= 0:
            raise ValueError("total_cpu and total_memory must be positive")

        server = Server(
            name=str(data["name"]),
            total_cpu=cpu,
            total_memory=mem,
        )
        self._servers[server.id] = server
        return server

    def get_server(self, server_id: str) -> Server:
        server = self._servers.get(server_id)
        if server is None:
            raise KeyError(f"Server {server_id} not found")
        return server

    def list_servers(self, status: str | None = None) -> list[Server]:
        servers = list(self._servers.values())
        if status:
            servers = [s for s in servers if s.status.value == status.upper()]
        return servers

    def update_server(self, server_id: str, data: dict) -> Server:
        server = self.get_server(server_id)
        if "name" in data:
            server.name = str(data["name"])
        if "status" in data:
            server.status = ServerStatus(data["status"].upper())
        return server

    def remove_server(self, server_id: str) -> Server:
        server = self.get_server(server_id)
        if server.tasks:
            raise ValueError("Cannot remove server with active tasks")
        del self._servers[server_id]
        return server

    # ── Scheduling ─────────────────────────────────────────────────────────────

    def run_scheduler(self, algorithm: str | None = None) -> dict:
        if algorithm:
            self._scheduler.set_algorithm(algorithm)

        pending = [t for t in self._tasks.values() if t.status == TaskStatus.PENDING]
        all_tasks = list(self._tasks.values())
        servers = list(self._servers.values())

        assignments = self._scheduler.schedule_tasks(pending, servers, all_tasks)

        results = []
        for task, server in assignments:
            self._resource_manager.allocate_task(task, server)
            results.append({"task_id": task.id, "server_id": server.id, "task_name": task.name, "server_name": server.name})

        return {
            "algorithm": self._scheduler._algorithm,
            "assignments": results,
            "scheduled_count": len(results),
            "pending_remaining": len(pending) - len(results),
        }

    # ── Stats ──────────────────────────────────────────────────────────────────

    def get_stats(self) -> dict:
        tasks = list(self._tasks.values())
        servers = list(self._servers.values())

        status_counts: dict[str, int] = {}
        for t in tasks:
            status_counts[t.status.value] = status_counts.get(t.status.value, 0) + 1

        sla_at_risk = sum(1 for t in tasks if t.is_sla_at_risk())

        total_cpu = sum(s.total_cpu for s in servers)
        total_mem = sum(s.total_memory for s in servers)
        avail_cpu = sum(s.available_cpu for s in servers)
        avail_mem = sum(s.available_memory for s in servers)

        cpu_util = round((total_cpu - avail_cpu) / total_cpu * 100, 2) if total_cpu > 0 else 0.0
        mem_util = round((total_mem - avail_mem) / total_mem * 100, 2) if total_mem > 0 else 0.0

        return {
            "total_tasks": len(tasks),
            "task_status_counts": status_counts,
            "sla_at_risk": sla_at_risk,
            "total_servers": len(servers),
            "active_servers": sum(1 for s in servers if s.status == ServerStatus.ACTIVE),
            "cluster_cpu_utilization_pct": cpu_util,
            "cluster_memory_utilization_pct": mem_util,
        }
