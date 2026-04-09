/**
 * Cloud Resource Management Simulator - Frontend Dashboard
 * Real-time visualization with MiniChart (no external CDN required)
 */

'use strict';

const API = '';  // Same-origin

// ─── State ────────────────────────────────────────────────────────────────────
let cpuChart = null;
let memChart = null;
let algoChart = null;
let cpuHistoryByServer = {};
let memHistoryByServer = {};
let decisionsSeen = new Set();

// Chart colors per server
const SERVER_COLORS = [
  '#58a6ff', '#3fb950', '#d29922', '#f85149',
  '#bc8cff', '#39d353', '#f0883e', '#79c0ff',
];

const ALGO_KEYS = ['greedy', 'knapsack', 'fcfs', 'priority', 'roundrobin'];
const ALGO_LABELS = ['Greedy', 'Knapsack', 'FCFS', 'Priority', 'Round Robin'];

// ─── Initialization ───────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initCharts();
  attachEventListeners();
  refresh();
  setInterval(refresh, 2000);
});

// ─── Charts ───────────────────────────────────────────────────────────────────
function initCharts() {
  cpuChart = new MiniChart(document.getElementById('cpuChart'), 'line');
  memChart = new MiniChart(document.getElementById('memChart'), 'line');
  algoChart = new MiniChart(document.getElementById('algoChart'), 'bar');

  // Initialize algo chart with empty data
  algoChart.setData({
    labels: ALGO_LABELS,
    datasets: [
      { label: 'Scheduled', data: [0,0,0,0,0], backgroundColor: 'rgba(88,166,255,0.6)', borderColor: '#58a6ff' },
      { label: 'Completed', data: [0,0,0,0,0], backgroundColor: 'rgba(63,185,80,0.6)',  borderColor: '#3fb950' },
      { label: 'Violations', data: [0,0,0,0,0], backgroundColor: 'rgba(248,81,73,0.6)', borderColor: '#f85149' },
    ],
  });
}

// ─── Main Refresh Loop ────────────────────────────────────────────────────────
async function refresh() {
  try {
    const [statusData, tasksData, queueData, decisionsData, algoStatsData] = await Promise.all([
      apiFetch('/api/status'),
      apiFetch('/api/tasks?limit=50'),
      apiFetch('/api/queue'),
      apiFetch('/api/decisions?limit=30'),
      apiFetch('/api/scheduler/stats'),
    ]);

    if (statusData.success) {
      updateStatsBar(statusData);
      updateServerCards(statusData.servers);
      updateCharts(statusData.servers);
      updateAlgoSelector(statusData.algorithm);
    }
    if (tasksData.success) updateActiveTasks(tasksData.tasks || []);
    if (queueData.success) updateQueue(queueData.tasks || []);
    if (decisionsData.success) updateDecisionLog(decisionsData.decisions || []);
    if (algoStatsData.success) updateAlgoChart(algoStatsData.stats || {});

    document.getElementById('lastUpdated').textContent = `Updated: ${new Date().toLocaleTimeString()}`;
  } catch (err) {
    console.error('Refresh error:', err);
  }
}

// ─── Stats Bar ────────────────────────────────────────────────────────────────
function updateStatsBar(data) {
  const m = data.systemMetrics || {};
  setText('statServerCount', m.activeServers ?? 0);
  setText('statActiveTasks', m.activeTasks ?? 0);
  setText('statQueueDepth', data.queueDepth ?? 0);
  setText('statAvgCpu', `${m.avgCpuUtilization ?? 0}%`);
  setText('statAvgMem', `${m.avgMemoryUtilization ?? 0}%`);
  setText('statSlaViolations', m.slaViolations ?? 0);
  setText('statCompleted', m.totalTasksCompleted ?? 0);
  setText('statContextSwitches', m.contextSwitches ?? 0);
}

// ─── Server Cards ─────────────────────────────────────────────────────────────
function updateServerCards(servers) {
  const grid = document.getElementById('serverGrid');
  if (!servers || servers.length === 0) {
    grid.innerHTML = '<div class="empty-msg">No servers</div>';
    return;
  }

  const current = new Set(servers.map(s => String(s.id)));
  grid.querySelectorAll('.server-card').forEach(el => {
    if (!current.has(el.dataset.id)) el.remove();
  });

  servers.forEach((server) => {
    const id = String(server.id);
    let card = grid.querySelector(`.server-card[data-id="${id}"]`);
    if (!card) {
      card = document.createElement('div');
      card.className = 'server-card';
      card.dataset.id = id;
      grid.appendChild(card);
    }

    card.className = `server-card ${server.status}`;
    const cpuPct = server.cpuUtilization;
    const memPct = server.memoryUtilization;

    card.innerHTML = `
      <div class="server-header">
        <div class="server-name">🖥️ ${server.name}</div>
        <div class="server-status status-${server.status}">${server.status}</div>
      </div>
      <div class="server-region">📍 ${server.region} &nbsp;|&nbsp; ${server.taskCount} task${server.taskCount !== 1 ? 's' : ''}</div>
      <div class="resource-bar">
        <div class="resource-label"><span>CPU</span><span>${server.usedCpu}% / ${server.totalCpu}%</span></div>
        <div class="bar-track"><div class="bar-fill cpu ${cpuPct > 85 ? 'high' : cpuPct > 65 ? 'warn' : ''}" style="width:${cpuPct}%"></div></div>
      </div>
      <div class="resource-bar">
        <div class="resource-label"><span>Memory</span><span>${(server.usedMemory/1024).toFixed(1)}GB / ${(server.totalMemory/1024).toFixed(1)}GB</span></div>
        <div class="bar-track"><div class="bar-fill mem ${memPct > 85 ? 'high' : memPct > 65 ? 'warn' : ''}" style="width:${memPct}%"></div></div>
      </div>
      <div class="server-footer">
        <span>Load: ${server.loadScore}% &nbsp;|&nbsp; Switches: ${server.contextSwitches}</span>
        <button class="server-remove-btn" data-server-id="${server.id}" title="Remove server">✕</button>
      </div>
    `;
  });

  grid.querySelectorAll('.server-remove-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const sid = btn.dataset.serverId;
      if (!confirm(`Remove Server-${sid}?`)) return;
      await apiFetch(`/api/servers/${sid}`, { method: 'DELETE' });
      showToast(`Server-${sid} removed`, 'info');
      refresh();
    });
  });
}

// ─── Real-time Charts ─────────────────────────────────────────────────────────
function updateCharts(servers) {
  if (!servers) return;

  servers.forEach(server => {
    const id = server.id;
    if (!cpuHistoryByServer[id]) cpuHistoryByServer[id] = Array(20).fill(0);
    if (!memHistoryByServer[id]) memHistoryByServer[id] = Array(20).fill(0);

    cpuHistoryByServer[id].push(server.cpuUtilization);
    memHistoryByServer[id].push(server.memoryUtilization);
    if (cpuHistoryByServer[id].length > 20) cpuHistoryByServer[id].shift();
    if (memHistoryByServer[id].length > 20) memHistoryByServer[id].shift();
  });

  const cpuDatasets = servers.map((server, idx) => ({
    label: server.name,
    data: [...cpuHistoryByServer[server.id]],
    borderColor: SERVER_COLORS[idx % SERVER_COLORS.length],
    backgroundColor: SERVER_COLORS[idx % SERVER_COLORS.length] + '22',
    borderWidth: 2,
  }));

  const memDatasets = servers.map((server, idx) => ({
    label: server.name,
    data: [...memHistoryByServer[server.id]],
    borderColor: SERVER_COLORS[idx % SERVER_COLORS.length],
    backgroundColor: SERVER_COLORS[idx % SERVER_COLORS.length] + '22',
    borderWidth: 2,
  }));

  cpuChart.setData({ labels: Array(20).fill(''), datasets: cpuDatasets });
  memChart.setData({ labels: Array(20).fill(''), datasets: memDatasets });
}

// ─── Algorithm Comparison Chart ───────────────────────────────────────────────
function updateAlgoChart(stats) {
  algoChart.setData({
    labels: ALGO_LABELS,
    datasets: [
      { label: 'Scheduled',  data: ALGO_KEYS.map(k => stats[k]?.scheduled || 0),      backgroundColor: 'rgba(88,166,255,0.7)', borderColor: '#58a6ff' },
      { label: 'Completed',  data: ALGO_KEYS.map(k => stats[k]?.completed || 0),      backgroundColor: 'rgba(63,185,80,0.7)',  borderColor: '#3fb950' },
      { label: 'Violations', data: ALGO_KEYS.map(k => stats[k]?.slaViolations || 0),  backgroundColor: 'rgba(248,81,73,0.7)',  borderColor: '#f85149' },
    ],
  });
}

// ─── Task Queue ───────────────────────────────────────────────────────────────
function updateQueue(tasks) {
  const el = document.getElementById('taskQueue');
  const badge = document.getElementById('queueBadge');
  badge.textContent = tasks.length;

  if (tasks.length === 0) {
    el.innerHTML = '<div class="empty-msg">Queue is empty</div>';
    return;
  }

  el.innerHTML = tasks.map(t => `
    <div class="task-item">
      <div class="task-id">#${t.id}</div>
      <div class="${priorityClass(t.priority)} task-priority">${t.priority}</div>
      <div class="task-details">
        ${t.cpu}% CPU &bull; ${t.memory}MB &bull; ${t.executionTime}s
        ${t.deadline ? `&bull; ⏰ ${formatTime(t.deadline)}` : ''}
      </div>
      <button class="cancel-btn" data-task-id="${t.id}" title="Cancel">✕</button>
    </div>
  `).join('');

  attachCancelHandlers(el);
}

// ─── Active Tasks ─────────────────────────────────────────────────────────────
function updateActiveTasks(allTasks) {
  const tasks = allTasks.filter(t => t.status === 'running').slice(0, 20);
  const el = document.getElementById('activeTasks');
  const badge = document.getElementById('activeBadge');
  badge.textContent = tasks.length;

  if (tasks.length === 0) {
    el.innerHTML = '<div class="empty-msg">No active tasks</div>';
    return;
  }

  el.innerHTML = tasks.map(t => `
    <div class="task-item">
      <div class="task-id">#${t.id}</div>
      <div class="${priorityClass(t.priority)} task-priority">${t.priority}</div>
      <div class="task-details">
        Server-${t.assignedServer} &bull; ${t.cpu}% CPU &bull; ${t.memory}MB
        &bull; <span style="color:#58a6ff">${t.scheduledBy}</span>
      </div>
      <button class="cancel-btn" data-task-id="${t.id}" title="Cancel">✕</button>
    </div>
  `).join('');

  attachCancelHandlers(el);
}

// ─── Decision Log ─────────────────────────────────────────────────────────────
function updateDecisionLog(decisions) {
  const el = document.getElementById('decisionLog');

  const newEntries = decisions.filter(d => {
    const key = d.timestamp + d.message;
    if (decisionsSeen.has(key)) return false;
    decisionsSeen.add(key);
    return true;
  });

  if (newEntries.length === 0) return;

  if (el.querySelector('.empty-msg')) el.innerHTML = '';

  newEntries.forEach(d => {
    const entry = document.createElement('div');
    entry.className = 'decision-entry';
    const timeStr = new Date(d.timestamp).toLocaleTimeString();
    const type = detectDecisionType(d.message);
    entry.innerHTML = `<span class="decision-time">[${timeStr}]</span><span class="decision-text ${type}">${escapeHtml(d.message)}</span>`;
    el.insertBefore(entry, el.firstChild);
  });

  while (el.children.length > 100) el.removeChild(el.lastChild);
}

function detectDecisionType(msg) {
  if (msg.includes('Greedy')) return 'greedy';
  if (msg.includes('Knapsack')) return 'knapsack';
  if (msg.includes('FCFS')) return 'fcfs';
  if (msg.includes('Priority')) return 'priority';
  if (msg.includes('Round Robin')) return 'roundrobin';
  if (msg.includes('Auto-scale') || msg.includes('Drained')) return 'autoscale';
  if (msg.includes('ERROR') || msg.includes('REJECTED') || msg.includes('VIOLATION')) return 'error';
  return '';
}

// ─── Algo Selector ────────────────────────────────────────────────────────────
function updateAlgoSelector(currentAlgo) {
  const sel = document.getElementById('algorithmSelect');
  if (sel && currentAlgo && sel.value !== currentAlgo) {
    sel.value = currentAlgo;
  }
}

// ─── Event Listeners ──────────────────────────────────────────────────────────
function attachEventListeners() {
  document.getElementById('setAlgoBtn').addEventListener('click', async () => {
    const algo = document.getElementById('algorithmSelect').value;
    const data = await apiFetch('/api/scheduler', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ algorithm: algo }),
    });
    if (data.success) showToast(`Algorithm: ${data.algorithm}`, 'success');
    else showToast(data.error, 'error');
  });

  document.getElementById('taskForm').addEventListener('submit', async e => {
    e.preventDefault();
    const task = buildTaskFromForm();
    const data = await apiFetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(task),
    });
    const fb = document.getElementById('taskFeedback');
    if (data.success) {
      fb.textContent = data.message;
      fb.className = 'feedback-msg success';
      showToast(`Task#${data.task.id} → ${data.task.status}`, 'success');
    } else {
      fb.textContent = data.error;
      fb.className = 'feedback-msg error';
    }
    setTimeout(() => { fb.textContent = ''; }, 3000);
    refresh();
  });

  document.getElementById('randomTaskBtn').addEventListener('click', () => {
    document.getElementById('fCpu').value = Math.floor(Math.random() * 40) + 5;
    document.getElementById('fMemory').value = [128, 256, 512, 1024, 2048][Math.floor(Math.random() * 5)];
    document.getElementById('fExecTime').value = Math.floor(Math.random() * 30) + 5;
    document.getElementById('fPriority').value = Math.floor(Math.random() * 10) + 1;
    document.getElementById('fUserId').value = `user${Math.floor(Math.random() * 10) + 1}`;
  });

  document.getElementById('submitBatchBtn').addEventListener('click', async () => {
    const base = buildTaskFromForm();
    const tasks = Array.from({ length: 5 }, (_, i) => ({
      ...base,
      cpu: Math.max(5, base.cpu + Math.round(Math.random() * 20 - 10)),
      memory: Math.max(128, base.memory + Math.round(Math.random() * 512 - 256)),
      priority: Math.max(1, Math.min(10, base.priority + Math.round(Math.random() * 4 - 2))),
      executionTime: Math.max(1, base.executionTime + Math.round(Math.random() * 10 - 5)),
    }));
    const data = await apiFetch('/api/tasks/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tasks }),
    });
    if (data.success) showToast(`Batch: ${data.created} tasks, ${data.scheduledImmediately} running`, 'success');
    else showToast(data.error, 'error');
    refresh();
  });

  document.getElementById('addServerBtn').addEventListener('click', async () => {
    const data = await apiFetch('/api/servers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (data.success) showToast(data.message, 'success');
    else showToast(data.error, 'error');
    refresh();
  });

  document.getElementById('clearDecisionsBtn').addEventListener('click', () => {
    document.getElementById('decisionLog').innerHTML = '<div class="empty-msg">No decisions yet</div>';
    decisionsSeen.clear();
  });
}

function attachCancelHandlers(container) {
  container.querySelectorAll('.cancel-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.taskId;
      const data = await apiFetch(`/api/tasks/${id}`, { method: 'DELETE' });
      if (data.success) showToast(`Task#${id} cancelled`, 'info');
      refresh();
    });
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function buildTaskFromForm() {
  const deadline = document.getElementById('fDeadline').value;
  return {
    cpu: parseInt(document.getElementById('fCpu').value, 10),
    memory: parseInt(document.getElementById('fMemory').value, 10),
    executionTime: parseInt(document.getElementById('fExecTime').value, 10),
    priority: parseInt(document.getElementById('fPriority').value, 10),
    userId: document.getElementById('fUserId').value || 'anonymous',
    deadline: deadline || null,
  };
}

async function apiFetch(url, options = {}) {
  try {
    const res = await fetch(API + url, options);
    return await res.json();
  } catch (err) {
    console.error(`API error ${url}:`, err);
    return { success: false, error: err.message };
  }
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function priorityClass(p) {
  if (p >= 8) return 'priority-high';
  if (p >= 5) return 'priority-mid';
  return 'priority-low';
}

function formatTime(dt) {
  return dt ? new Date(dt).toLocaleTimeString() : '';
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showToast(msg, type = 'info') {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

