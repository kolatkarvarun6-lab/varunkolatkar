from datetime import datetime, timezone
from models.task import Task, TaskStatus
from models.server import Server


class ResourceManager:
    def allocate_task(self, task: Task, server: Server) -> None:
        server.allocate(task.cpu_required, task.memory_required, task.id)
        task.server_id = server.id
        task.update_status(TaskStatus.RUNNING)

    def deallocate_task(self, task: Task, server: Server) -> None:
        server.deallocate(task.cpu_required, task.memory_required, task.id)
        task.server_id = None
        task.update_status(TaskStatus.COMPLETED)

    def cancel_task(self, task: Task, server: Server | None = None) -> None:
        if server is not None and task.id in server.tasks:
            server.deallocate(task.cpu_required, task.memory_required, task.id)
        task.server_id = None
        task.update_status(TaskStatus.CANCELLED)

    def fail_task(self, task: Task, server: Server | None = None) -> None:
        if server is not None and task.id in server.tasks:
            server.deallocate(task.cpu_required, task.memory_required, task.id)
        task.server_id = None
        task.update_status(TaskStatus.FAILED)
