from models.task import Task, TaskStatus
from models.server import Server, ServerStatus


class SchedulerService:
    def __init__(self, servers: list, algorithm: str = "greedy"):
        self._algorithm = algorithm
        self._rr_index: int = 0

    def set_algorithm(self, algorithm: str) -> None:
        valid = {"greedy", "fcfs", "priority", "round_robin"}
        if algorithm not in valid:
            raise ValueError(f"Unknown algorithm '{algorithm}'. Choose from {valid}")
        self._algorithm = algorithm

    def find_server(self, task: Task, servers: list, tasks: list) -> Server | None:
        if self._algorithm == "greedy":
            return self._greedy(task, servers)
        if self._algorithm == "fcfs":
            return self._fcfs(task, servers)
        if self._algorithm == "priority":
            return self._priority_find(task, servers, tasks)
        if self._algorithm == "round_robin":
            return self._round_robin(task, servers)
        return None

    def schedule_tasks(
        self, pending_tasks: list, servers: list, all_tasks: list
    ) -> list[tuple]:
        if self._algorithm == "priority":
            ordered = sorted(pending_tasks, key=lambda t: t.urgency_score, reverse=True)
        elif self._algorithm == "fcfs":
            ordered = sorted(pending_tasks, key=lambda t: t.created_at)
        else:
            ordered = list(pending_tasks)

        assignments: list[tuple] = []
        active_servers = [s for s in servers if s.status == ServerStatus.ACTIVE]

        for task in ordered:
            server = self.find_server(task, active_servers, all_tasks)
            if server is not None:
                assignments.append((task, server))
        return assignments

    def _greedy(self, task: Task, servers: list) -> Server | None:
        best: Server | None = None
        best_score = -1.0
        for server in servers:
            if server.can_accommodate(task.cpu_required, task.memory_required):
                score = server.available_cpu + server.available_memory
                if score > best_score:
                    best_score = score
                    best = server
        return best

    def _fcfs(self, task: Task, servers: list) -> Server | None:
        for server in servers:
            if server.can_accommodate(task.cpu_required, task.memory_required):
                return server
        return None

    def _priority_find(
        self, task: Task, servers: list, all_tasks: list
    ) -> Server | None:
        candidate = self._greedy(task, servers)
        if candidate is not None:
            return candidate

        task_lookup = {t.id: t for t in all_tasks}
        for server in servers:
            if server.status != ServerStatus.ACTIVE:
                continue
            running_on_server = [
                task_lookup[tid]
                for tid in server.tasks
                if tid in task_lookup
                and task_lookup[tid].status == TaskStatus.RUNNING
                and task_lookup[tid].priority < task.priority
            ]
            running_on_server.sort(key=lambda t: t.priority)
            freed_cpu = 0.0
            freed_mem = 0.0
            for rt in running_on_server:
                freed_cpu += rt.cpu_required
                freed_mem += rt.memory_required
                if (
                    server.available_cpu + freed_cpu >= task.cpu_required
                    and server.available_memory + freed_mem >= task.memory_required
                ):
                    return server
        return None

    def _round_robin(self, task: Task, servers: list) -> Server | None:
        active = [s for s in servers if s.status == ServerStatus.ACTIVE]
        if not active:
            return None
        start = self._rr_index % len(active)
        for i in range(len(active)):
            idx = (start + i) % len(active)
            server = active[idx]
            if server.can_accommodate(task.cpu_required, task.memory_required):
                self._rr_index = (idx + 1) % len(active)
                return server
        return None
