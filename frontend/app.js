const API = 'http://localhost:5000/api';

const ALGO_DESCRIPTIONS = {
  greedy: 'Picks the server with the most available resources (CPU + Memory weighted sum). O(n) time.',
  fcfs: 'Processes tasks in creation order and assigns each to the first server that fits. O(n) time.',
  priority: 'Sorts tasks by urgency score descending. Supports preemption of lower-priority running tasks. O(n log n) time.',
  round_robin: 'Cycles through active servers in order, distributing load evenly. O(1) per assignment.',
};

// ── Navigation ────────────────────────────────────────────────────────────────

document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', e => {
    e.preventDefault();
    const target = item.dataset.section;
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    item.classList.add('active');
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    document.getElementById(target).classList.add('active');
    if (target === 'tasks') loadTasks();
    if (target === 'servers') loadServers();
    if (target === 'dashboard') refreshAll();
  });
});

// ── Algorithm description update ─────────────────────────────────────────────

document.getElementById('schedAlgorithm').addEventListener('change', function () {
  document.getElementById('algoDesc').textContent = ALGO_DESCRIPTIONS[this.value] || '';
});

// ── API helpers ───────────────────────────────────────────────────────────────

async function apiFetch(path, options = {}) {
  const res = await fetch(API + path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ── Stats / Dashboard ─────────────────────────────────────────────────────────

async function loadStats() {
  try {
    const s = await apiFetch('/stats');
    document.getElementById('statTotalTasks').textContent = s.total_tasks ?? 0;
    document.getElementById('statRunning').textContent = s.task_status_counts?.RUNNING ?? 0;
    document.getElementById('statCompleted').textContent = s.task_status_counts?.COMPLETED ?? 0;
    document.getElementById('statServers').textContent = s.total_servers ?? 0;
    document.getElementById('statCpuUtil').textContent = (s.cluster_cpu_utilization_pct ?? 0) + '%';
    document.getElementById('statSlaRisk').textContent = s.sla_at_risk ?? 0;
  } catch (e) {
    console.error('Stats error:', e);
  }
}

async function loadRecentTasks() {
  try {
    const tasks = await apiFetch('/tasks');
    const sorted = tasks.sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 6);
    const container = document.getElementById('recentTasksList');
    if (sorted.length === 0) { container.innerHTML = '<p class="text-muted">No tasks yet.</p>'; return; }
    container.innerHTML = sorted.map(t => `
      <div class="mini-task-row">
        <span>${escHtml(t.name)}</span>
        ${statusBadge(t.status)}
      </div>`).join('');
  } catch (e) { console.error(e); }
}

async function loadServerHealth() {
  try {
    const servers = await apiFetch('/servers');
    const container = document.getElementById('serverHealthList');
    if (servers.length === 0) { container.innerHTML = '<p class="text-muted">No servers yet.</p>'; return; }
    container.innerHTML = servers.map(s => {
      const color = s.health_score >= 0.7 ? '#22c55e' : s.health_score >= 0.4 ? '#f59e0b' : '#ef4444';
      return `
        <div class="mini-task-row">
          <span><span class="health-dot" style="background:${color}"></span>${escHtml(s.name)}</span>
          <span class="text-muted">${s.utilization.overall}% util</span>
        </div>`;
    }).join('');
  } catch (e) { console.error(e); }
}

function refreshAll() {
  loadStats();
  loadRecentTasks();
  loadServerHealth();
}

// ── Tasks ─────────────────────────────────────────────────────────────────────

async function loadTasks() {
  const status = document.getElementById('taskStatusFilter').value;
  const path = status ? `/tasks?status=${status}` : '/tasks';
  try {
    const tasks = await apiFetch(path);
    const tbody = document.getElementById('tasksTableBody');
    if (tasks.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-row">No tasks found.</td></tr>';
      return;
    }
    tbody.innerHTML = tasks.map(t => `
      <tr>
        <td><strong>${escHtml(t.name)}</strong><br><small class="text-muted">${escHtml(t.description || '')}</small></td>
        <td><span class="badge badge-pending">${t.priority}</span></td>
        <td>${t.cpu_required} cores</td>
        <td>${t.memory_required} GB</td>
        <td>${statusBadge(t.status)}${t.sla_at_risk ? ' <span title="SLA at risk" style="color:#ef4444">⚠</span>' : ''}</td>
        <td>${t.urgency_score.toFixed(1)}</td>
        <td>
          ${t.status === 'PENDING' || t.status === 'RUNNING'
            ? `<button class="btn btn-danger btn-sm" onclick="cancelTask('${t.id}')">Cancel</button>`
            : ''}
        </td>
      </tr>`).join('');
  } catch (e) { console.error(e); }
}

async function createTask() {
  const name = document.getElementById('taskName').value.trim();
  const desc = document.getElementById('taskDesc').value.trim();
  const cpu = parseFloat(document.getElementById('taskCpu').value);
  const mem = parseFloat(document.getElementById('taskMem').value);
  const priority = parseInt(document.getElementById('taskPriority').value);
  const deadlineInput = document.getElementById('taskDeadline').value;

  const errEl = document.getElementById('taskFormError');
  errEl.classList.add('hidden');

  if (!name || isNaN(cpu) || isNaN(mem) || isNaN(priority)) {
    errEl.textContent = 'Please fill in all required fields.';
    errEl.classList.remove('hidden');
    return;
  }

  const body = { name, description: desc, cpu_required: cpu, memory_required: mem, priority };
  if (deadlineInput) body.deadline = new Date(deadlineInput).toISOString();

  try {
    await apiFetch('/tasks', { method: 'POST', body: JSON.stringify(body) });
    hideModal('addTaskModal');
    clearTaskForm();
    loadTasks();
    refreshAll();
  } catch (e) {
    errEl.textContent = e.message;
    errEl.classList.remove('hidden');
  }
}

async function cancelTask(id) {
  if (!confirm('Cancel this task?')) return;
  try {
    await apiFetch(`/tasks/${id}`, { method: 'DELETE' });
    loadTasks();
    refreshAll();
  } catch (e) { alert('Error: ' + e.message); }
}

function clearTaskForm() {
  ['taskName', 'taskDesc', 'taskCpu', 'taskMem', 'taskPriority', 'taskDeadline']
    .forEach(id => { document.getElementById(id).value = ''; });
  document.getElementById('taskFormError').classList.add('hidden');
}

// ── Servers ───────────────────────────────────────────────────────────────────

async function loadServers() {
  try {
    const servers = await apiFetch('/servers');
    const grid = document.getElementById('serversGrid');
    if (servers.length === 0) { grid.innerHTML = '<p class="text-muted">No servers found.</p>'; return; }
    grid.innerHTML = servers.map(s => serverCard(s)).join('');
  } catch (e) { console.error(e); }
}

function serverCard(s) {
  const statusClass = s.status === 'ACTIVE' ? '' : s.status === 'INACTIVE' ? 'inactive' : 'maintenance';
  const cpuPct = s.utilization.cpu_pct;
  const memPct = s.utilization.memory_pct;
  const barClass = pct => pct > 85 ? 'danger' : pct > 60 ? 'warn' : '';
  const healthColor = s.health_score >= 0.7 ? '#22c55e' : s.health_score >= 0.4 ? '#f59e0b' : '#ef4444';

  return `
    <div class="server-card ${statusClass}">
      <div class="server-name">
        <span class="health-dot" style="background:${healthColor}"></span>
        ${escHtml(s.name)}
      </div>
      <div class="server-meta">${s.tasks.length} task(s) · ${s.status}</div>
      <div class="server-stat-row"><span>CPU</span><span>${s.available_cpu}/${s.total_cpu} cores free</span></div>
      <div class="progress-wrap"><div class="progress-bar ${barClass(cpuPct)}" style="width:${cpuPct}%"></div></div>
      <div class="server-stat-row" style="margin-top:8px"><span>Memory</span><span>${s.available_memory}/${s.total_memory} GB free</span></div>
      <div class="progress-wrap"><div class="progress-bar ${barClass(memPct)}" style="width:${memPct}%"></div></div>
      <div style="margin-top:10px;display:flex;justify-content:space-between;align-items:center;font-size:0.8rem;">
        <span class="text-muted">Health: ${(s.health_score * 100).toFixed(0)}%</span>
        ${s.tasks.length === 0
          ? `<button class="btn btn-danger btn-sm" onclick="deleteServer('${s.id}')">Remove</button>`
          : `<span class="text-muted">${s.tasks.length} active task(s)</span>`}
      </div>
    </div>`;
}

async function createServer() {
  const name = document.getElementById('serverName').value.trim();
  const cpu = parseFloat(document.getElementById('serverCpu').value);
  const mem = parseFloat(document.getElementById('serverMem').value);
  const errEl = document.getElementById('serverFormError');
  errEl.classList.add('hidden');

  if (!name || isNaN(cpu) || isNaN(mem)) {
    errEl.textContent = 'Please fill in all required fields.';
    errEl.classList.remove('hidden');
    return;
  }

  try {
    await apiFetch('/servers', { method: 'POST', body: JSON.stringify({ name, total_cpu: cpu, total_memory: mem }) });
    hideModal('addServerModal');
    document.getElementById('serverName').value = '';
    document.getElementById('serverCpu').value = '';
    document.getElementById('serverMem').value = '';
    errEl.classList.add('hidden');
    loadServers();
    refreshAll();
  } catch (e) {
    errEl.textContent = e.message;
    errEl.classList.remove('hidden');
  }
}

async function deleteServer(id) {
  if (!confirm('Remove this server?')) return;
  try {
    await apiFetch(`/servers/${id}`, { method: 'DELETE' });
    loadServers();
    refreshAll();
  } catch (e) { alert('Error: ' + e.message); }
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

async function runScheduler() {
  const algorithm = document.getElementById('schedAlgorithm').value;
  const resultEl = document.getElementById('schedulerResult');
  resultEl.innerHTML = '<p class="text-muted">Running…</p>';
  try {
    const result = await apiFetch('/schedule', { method: 'POST', body: JSON.stringify({ algorithm }) });
    const assignments = result.assignments || [];
    resultEl.innerHTML = `
      <div class="summary-banner">
        ✓ Scheduled ${result.scheduled_count} task(s) using <em>${result.algorithm}</em>
        &nbsp;·&nbsp; ${result.pending_remaining} pending remaining
      </div>
      ${assignments.length === 0
        ? '<p class="text-muted">No tasks were assigned (no pending tasks or insufficient resources).</p>'
        : assignments.map(a => `
          <div class="result-item">
            <span class="text-success">✓ ${escHtml(a.task_name)}</span>
            <span class="text-muted">→ ${escHtml(a.server_name)}</span>
          </div>`).join('')}`;
    loadTasks();
    loadServers();
    refreshAll();
  } catch (e) {
    resultEl.innerHTML = `<p style="color:#ef4444">Error: ${escHtml(e.message)}</p>`;
  }
}

// ── Modal helpers ─────────────────────────────────────────────────────────────

function showModal(id) { document.getElementById(id).classList.add('open'); }
function hideModal(id) { document.getElementById(id).classList.remove('open'); }
function closeModalOnOverlay(e, id) { if (e.target.id === id) hideModal(id); }

// ── Utility ───────────────────────────────────────────────────────────────────

function statusBadge(status) {
  const cls = { PENDING: 'pending', RUNNING: 'running', COMPLETED: 'completed', FAILED: 'failed', CANCELLED: 'cancelled' };
  return `<span class="badge badge-${cls[status] || 'pending'}">${status}</span>`;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Auto-refresh ──────────────────────────────────────────────────────────────

function autoRefreshTick() {
  const active = document.querySelector('.section.active');
  if (!active) return;
  const id = active.id;
  if (id === 'dashboard') refreshAll();
  else if (id === 'tasks') loadTasks();
  else if (id === 'servers') loadServers();
}

setInterval(autoRefreshTick, 5000);

// ── Init ──────────────────────────────────────────────────────────────────────

refreshAll();
