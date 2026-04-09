# Cloud Resource Management Simulator

A production-grade cloud resource management simulator demonstrating enterprise-level resource allocation, load balancing, and auto-scaling with real-time visualization.

## Features

### Multi-Algorithm Scheduler
| Algorithm | Complexity | Use Case |
|-----------|-----------|----------|
| **Greedy (Least Loaded)** | O(n) | Real-time scheduling, lowest current load |
| **0-1 Knapsack** | O(nW) | Batch optimization, maximize utilization |
| **FCFS** | O(1) | Baseline, first available server |
| **Priority + Preemption** | O(n log n) | SLA-critical, deadline-aware |
| **Round Robin** | O(n) | Fair sharing, multi-tenant |

### Core Capabilities
- **Task Management**: CPU/Memory requirements, priority (1-10), deadlines, SLA tracking
- **Dynamic Priority Queue**: Preemption support for high-priority tasks
- **OS-Level Simulation**: Multi-process workers, memory allocation/deallocation, context switching
- **Auto-Scaling**: Adds servers when avg load > 80%, removes when < 20%
- **Overcommitment Rejection**: Refuses tasks that exceed available resources
- **Decision Logging**: `Task#23 → Server-2 (Greedy: 23% load vs 67% avg, fits 85% capacity)`
- **Real-time Dashboard**: Live server utilization charts and analytics
- **Batch Processing**: Schedule up to 100 tasks in a single request

## Quick Start

```bash
cd backend
npm install
npm start
```

Open **http://localhost:3000** for the dashboard.

## REST API

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/tasks` | Submit a task |
| `POST` | `/api/tasks/batch` | Submit a batch of tasks |
| `GET` | `/api/tasks` | List all tasks (supports filters) |
| `GET` | `/api/tasks/:id` | Get task details |
| `DELETE` | `/api/tasks/:id` | Cancel a task |
| `GET` | `/api/status` | Full system status |
| `GET` | `/api/servers` | Server list with metrics |
| `POST` | `/api/servers` | Add a server (manual scale-up) |
| `DELETE` | `/api/servers/:id` | Remove/drain a server |
| `GET` | `/api/queue` | View pending task queue |
| `GET` | `/api/decisions` | Scheduler decision log |
| `POST` | `/api/scheduler` | Change scheduling algorithm |
| `GET` | `/api/scheduler/stats` | Per-algorithm performance stats |
| `GET` | `/api/contention` | Resource contention report |

### Example: Submit a Task

```bash
curl -X POST http://localhost:3000/api/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "cpu": 25,
    "memory": 512,
    "executionTime": 30,
    "priority": 8,
    "userId": "alice",
    "deadline": "2026-01-01T12:00:00Z"
  }'
```

Response:
```json
{
  "success": true,
  "task": {
    "id": 42,
    "status": "running",
    "assignedServer": 2,
    "scheduledBy": "greedy",
    "decisionLog": "Task#42 → Server-2 (Greedy: 23% load vs 67% avg, fits 48% CPU capacity)"
  }
}
```

### Example: Change Algorithm

```bash
curl -X POST http://localhost:3000/api/scheduler \
  -H "Content-Type: application/json" \
  -d '{"algorithm": "knapsack"}'
```

### Example: Batch Submit

```bash
curl -X POST http://localhost:3000/api/tasks/batch \
  -H "Content-Type: application/json" \
  -d '{"tasks": [{"cpu":10,"memory":256,"executionTime":20,"priority":5}, ...]}'
```

## Running Tests

```bash
cd backend
npm test
```

## Architecture

```
backend/
├── server.js              # Express server entry point
├── models/
│   ├── Task.js            # Task schema with SLA tracking
│   └── Server.js          # Virtual server with resource metrics
├── schedulers/
│   ├── greedy.js          # Least-loaded O(n)
│   ├── knapsack.js        # 0-1 Knapsack O(nW)
│   ├── fcfs.js            # First Come First Served O(1)
│   ├── priority.js        # Priority + preemption
│   └── roundRobin.js      # Round Robin with time slicing
├── services/
│   ├── resourceManager.js # Server cluster + auto-scaling
│   └── taskService.js     # Task lifecycle orchestration
└── routes/
    ├── tasks.js           # Task API endpoints
    └── status.js          # System status + scheduler endpoints

frontend/
├── index.html             # Dashboard UI
├── app.js                 # Real-time refresh + interactions
├── style.css              # Dark theme styles
└── minichart.js           # Lightweight canvas charts (no CDN)
```
