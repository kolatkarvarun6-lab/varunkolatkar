"""
app.py - Flask REST API + WebSocket server
Cloud Resource Management Simulator
"""
import time
import threading
import random
import eventlet
eventlet.monkey_patch()

from flask import Flask, request, jsonify, send_from_directory
from flask_socketio import SocketIO, emit
from flask_cors import CORS

from task_manager import Task, TaskStatus, TaskRegistry, PriorityQueue, create_batch
from resource_manager import ResourceManager
from scheduler import Dispatcher, ALGORITHMS, KnapsackScheduler

# ──────────────────────────────────────────────
# App setup
# ──────────────────────────────────────────────

app = Flask(__name__, static_folder="../frontend", static_url_path="")
app.config["SECRET_KEY"] = "cloud-sim-secret"
CORS(app)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="eventlet")

registry = TaskRegistry()
priority_queue = PriorityQueue()
resource_manager = ResourceManager()
dispatcher = Dispatcher(resource_manager)

# ──────────────────────────────────────────────
# Broadcast helpers
# ──────────────────────────────────────────────

def broadcast_update():
    """Push system snapshot to all connected clients."""
    try:
        socketio.emit("system_update", build_snapshot())
    except Exception:
        pass


def build_snapshot() -> dict:
    tasks = [t.to_dict() for t in registry.all()]
    return {
        "servers": resource_manager.servers_status(),
        "system_stats": resource_manager.system_stats(),
        "task_stats": registry.stats(),
        "tasks": tasks,
        "queue_size": priority_queue.size(),
        "algo_stats": dispatcher.algo_stats(),
        "timestamp": time.time(),
    }


def on_task_complete(task: Task):
    registry.update_status(task.task_id, task.status)
    broadcast_update()


resource_manager.set_on_complete(on_task_complete)

# ──────────────────────────────────────────────
# Background worker: drain priority queue
# ──────────────────────────────────────────────

def queue_worker():
    while True:
        task = priority_queue.peek()
        if task and task.status in (TaskStatus.NEW, TaskStatus.READY):
            eligible = resource_manager.eligible_servers(task)
            if eligible:
                priority_queue.pop()
                task.status = TaskStatus.READY
                algo = task.algorithm_used or "greedy"
                dispatcher.dispatch(task, algo)
                broadcast_update()
        eventlet.sleep(0.5)


# ──────────────────────────────────────────────
# REST API
# ──────────────────────────────────────────────

# --- Frontend ---
@app.route("/")
def index():
    return send_from_directory("../frontend", "index.html")


# --- Tasks ---
@app.route("/tasks", methods=["POST"])
def create_task():
    data = request.get_json(force=True) or {}
    now = time.time()

    deadline_offset = data.get("deadline_seconds")
    deadline = now + float(deadline_offset) if deadline_offset else None

    task = Task(
        name=data.get("name", "unnamed"),
        cpu_required=float(data.get("cpu_required", 1.0)),
        memory_required=float(data.get("memory_required", 256.0)),
        execution_time=float(data.get("execution_time", 5.0)),
        priority=int(data.get("priority", 5)),
        deadline=deadline,
        user_id=data.get("user_id", "default"),
        tenant_id=data.get("tenant_id", "default"),
        sla_threshold=float(data.get("sla_threshold", 10.0)),
        tags=data.get("tags", []),
    )
    algorithm = data.get("algorithm", "greedy")
    task.algorithm_used = algorithm

    registry.register(task)

    # Try immediate dispatch, otherwise queue
    eligible = resource_manager.eligible_servers(task)
    if eligible:
        result = dispatcher.dispatch(task, algorithm)
        if not result.success:
            task.status = TaskStatus.WAITING
            priority_queue.push(task)
    else:
        task.status = TaskStatus.WAITING
        priority_queue.push(task)

    broadcast_update()
    return jsonify(task.to_dict()), 201


@app.route("/tasks", methods=["GET"])
def list_tasks():
    tenant = request.args.get("tenant_id")
    status_filter = request.args.get("status")
    tasks = registry.by_tenant(tenant) if tenant else registry.all()
    if status_filter:
        tasks = [t for t in tasks if t.status.value == status_filter.upper()]
    return jsonify([t.to_dict() for t in tasks])


@app.route("/tasks/<task_id>", methods=["GET"])
def get_task(task_id):
    task = registry.get(task_id)
    if not task:
        return jsonify({"error": "Task not found"}), 404
    return jsonify(task.to_dict())


@app.route("/tasks/<task_id>", methods=["DELETE"])
def delete_task(task_id):
    task = registry.get(task_id)
    if not task:
        return jsonify({"error": "Task not found"}), 404
    resource_manager.terminate_task(task)
    registry.delete(task_id)
    broadcast_update()
    return jsonify({"deleted": task_id})


# --- Status ---
@app.route("/status", methods=["GET"])
def system_status():
    return jsonify(build_snapshot())


@app.route("/servers", methods=["GET"])
def servers():
    return jsonify(resource_manager.servers_status())


# --- Batch processing ---
@app.route("/tasks/batch", methods=["POST"])
def batch_tasks():
    data = request.get_json(force=True) or {}
    tasks_data = data.get("tasks", [])
    algorithm = data.get("algorithm", "greedy")
    optimize = data.get("knapsack_optimize", False)

    now = time.time()
    task_objs = []
    for td in tasks_data:
        deadline_offset = td.get("deadline_seconds")
        deadline = now + float(deadline_offset) if deadline_offset else None
        t = Task(
            name=td.get("name", "batch-task"),
            cpu_required=float(td.get("cpu_required", 1.0)),
            memory_required=float(td.get("memory_required", 256.0)),
            execution_time=float(td.get("execution_time", 5.0)),
            priority=int(td.get("priority", 5)),
            deadline=deadline,
            user_id=td.get("user_id", "default"),
            tenant_id=td.get("tenant_id", "default"),
            sla_threshold=float(td.get("sla_threshold", 10.0)),
            tags=td.get("tags", []),
        )
        t.algorithm_used = algorithm
        task_objs.append(t)

    batch_id = create_batch(task_objs)

    if optimize and task_objs:
        # Use knapsack to pick optimal subset per server
        best_server = max(resource_manager.servers.values(), key=lambda s: s.free_cpu)
        task_objs = KnapsackScheduler.batch_optimize(task_objs, best_server)

    scheduled_ids = []
    for task in task_objs:
        registry.register(task)
        eligible = resource_manager.eligible_servers(task)
        if eligible:
            result = dispatcher.dispatch(task, algorithm)
            if not result.success:
                task.status = TaskStatus.WAITING
                priority_queue.push(task)
        else:
            task.status = TaskStatus.WAITING
            priority_queue.push(task)
        scheduled_ids.append(task.task_id)

    broadcast_update()
    return jsonify({"batch_id": batch_id, "task_ids": scheduled_ids, "count": len(scheduled_ids)}), 201


# --- Algorithm comparison ---
@app.route("/algorithms/compare", methods=["POST"])
def compare_algorithms():
    data = request.get_json(force=True) or {}
    sample_count = min(int(data.get("sample_tasks", 5)), 20)
    now = time.time()
    sample_tasks = [
        Task(
            cpu_required=random.uniform(0.5, 4.0),
            memory_required=random.uniform(128, 4096),
            priority=random.randint(1, 10),
            deadline=now + random.uniform(10, 60),
        )
        for _ in range(sample_count)
    ]
    results = dispatcher.benchmark(sample_tasks)
    return jsonify(results)


@app.route("/algorithms", methods=["GET"])
def list_algorithms():
    return jsonify([
        {"key": k, "name": v.name}
        for k, v in ALGORITHMS.items()
    ])


# --- Memory / LRU ---
@app.route("/memory", methods=["GET"])
def memory_status():
    blocks = [b.to_dict() for b in resource_manager.memory_manager.all_blocks()]
    stats = resource_manager.memory_manager.stats()
    return jsonify({"blocks": blocks, "stats": stats})


@app.route("/memory/evict", methods=["POST"])
def evict_lru():
    block = resource_manager.memory_manager.evict_lru()
    if block:
        broadcast_update()
        return jsonify({"evicted": block.to_dict()})
    return jsonify({"message": "Nothing to evict"}), 200


# --- Demo: generate random load ---
@app.route("/demo/load", methods=["POST"])
def demo_load():
    data = request.get_json(force=True) or {}
    count = min(int(data.get("count", 10)), 50)
    algos = list(ALGORITHMS.keys())
    now = time.time()

    task_ids = []
    for i in range(count):
        algo = algos[i % len(algos)]
        task = Task(
            name=f"demo-task-{i}",
            cpu_required=random.uniform(0.5, 3.0),
            memory_required=random.uniform(128, 2048),
            execution_time=random.uniform(3, 15),
            priority=random.randint(1, 10),
            deadline=now + random.uniform(15, 60),
            user_id=f"user-{random.randint(1, 5)}",
            tenant_id=f"tenant-{random.randint(1, 3)}",
            sla_threshold=random.uniform(8, 20),
            algorithm_used=algo,
        )
        registry.register(task)
        eligible = resource_manager.eligible_servers(task)
        if eligible:
            dispatcher.dispatch(task, algo)
        else:
            task.status = TaskStatus.WAITING
            priority_queue.push(task)
        task_ids.append(task.task_id)

    broadcast_update()
    return jsonify({"generated": count, "task_ids": task_ids}), 201


# ──────────────────────────────────────────────
# WebSocket events
# ──────────────────────────────────────────────

@socketio.on("connect")
def handle_connect():
    emit("system_update", build_snapshot())


@socketio.on("request_update")
def handle_request_update():
    emit("system_update", build_snapshot())


# ──────────────────────────────────────────────
# Periodic broadcast (every 2 s)
# ──────────────────────────────────────────────

def periodic_broadcast():
    while True:
        broadcast_update()
        eventlet.sleep(2)


# ──────────────────────────────────────────────
# Entry point
# ──────────────────────────────────────────────

if __name__ == "__main__":
    socketio.start_background_task(queue_worker)
    socketio.start_background_task(periodic_broadcast)
    socketio.run(app, host="0.0.0.0", port=5000, debug=False)
