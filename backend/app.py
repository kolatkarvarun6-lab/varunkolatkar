import sys
import os

sys.path.insert(0, os.path.dirname(__file__))

from flask import Flask, jsonify, request
from flask_cors import CORS
from services.task_service import TaskService

app = Flask(__name__)
CORS(app)

service = TaskService()


def _seed():
    s1 = service.create_server({"name": "node-01", "total_cpu": 16.0, "total_memory": 64.0})
    s2 = service.create_server({"name": "node-02", "total_cpu": 8.0, "total_memory": 32.0})
    s3 = service.create_server({"name": "node-03", "total_cpu": 32.0, "total_memory": 128.0})

    service.create_task({
        "name": "Data Processing",
        "description": "Batch ETL job",
        "cpu_required": 2.0,
        "memory_required": 4.0,
        "priority": 7,
    })
    service.create_task({
        "name": "ML Training",
        "description": "Train classification model",
        "cpu_required": 8.0,
        "memory_required": 16.0,
        "priority": 9,
    })
    service.create_task({
        "name": "Report Generation",
        "description": "Generate monthly reports",
        "cpu_required": 1.0,
        "memory_required": 2.0,
        "priority": 4,
    })


_seed()


@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"})


def _safe_msg(e: Exception) -> str:
    """Return only the exception message string, never a traceback."""
    return e.args[0] if e.args else "An error occurred"


@app.route("/api/tasks", methods=["POST"])
def create_task():
    data = request.get_json(force=True) or {}
    try:
        task = service.create_task(data)
        return jsonify(task.to_dict()), 201
    except ValueError as e:
        return jsonify({"error": _safe_msg(e)}), 400


@app.route("/api/tasks", methods=["GET"])
def list_tasks():
    status = request.args.get("status")
    tasks = service.list_tasks(status=status)
    return jsonify([t.to_dict() for t in tasks])


@app.route("/api/tasks/<task_id>", methods=["GET"])
def get_task(task_id):
    try:
        task = service.get_task(task_id)
        return jsonify(task.to_dict())
    except KeyError as e:
        return jsonify({"error": _safe_msg(e)}), 404


@app.route("/api/tasks/<task_id>", methods=["PUT"])
def update_task(task_id):
    data = request.get_json(force=True) or {}
    try:
        task = service.update_task(task_id, data)
        return jsonify(task.to_dict())
    except KeyError as e:
        return jsonify({"error": _safe_msg(e)}), 404
    except ValueError as e:
        return jsonify({"error": _safe_msg(e)}), 400


@app.route("/api/tasks/<task_id>", methods=["DELETE"])
def cancel_task(task_id):
    try:
        task = service.cancel_task(task_id)
        return jsonify(task.to_dict())
    except KeyError as e:
        return jsonify({"error": _safe_msg(e)}), 404
    except ValueError as e:
        return jsonify({"error": _safe_msg(e)}), 400


@app.route("/api/servers", methods=["POST"])
def create_server():
    data = request.get_json(force=True) or {}
    try:
        server = service.create_server(data)
        return jsonify(server.to_dict()), 201
    except ValueError as e:
        return jsonify({"error": _safe_msg(e)}), 400


@app.route("/api/servers", methods=["GET"])
def list_servers():
    status = request.args.get("status")
    servers = service.list_servers(status=status)
    return jsonify([s.to_dict() for s in servers])


@app.route("/api/servers/<server_id>", methods=["GET"])
def get_server(server_id):
    try:
        server = service.get_server(server_id)
        return jsonify(server.to_dict())
    except KeyError as e:
        return jsonify({"error": _safe_msg(e)}), 404


@app.route("/api/servers/<server_id>", methods=["PUT"])
def update_server(server_id):
    data = request.get_json(force=True) or {}
    try:
        server = service.update_server(server_id, data)
        return jsonify(server.to_dict())
    except KeyError as e:
        return jsonify({"error": _safe_msg(e)}), 404
    except ValueError as e:
        return jsonify({"error": _safe_msg(e)}), 400


@app.route("/api/servers/<server_id>", methods=["DELETE"])
def remove_server(server_id):
    try:
        server = service.remove_server(server_id)
        return jsonify(server.to_dict())
    except KeyError as e:
        return jsonify({"error": _safe_msg(e)}), 404
    except ValueError as e:
        return jsonify({"error": _safe_msg(e)}), 400


@app.route("/api/schedule", methods=["POST"])
def schedule():
    data = request.get_json(force=True) or {}
    algorithm = data.get("algorithm", "greedy")
    try:
        result = service.run_scheduler(algorithm=algorithm)
        return jsonify(result)
    except ValueError as e:
        return jsonify({"error": _safe_msg(e)}), 400


@app.route("/api/stats", methods=["GET"])
def stats():
    return jsonify(service.get_stats())


if __name__ == "__main__":
    app.run(debug=False, host="0.0.0.0", port=5000)
