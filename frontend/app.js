/* app.js – Real-time dashboard for Cloud Resource Management Simulator */

const API = "";           // Same origin
let socket = null;
let cpuChart = null;
let memChart = null;
let statusChart = null;
let algoChart = null;
let latestData = null;

// ── Socket.IO ──────────────────────────────────────────────

function initSocket() {
  socket = io({ transports: ["websocket", "polling"] });

  socket.on("connect", () => {
    const badge = document.getElementById("conn-badge");
    badge.textContent = "● Connected";
    badge.classList.add("connected");
  });

  socket.on("disconnect", () => {
    const badge = document.getElementById("conn-badge");
    badge.textContent = "● Disconnected";
    badge.classList.remove("connected");
  });

  socket.on("system_update", (data) => {
    latestData = data;
    renderAll(data);
  });
}

// ── Charts init ────────────────────────────────────────────

function initCharts() {
  const opts = {
    responsive: true,
    animation: { duration: 300 },
    plugins: { legend: { labels: { color: "#8899aa", font: { size: 10 } } } },
    scales: {
      x: { ticks: { color: "#8899aa" }, grid: { color: "#2e3245" } },
      y: { ticks: { color: "#8899aa" }, grid: { color: "#2e3245" }, min: 0, max: 100 },
    },
  };

  cpuChart = new Chart(document.getElementById("chart-cpu"), {
    type: "bar",
    data: { labels: [], datasets: [{ label: "CPU %", data: [], backgroundColor: "#6c63ff" }] },
    options: { ...opts, plugins: { legend: { display: false } } },
  });

  memChart = new Chart(document.getElementById("chart-mem"), {
    type: "bar",
    data: { labels: [], datasets: [{ label: "MEM %", data: [], backgroundColor: "#00d4aa" }] },
    options: { ...opts, plugins: { legend: { display: false } } },
  });

  statusChart = new Chart(document.getElementById("chart-status"), {
    type: "doughnut",
    data: {
      labels: [],
      datasets: [{ data: [], backgroundColor: ["#374151","#1e3a5f","#14532d","#3b2200","#064e3b","#3b0000","#2e1065","#450a0a"] }],
    },
    options: {
      responsive: true,
      animation: { duration: 300 },
      plugins: { legend: { labels: { color: "#8899aa", font: { size: 9 } } } },
    },
  });

  algoChart = new Chart(document.getElementById("chart-algo"), {
    type: "bar",
    data: { labels: [], datasets: [{ label: "Scheduled", data: [], backgroundColor: "#6c63ff" }] },
    options: {
      ...opts,
      indexAxis: "y",
      scales: {
        x: { ticks: { color: "#8899aa" }, grid: { color: "#2e3245" }, min: 0 },
        y: { ticks: { color: "#8899aa", font: { size: 9 } }, grid: { color: "#2e3245" } },
      },
    },
  });
}

// ── Render all ─────────────────────────────────────────────

function renderAll(data) {
  renderStatsBar(data);
  renderServers(data.servers || []);
  renderCharts(data);
  renderTaskTable(data.tasks || []);
  refreshMemory();
}

function renderStatsBar(data) {
  const ss = data.system_stats || {};
  const ts = data.task_stats || {};

  const cpuPct = ss.avg_cpu_load || 0;
  const memPct = ss.avg_mem_load || 0;

  document.getElementById("stat-cpu").textContent = cpuPct.toFixed(1) + "%";
  document.getElementById("stat-mem").textContent = memPct.toFixed(1) + "%";
  document.getElementById("stat-procs").textContent = ss.active_processes || 0;
  document.getElementById("stat-queue").textContent = data.queue_size || 0;
  document.getElementById("stat-total").textContent = ts.total || 0;
  document.getElementById("stat-sla").textContent = ts.sla_met || 0;
  document.getElementById("stat-sla-miss").textContent = ts.sla_missed || 0;

  document.getElementById("bar-cpu").style.width = cpuPct + "%";
  document.getElementById("bar-mem").style.width = memPct + "%";
}

function renderServers(servers) {
  const grid = document.getElementById("servers-grid");
  grid.innerHTML = "";
  servers.forEach((s) => {
    const card = document.createElement("div");
    card.className = "server-card " + serverClass(s);
    card.innerHTML = `
      <div class="server-name">${s.server_id}</div>
      <div class="server-stat"><span>CPU</span><span>${s.cpu_load.toFixed(1)}%</span></div>
      <div class="server-bar"><div class="server-fill cpu-bar" style="width:${s.cpu_load}%"></div></div>
      <div class="server-stat"><span>MEM</span><span>${s.memory_load.toFixed(1)}%</span></div>
      <div class="server-bar"><div class="server-fill mem-bar" style="width:${s.memory_load}%"></div></div>
      <div class="server-stat"><span>Tasks</span><span>${s.running_tasks.length}</span></div>
      <div class="server-stat"><span>Ctx SW</span><span>${s.context_switches}</span></div>
      <div class="task-pills">${s.running_tasks.slice(0, 6).map(id => `<span class="task-pill">${id}</span>`).join("")}</div>
    `;
    grid.appendChild(card);
  });
}

function serverClass(s) {
  if (s.cpu_load > 80 || s.memory_load > 80) return "full";
  if (s.cpu_load > 50 || s.memory_load > 50) return "busy";
  return "healthy";
}

function renderCharts(data) {
  const servers = data.servers || [];
  const labels = servers.map((s) => s.server_id);
  const cpuVals = servers.map((s) => s.cpu_load);
  const memVals = servers.map((s) => s.memory_load);

  cpuChart.data.labels = labels;
  cpuChart.data.datasets[0].data = cpuVals;
  cpuChart.update();

  memChart.data.labels = labels;
  memChart.data.datasets[0].data = memVals;
  memChart.update();

  // Status doughnut
  const byStatus = (data.task_stats || {}).by_status || {};
  statusChart.data.labels = Object.keys(byStatus);
  statusChart.data.datasets[0].data = Object.values(byStatus);
  statusChart.update();

  // Algorithm usage bar
  const algoStats = data.algo_stats || {};
  const algoLabels = [];
  const algoVals = [];
  Object.entries(algoStats).forEach(([key, val]) => {
    algoLabels.push(key.replace(/_/g, " "));
    algoVals.push(val.scheduled || 0);
  });
  algoChart.data.labels = algoLabels;
  algoChart.data.datasets[0].data = algoVals;
  algoChart.update();
}

function renderTaskTable(tasks) {
  const statusFilter = document.getElementById("filter-status").value;
  const algoFilter = document.getElementById("filter-algo").value;

  let filtered = tasks;
  if (statusFilter) filtered = filtered.filter((t) => t.status === statusFilter);
  if (algoFilter) filtered = filtered.filter((t) => t.algorithm_used === algoFilter);

  // Latest first
  filtered = filtered.slice().sort((a, b) => b.created_at - a.created_at).slice(0, 80);

  const tbody = document.getElementById("task-tbody");
  tbody.innerHTML = "";
  filtered.forEach((t) => {
    const row = document.createElement("tr");
    const progress = Math.min(100, t.progress || 0);
    row.innerHTML = `
      <td><code>${t.task_id}</code></td>
      <td>${escHtml(t.name)}</td>
      <td><strong>${t.priority}</strong></td>
      <td><span class="status-badge s-${t.status}">${t.status}</span></td>
      <td>${t.algorithm_used ? algoShort(t.algorithm_used) : "—"}</td>
      <td>${t.assigned_server || "—"}</td>
      <td>
        <div class="progress-wrap">
          <div class="progress-fill" style="width:${progress}%"></div>
        </div>
        <span style="font-size:9px;color:var(--text-muted)">${progress.toFixed(0)}%</span>
      </td>
      <td>
        ${t.status !== "COMPLETED" && t.status !== "TERMINATED"
          ? `<button class="btn btn-danger" onclick="deleteTask('${t.task_id}')">✕</button>`
          : ""}
      </td>
    `;
    // Add decision log on hover
    if (t.decision_log) {
      row.title = t.decision_log;
    }
    tbody.appendChild(row);
  });
}

function algoShort(name) {
  const map = {
    "Greedy (Least Loaded)": "Greedy",
    "0-1 Knapsack": "Knapsack",
    "FCFS": "FCFS",
    "Priority Scheduling": "Priority",
    "Round Robin": "RR",
    "LRU Cache Eviction": "LRU",
  };
  return map[name] || name;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── Decision log ───────────────────────────────────────────

function addLog(message, success = true) {
  const container = document.getElementById("log-entries");
  const entry = document.createElement("div");
  entry.className = "log-entry " + (success ? "success" : "fail");
  entry.textContent = new Date().toLocaleTimeString() + " – " + message;
  container.prepend(entry);
  // Keep only last 30 logs
  while (container.children.length > 30) {
    container.removeChild(container.lastChild);
  }
}

// ── Memory panel ───────────────────────────────────────────

async function refreshMemory() {
  try {
    const res = await fetch(API + "/memory");
    const data = await res.json();
    const stats = data.stats || {};
    document.getElementById("mem-stats").textContent =
      `Allocated: ${stats.total_allocated_mb || 0} MB | Blocks: ${stats.block_count || 0}`;

    const container = document.getElementById("mem-blocks");
    container.innerHTML = "";
    (data.blocks || []).forEach((b, i) => {
      const el = document.createElement("div");
      el.className = "mem-block";
      el.innerHTML = `<span class="lru-tag">#${i + 1}</span> ${b.block_id} ${b.size}MB <span style="color:var(--warn)">${b.age}s</span>`;
      container.appendChild(el);
    });
  } catch (_) {}
}

// ── Algorithm comparison ───────────────────────────────────

async function runComparison() {
  const container = document.getElementById("compare-results");
  container.innerHTML = "<div style='color:var(--text-muted)'>Running benchmark…</div>";
  try {
    const res = await fetch(API + "/algorithms/compare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sample_tasks: 10 }),
    });
    const results = await res.json();
    container.innerHTML = "";
    results.forEach((r) => {
      const row = document.createElement("div");
      row.className = "algo-row";
      row.innerHTML = `
        <span class="algo-label" title="${r.algorithm}">${r.algorithm}</span>
        <div class="algo-bar-wrap">
          <div class="algo-bar-fill" style="width:${r.success_rate}%"></div>
        </div>
        <span class="algo-pct">${r.success_rate}%</span>
      `;
      container.appendChild(row);
    });
  } catch (_) {
    container.innerHTML = "<div style='color:var(--red)'>Benchmark failed</div>";
  }
}

// ── Task actions ───────────────────────────────────────────

async function deleteTask(taskId) {
  try {
    await fetch(API + "/tasks/" + taskId, { method: "DELETE" });
    addLog(`Terminated task ${taskId}`, false);
    socket.emit("request_update");
  } catch (_) {}
}

// ── Task submission ────────────────────────────────────────

function getFormData() {
  return {
    name: document.getElementById("f-name").value,
    cpu_required: parseFloat(document.getElementById("f-cpu").value),
    memory_required: parseFloat(document.getElementById("f-mem").value),
    execution_time: parseFloat(document.getElementById("f-exec").value),
    priority: parseInt(document.getElementById("f-priority").value, 10),
    deadline_seconds: parseFloat(document.getElementById("f-deadline").value),
    sla_threshold: parseFloat(document.getElementById("f-sla").value),
    user_id: document.getElementById("f-user").value,
    tenant_id: document.getElementById("f-tenant").value,
    algorithm: document.getElementById("f-algo").value,
  };
}

document.getElementById("task-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const payload = getFormData();
  try {
    const res = await fetch(API + "/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const task = await res.json();
    addLog(task.decision_log || `Task ${task.task_id} submitted`, res.ok);
    socket.emit("request_update");
  } catch (err) {
    addLog("Submit failed: " + err.message, false);
  }
});

document.getElementById("batch-btn").addEventListener("click", async () => {
  const base = getFormData();
  const tasks = Array.from({ length: 5 }, (_, i) => ({
    ...base,
    name: base.name + `-${i + 1}`,
    priority: Math.min(10, base.priority + (i % 3) - 1),
  }));
  try {
    const res = await fetch(API + "/tasks/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tasks, algorithm: base.algorithm }),
    });
    const data = await res.json();
    addLog(`Batch ${data.batch_id}: scheduled ${data.count} tasks`, res.ok);
    socket.emit("request_update");
  } catch (err) {
    addLog("Batch failed: " + err.message, false);
  }
});

document.getElementById("demo-btn").addEventListener("click", async () => {
  try {
    const res = await fetch(API + "/demo/load", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ count: 15 }),
    });
    const data = await res.json();
    addLog(`Demo: generated ${data.generated} tasks across all algorithms`);
    socket.emit("request_update");
  } catch (err) {
    addLog("Demo failed: " + err.message, false);
  }
});

document.getElementById("evict-btn").addEventListener("click", async () => {
  try {
    const res = await fetch(API + "/memory/evict", { method: "POST" });
    const data = await res.json();
    if (data.evicted) {
      addLog(`LRU evicted block ${data.evicted.block_id} (${data.evicted.size}MB)`);
    } else {
      addLog("Nothing to evict", false);
    }
    refreshMemory();
  } catch (_) {}
});

document.getElementById("compare-btn").addEventListener("click", runComparison);

// Filters
document.getElementById("filter-status").addEventListener("change", () => {
  if (latestData) renderTaskTable(latestData.tasks || []);
});
document.getElementById("filter-algo").addEventListener("change", () => {
  if (latestData) renderTaskTable(latestData.tasks || []);
});

// ── Init ───────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  initCharts();
  initSocket();
  // Fallback: also poll REST if WS lags
  setInterval(() => {
    if (!socket || !socket.connected) {
      fetch(API + "/status")
        .then((r) => r.json())
        .then((d) => { latestData = d; renderAll(d); })
        .catch(() => {});
    }
  }, 3000);
});
