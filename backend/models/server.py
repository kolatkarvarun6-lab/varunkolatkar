import uuid
from datetime import datetime, timezone
from enum import Enum


class ServerStatus(str, Enum):
    ACTIVE = "ACTIVE"
    INACTIVE = "INACTIVE"
    MAINTENANCE = "MAINTENANCE"


class Server:
    def __init__(
        self,
        name: str,
        total_cpu: float,
        total_memory: float,
        server_id: str | None = None,
    ):
        self.id: str = server_id or str(uuid.uuid4())
        self.name: str = name
        self.total_cpu: float = float(total_cpu)
        self.total_memory: float = float(total_memory)
        self.available_cpu: float = float(total_cpu)
        self.available_memory: float = float(total_memory)
        self.status: ServerStatus = ServerStatus.ACTIVE
        self.tasks: list[str] = []
        self.created_at: str = datetime.now(timezone.utc).isoformat()

    def can_accommodate(self, cpu: float, memory: float) -> bool:
        return (
            self.status == ServerStatus.ACTIVE
            and self.available_cpu >= cpu
            and self.available_memory >= memory
        )

    def allocate(self, cpu: float, memory: float, task_id: str) -> None:
        if not self.can_accommodate(cpu, memory):
            raise ValueError(
                f"Server {self.id} cannot accommodate cpu={cpu} memory={memory}"
            )
        self.available_cpu -= cpu
        self.available_memory -= memory
        if task_id not in self.tasks:
            self.tasks.append(task_id)

    def deallocate(self, cpu: float, memory: float, task_id: str) -> None:
        self.available_cpu = min(self.total_cpu, self.available_cpu + cpu)
        self.available_memory = min(self.total_memory, self.available_memory + memory)
        if task_id in self.tasks:
            self.tasks.remove(task_id)

    def utilization(self) -> dict:
        cpu_pct = (
            (self.total_cpu - self.available_cpu) / self.total_cpu * 100
            if self.total_cpu > 0
            else 0.0
        )
        mem_pct = (
            (self.total_memory - self.available_memory) / self.total_memory * 100
            if self.total_memory > 0
            else 0.0
        )
        overall = (cpu_pct + mem_pct) / 2.0
        return {
            "cpu_pct": round(cpu_pct, 2),
            "memory_pct": round(mem_pct, 2),
            "overall": round(overall, 2),
        }

    def health_score(self) -> float:
        if self.status == ServerStatus.INACTIVE:
            return 0.0
        if self.status == ServerStatus.MAINTENANCE:
            return 0.3
        util = self.utilization()
        score = 1.0 - (util["overall"] / 100.0)
        return round(max(0.0, min(1.0, score)), 4)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "total_cpu": self.total_cpu,
            "total_memory": self.total_memory,
            "available_cpu": self.available_cpu,
            "available_memory": self.available_memory,
            "status": self.status.value,
            "tasks": list(self.tasks),
            "created_at": self.created_at,
            "utilization": self.utilization(),
            "health_score": self.health_score(),
        }

    @classmethod
    def from_dict(cls, data: dict) -> "Server":
        server = cls(
            name=data["name"],
            total_cpu=data["total_cpu"],
            total_memory=data["total_memory"],
            server_id=data.get("id"),
        )
        if "available_cpu" in data:
            server.available_cpu = float(data["available_cpu"])
        if "available_memory" in data:
            server.available_memory = float(data["available_memory"])
        if "status" in data:
            server.status = ServerStatus(data["status"])
        if "tasks" in data:
            server.tasks = list(data["tasks"])
        if "created_at" in data:
            server.created_at = data["created_at"]
        return server
