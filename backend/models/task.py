import uuid
from datetime import datetime, timezone
from enum import Enum


class TaskStatus(str, Enum):
    PENDING = "PENDING"
    RUNNING = "RUNNING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"


class Task:
    def __init__(
        self,
        name: str,
        description: str,
        cpu_required: float,
        memory_required: float,
        priority: int,
        deadline: str | None = None,
        task_id: str | None = None,
    ):
        self.id: str = task_id or str(uuid.uuid4())
        self.name: str = name
        self.description: str = description
        self.cpu_required: float = float(cpu_required)
        self.memory_required: float = float(memory_required)
        self.priority: int = int(priority)
        self.status: TaskStatus = TaskStatus.PENDING
        self.created_at: str = datetime.now(timezone.utc).isoformat()
        self.started_at: str | None = None
        self.completed_at: str | None = None
        self.deadline: str | None = deadline
        self.server_id: str | None = None
        self.urgency_score: float = self.calculate_urgency()

    def calculate_urgency(self) -> float:
        base = self.priority * 10.0
        if self.deadline:
            try:
                dl = datetime.fromisoformat(self.deadline)
                now = datetime.now(timezone.utc)
                if dl.tzinfo is None:
                    dl = dl.replace(tzinfo=timezone.utc)
                remaining_hours = (dl - now).total_seconds() / 3600.0
                if remaining_hours <= 0:
                    time_factor = 50.0
                elif remaining_hours < 1:
                    time_factor = 30.0
                elif remaining_hours < 6:
                    time_factor = 20.0
                elif remaining_hours < 24:
                    time_factor = 10.0
                else:
                    time_factor = 0.0
                return base + time_factor
            except (ValueError, TypeError):
                pass
        return base

    def is_sla_at_risk(self) -> bool:
        if not self.deadline:
            return False
        if self.status in (TaskStatus.COMPLETED, TaskStatus.CANCELLED, TaskStatus.FAILED):
            return False
        try:
            dl = datetime.fromisoformat(self.deadline)
            now = datetime.now(timezone.utc)
            if dl.tzinfo is None:
                dl = dl.replace(tzinfo=timezone.utc)
            remaining_hours = (dl - now).total_seconds() / 3600.0
            return remaining_hours < 2.0
        except (ValueError, TypeError):
            return False

    def update_status(self, new_status: TaskStatus) -> None:
        self.status = new_status
        if new_status == TaskStatus.RUNNING and self.started_at is None:
            self.started_at = datetime.now(timezone.utc).isoformat()
        elif new_status in (TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.CANCELLED):
            self.completed_at = datetime.now(timezone.utc).isoformat()
        self.urgency_score = self.calculate_urgency()

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "cpu_required": self.cpu_required,
            "memory_required": self.memory_required,
            "priority": self.priority,
            "status": self.status.value,
            "created_at": self.created_at,
            "started_at": self.started_at,
            "completed_at": self.completed_at,
            "deadline": self.deadline,
            "server_id": self.server_id,
            "urgency_score": self.urgency_score,
            "sla_at_risk": self.is_sla_at_risk(),
        }

    @classmethod
    def from_dict(cls, data: dict) -> "Task":
        task = cls(
            name=data["name"],
            description=data.get("description", ""),
            cpu_required=data["cpu_required"],
            memory_required=data["memory_required"],
            priority=data["priority"],
            deadline=data.get("deadline"),
            task_id=data.get("id"),
        )
        if "status" in data:
            task.status = TaskStatus(data["status"])
        if "created_at" in data:
            task.created_at = data["created_at"]
        if "started_at" in data:
            task.started_at = data["started_at"]
        if "completed_at" in data:
            task.completed_at = data["completed_at"]
        if "server_id" in data:
            task.server_id = data["server_id"]
        task.urgency_score = task.calculate_urgency()
        return task
