// script.js — improved quality, same logic
const API_BASE = 'http://127.0.0.1:8000';

const qs = (id) => document.getElementById(id);
const tasks = []; // Local tasks list

// --- Globals defaults (safe) ---
window.tasksAnalyzed = Array.isArray(window.tasksAnalyzed) ? window.tasksAnalyzed : [];
window.lastAnalyzeCycles = Array.isArray(window.lastAnalyzeCycles) ? window.lastAnalyzeCycles : [];


function setAnalyzedData(data = [], cycles = []) {
  window.tasksAnalyzed = Array.isArray(data) ? data : [];
  window.lastAnalyzeCycles = Array.isArray(cycles) ? cycles : window.lastAnalyzeCycles || [];
  // trigger graph refresh (safe)
  if (typeof window.renderDependencyGraphFromUI === 'function') {
    try { window.renderDependencyGraphFromUI(); } catch (e) { console.warn('Graph render failed', e); }
  }
}

/** Always returns an array to avoid undefined checks */
function getAnalyzedSource() {
  if (Array.isArray(window.tasksAnalyzed) && window.tasksAnalyzed.length > 0) return window.tasksAnalyzed;
  if (Array.isArray(window.tasks) && window.tasks.length > 0) return window.tasks;
  return [];
}

// Show / hide loading spinner
function showLoading(state) {
  const ld = qs('loading');
  if (ld) ld.style.display = state ? 'inline-block' : 'none';
  if (qs('analyzeBtn')) qs('analyzeBtn').disabled = state;
  const btnBottom = qs('analyzeBtnBottom');
  if (btnBottom) btnBottom.disabled = state;
}

// Parse dependencies from comma-separated input
function parseDependencies(input) {
  if (!input) return [];
  return input.split(',').map(x => x.trim()).filter(Boolean).map(Number);
}

// Reset form fields
function resetForm() {
  if (qs('title')) qs('title').value = '';
  if (qs('due_date')) qs('due_date').value = '';
  if (qs('estimated_hours')) qs('estimated_hours').value = '';
  if (qs('importance')) qs('importance').value = 5;
  if (qs('dependencies')) qs('dependencies').value = '';
}

// Sanitize dependencies: dedupe, integer cast, remove self-dep
function sanitizeDepsForTask(task) {
  const id = Number(task.id || 0);
  if (!Array.isArray(task.dependencies)) task.dependencies = [];
  const cleaned = Array.from(new Set(
    task.dependencies
      .map(d => Number(d))
      .filter(n => Number.isFinite(n) && n > 0 && n !== id)
  ));
  task.dependencies = cleaned;
  return task;
}

// simple HTML escape to avoid injection when rendering user-provided text
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Add Task
function addTaskFromForm() {
  const titleEl = qs('title');
  const dueEl = qs('due_date');
  const estEl = qs('estimated_hours');
  const impEl = qs('importance');
  const depsEl = qs('dependencies');

  const title = titleEl?.value.trim() ?? '';
  const due_date = dueEl?.value ?? '';
  const estimated_hours = parseFloat(estEl?.value ?? '');
  const importance = parseInt(impEl?.value ?? '', 10);
  const dependencies = parseDependencies(depsEl?.value ?? '');

  if (!title) return showToast('Title is required', 'error');
  if (!due_date) return showToast('Due date is required', 'error');
  if (isNaN(estimated_hours) || estimated_hours < 0) return showToast('Estimated hours must be non-negative', 'error');
  if (isNaN(importance) || importance < 1 || importance > 10) return showToast('Importance must be between 1 and 10', 'error');

  const id = tasks.length + 1;

  // Prevent self-dependency
  if (dependencies.includes(id)) {
    return showToast('A task cannot depend on itself. Remove its ID from Dependencies.', 'error');
  }

  tasks.push({ id, title, due_date, estimated_hours, importance, dependencies });

  renderResults(tasks);
  resetForm();
  showToast('Task Added', 'success');
}

// Bulk JSON Parsing
function parseBulkJSON() {
  const el = qs('bulkJSON');
  if (!el) return [];
  const raw = (el.value ?? '').trim();
  if (!raw) return [];

  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) throw new Error('JSON must be an array');

    return arr.map((t, i) => ({
      id: t.id || (tasks.length + 1 + i),
      title: t.title || `Untitled Task ${i + 1}`,
      due_date: t.due_date,
      estimated_hours: Number(t.estimated_hours) || 0,
      importance: Number(t.importance) || 1,
      dependencies: Array.isArray(t.dependencies) ? t.dependencies.map(Number) : []
    }));
  } catch (e) {
    showToast('Invalid JSON: ' + (e.message || e), 'error');
    return [];
  }
}

// UI Rendering Helpers
function getPriorityLabel(score) {
  if (score >= 8) return ['High', 'priority-high'];
  if (score >= 5) return ['Medium', 'priority-med'];
  return ['Low', 'priority-low'];
}

function daysUntil(dateStr) {
  const today = new Date();
  // parse reliably by treating as local date start
  const due = dateStr ? new Date(dateStr + 'T00:00:00') : new Date(NaN);
  const utcToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.ceil((due - utcToday) / (1000 * 60 * 60 * 24));
}

function reasonForTask(t) {
  const days = daysUntil(t.due_date);
  const reasons = [];

  if (days < 0) reasons.push('Overdue');
  else if (days === 0) reasons.push('Due today');
  else if (days <= 3) reasons.push(`Due in ${days} days`);

  if (t.importance >= 8) reasons.push('High importance');
  if (t.estimated_hours <= 2) reasons.push('Quick win (low effort)');
  if (t.dependencies?.length) reasons.push(`Blocks ${t.dependencies.length} task(s)`);

  return reasons.join(' · ') || 'Balanced factors';
}

// Render Results (uses DocumentFragment for performance, avoids raw innerHTML)
function renderResults(list) {
  const container = qs('results');
  if (!container) return;
  container.innerHTML = '';

  if (!Array.isArray(list) || list.length === 0) {
    container.innerHTML = '<div class="muted">No tasks yet. Add a task first.</div>';
    return;
  }

  const frag = document.createDocumentFragment();

  list.forEach((t) => {
    const score = t.score ?? 0;
    const [label, cls] = getPriorityLabel(score);

    const wrapper = document.createElement('div');
    wrapper.className = 'task';

    const badgeWrap = document.createElement('div');
    const badge = document.createElement('div');
    badge.className = `badge ${cls}`;
    badge.textContent = label;
    badgeWrap.appendChild(badge);

    const details = document.createElement('div');
    details.className = 'task-details';

    const headingRow = document.createElement('div');
    headingRow.className = 'row';
    headingRow.style.justifyContent = 'space-between';
    const strong = document.createElement('strong');
    strong.textContent = t.title ?? '';
    const smallScore = document.createElement('span');
    smallScore.className = 'small';
    smallScore.textContent = `Score: ${score}`;
    headingRow.appendChild(strong);
    headingRow.appendChild(smallScore);

    const meta = document.createElement('div');
    meta.className = 'small';
    meta.textContent = `Due: ${t.due_date ?? ''} · Est: ${String(t.estimated_hours ?? '')}h · Importance: ${String(t.importance ?? '')}`;

    const explain = document.createElement('div');
    explain.className = 'explain';
    explain.textContent = reasonForTask(t);

    details.appendChild(headingRow);
    details.appendChild(meta);
    details.appendChild(explain);

    wrapper.appendChild(badgeWrap);
    wrapper.appendChild(details);

    frag.appendChild(wrapper);
  });

  container.appendChild(frag);
}

// Sorting Modes
function applyModeSort(list, mode) {
  const copy = [...list];

  if (mode === 'fast') copy.sort((a, b) => a.estimated_hours - b.estimated_hours);
  else if (mode === 'impact') copy.sort((a, b) => b.importance - a.importance);
  else if (mode === 'deadline') copy.sort((a, b) => new Date(a.due_date) - new Date(b.due_date));
  else copy.sort((a, b) => (b.score || 0) - (a.score || 0));

  return copy;
}

// Backend API: Analyze Tasks
async function analyzeTasks() {
  const bulk = parseBulkJSON();
  const rawPayload = [...tasks, ...bulk].map((t) => ({
    id: t.id,
    title: t.title,
    due_date: t.due_date,
    estimated_hours: t.estimated_hours,
    importance: t.importance,
    dependencies: t.dependencies || []
  }));

  // sanitize dependencies for each task
  const payload = rawPayload.map(sanitizeDepsForTask);

  if (!payload.length) return showToast('No tasks to analyze', 'error');

  showLoading(true);

  console.log('ANALYZE PAYLOAD', JSON.stringify(payload, null, 2));

  try {
    const resp = await fetch(`${API_BASE}/api/tasks/analyze/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    // Always read text so we can inspect error payloads too
    const text = await resp.text();

    if (!resp.ok) {
      // Try to parse JSON error body (may contain cycles)
      try {
        const json = JSON.parse(text);
        if (json.cycles) {
          // Save cycles globally so graph can highlight them
          setAnalyzedData(window.tasksAnalyzed || [], json.cycles || []);
          const cycles = json.cycles.map(c => `[${c.join(' → ')}]`).join(', ');
          throw new Error('Circular dependencies detected: ' + cycles);
        }
        throw new Error(json.error || text || `Server returned ${resp.status}`);
      } catch (parseErr) {
        throw new Error(text || `Server returned ${resp.status}`);
      }
    }

    // Success path: parse JSON from text
    let data;
    try {
      data = text ? JSON.parse(text) : [];
    } catch (e) {
      throw new Error('Failed to parse server response as JSON');
    }

    // ensure ids
    data.forEach((d, i) => (d.id = d.id || i + 1));

    // store globally (so graph + other UI can use it) and trigger graph render
    setAnalyzedData(data, data.cycles || data.meta?.cycles || []);

    // render results with selected mode
    const mode = qs('modeSelect') ? qs('modeSelect').value : 'smart';
    renderResults(applyModeSort(data, mode));
  } catch (e) {
    if (e.message && e.message.toLowerCase().includes('failed to fetch')) {
      showToast('Network error: failed to reach the API. Ensure the Django backend is running and CORS is configured.', 'error');
    } else {
      showToast('Analyze failed: ' + (e.message || e), 'error');
    }
  } finally {
    showLoading(false);
  }
}

// Show Top 3
function showTop3() {
  const out = qs('top3');
  if (!out) return;
  out.innerHTML = '';

  const source = getAnalyzedSource();
  if (!source.length) return (out.innerHTML = '<div class="muted">No analyzed tasks available.</div>');

  const top = [...source].sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 3);

  const frag = document.createDocumentFragment();
  top.forEach((t, idx) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'task';

    const badgeWrap = document.createElement('div');
    const badge = document.createElement('div');
    badge.className = 'badge priority-high';
    badge.textContent = `#${idx + 1}`;
    badgeWrap.appendChild(badge);

    const details = document.createElement('div');
    details.className = 'task-details';

    const headingRow = document.createElement('div');
    headingRow.className = 'row';
    headingRow.style.justifyContent = 'space-between';
    const strong = document.createElement('strong');
    strong.textContent = t.title ?? '';
    const smallScore = document.createElement('span');
    smallScore.className = 'small';
    smallScore.textContent = `Score: ${t.score ?? 0}`;
    headingRow.appendChild(strong);
    headingRow.appendChild(smallScore);

    const meta = document.createElement('div');
    meta.className = 'small';
    meta.textContent = `Due: ${t.due_date ?? ''} · Est: ${String(t.estimated_hours ?? '')}h`;

    const explain = document.createElement('div');
    explain.className = 'explain';
    explain.textContent = reasonForTask(t);

    details.appendChild(headingRow);
    details.appendChild(meta);
    details.appendChild(explain);

    wrapper.appendChild(badgeWrap);
    wrapper.appendChild(details);

    frag.appendChild(wrapper);
  });

  out.appendChild(frag);
}

// Export JSON
function exportJSON() {
  const data = window.tasksAnalyzed || tasks;
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'analyzed_tasks.json';
  a.click();
  URL.revokeObjectURL(url);
}

// Toast: accessible & capped
function showToast(message, type = 'info') {
  const box = document.getElementById('toastcontainer');
  if (!box) return console.warn('No toast container found');

  // Unhide the container & ARIA
  box.hidden = false;
  box.setAttribute('role', 'status');
  box.setAttribute('aria-live', 'polite');
  box.style.position = 'fixed';
  box.style.top = '20px';
  box.style.right = '20px';
  box.style.zIndex = '9999';
  box.style.display = 'flex';
  box.style.flexDirection = 'column';
  box.style.gap = '10px';

  // limit to 3 toasts
  while (box.children.length > 2) box.removeChild(box.firstChild);

  const toast = document.createElement('div');
  toast.textContent = message;
  toast.style.padding = '12px 16px';
  toast.style.borderRadius = '8px';
  toast.style.fontSize = '14px';
  toast.style.color = 'white';
  toast.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
  toast.style.opacity = '0';
  toast.style.transform = 'translateY(-10px)';
  toast.style.transition = 'opacity .35s ease, transform .35s ease';

  if (type === 'error') toast.style.background = '#e11d48';
  else if (type === 'success') toast.style.background = '#059669';
  else toast.style.background = '#0284c7';

  box.appendChild(toast);

  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';
  });

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-10px)';
    setTimeout(() => toast.remove(), 350);
  }, 2600);
}

// Event Listeners
if (qs('addTaskBtn')) qs('addTaskBtn').addEventListener('click', addTaskFromForm);
if (qs('clearForm')) qs('clearForm').addEventListener('click', resetForm);
if (qs('analyzeBtn')) qs('analyzeBtn').addEventListener('click', analyzeTasks);
if (qs('analyzeBtnBottom')) qs('analyzeBtnBottom').addEventListener('click', analyzeTasks);
if (qs('top3Btn')) qs('top3Btn').addEventListener('click', showTop3);
if (qs('exportJSON')) qs('exportJSON').addEventListener('click', exportJSON);
if (qs('modeSelect')) qs('modeSelect').addEventListener('change', () => {
  const mode = qs('modeSelect').value;
  const src = getAnalyzedSource();
  renderResults(applyModeSort(src, mode));
});

// Initial render
renderResults(tasks);

// Dependency Graph Visualization (Bonus task)
// Reworked: uses setAnalyzedData() to update (no polling)
(function () {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initGraphModule);
  } else {
    initGraphModule();
  }

  function initGraphModule() {
    if (typeof vis === 'undefined') {
      console.warn('vis-network not found. Please add the CDN to <head>.');
      return;
    }

    const container = document.getElementById('graphContainer');
    if (!container) {
      console.warn('#graphContainer not found — dependency graph will not render.');
      return;
    }
    if (!container.style.height || container.style.height === '') container.style.height = '320px';
    container.style.minHeight = '220px';

    let net = null;

    function buildData(inputTasks) {
      const tasksArr = Array.isArray(inputTasks) ? inputTasks : [];
      const nodes = [];
      const edges = [];
      const seen = new Set();

      const lookup = new Map();
      tasksArr.forEach(t => {
        const tid = Number(t.id);
        if (Number.isFinite(tid)) lookup.set(tid, t);
      });

      function addNodeIfMissing(id) {
        if (seen.has(id)) return;
        seen.add(id);

        const found = lookup.get(id);
        if (found) {
          nodes.push({
            id,
            label: (found.title || `Task ${id}`).slice(0, 40),
            title: `<div style="padding:6px"><strong>${escapeHtml(found.title || `Task ${id}`)}</strong><br/>Due: ${escapeHtml(found.due_date || '')}<br/>Est: ${escapeHtml(String(found.estimated_hours || 0))}h</div>`,
            shape: 'box',
            color: { background: '#fff', border: '#cfeef0' }
          });
        } else {
          nodes.push({
            id,
            label: `Missing Task #${id}`,
            title: `<div style="padding:6px"><strong>Missing Task #${id}</strong><br/>Referenced as a dependency but not provided in input.</div>`,
            shape: 'box',
            color: { background: '#fff7ed', border: '#f97316' }
          });
        }
      }

      tasksArr.forEach(t => {
        const id = Number(t.id);
        if (!Number.isFinite(id)) return;
        addNodeIfMissing(id);
      });

      tasksArr.forEach(t => {
        const id = Number(t.id);
        if (!Number.isFinite(id)) return;
        (t.dependencies || []).forEach(dep => {
          const di = Number(dep);
          if (!Number.isFinite(di)) return;
          addNodeIfMissing(di);
          addNodeIfMissing(id);
          edges.push({ from: di, to: id, arrows: 'to', color: { color: '#cbd5e1' }, smooth: { enabled: true, type: 'cubicBezier' } });
        });
      });

      return { nodes, edges };
    }

    function safeRender(tasksList, cycles = []) {
      try {
        const { nodes, edges } = buildData(tasksList);
        if (!nodes.length) {
          container.innerHTML = '<div style="padding:18px;color:#64748b">No nodes to render</div>';
          return;
        }
        const visNodes = new vis.DataSet(nodes);
        const visEdges = new vis.DataSet(edges.map((e, i) => ({ id: i + 1, ...e })));
        const data = { nodes: visNodes, edges: visEdges };
        const options = {
          autoResize: true,
          layout: { improvedLayout: true },
          interaction: { hover: true, navigationButtons: true, keyboard: true, tooltipDelay: 100 },
          physics: {
            enabled: true,
            stabilization: { enabled: true, iterations: 500, updateInterval: 50 },
            barnesHut: { gravitationalConstant: -8000, springConstant: 0.001, springLength: 200 }
          },
          nodes: { margin: 10, font: { multi: 'html' } },
          edges: { arrows: { to: { enabled: true, scaleFactor: 0.6 } } }
        };

        if (net) {
          try { net.destroy(); } catch (_) { /* ignore */ }
          net = null;
        }
        net = new vis.Network(container, data, options);

        net.once('stabilizationIterationsDone', function () {
          try {
            net.setOptions({ physics: { enabled: false } });
            net.fit({ animation: { duration: 300 } });
          } catch (e) { /* ignore */ }
        });

        net.on('click', params => {
          if (!params.nodes || !params.nodes.length) return;
          const id = params.nodes[0];
          const node = visNodes.get(id);
          const message = node ? (node.title ? node.title.replace(/<[^>]+>/g, '') : node.label) : `Task ${id}`;
          if (typeof showToast === 'function') showToast(message, 'info'); else console.log(message);
        });

        highlightCyclesSafe(visNodes, visEdges, cycles);
      } catch (err) {
        console.error('Graph render error:', err);
        if (typeof showToast === 'function') showToast('Dependency graph failed to render (see console).', 'error');
      }
    }

    function highlightCyclesSafe(visNodes, visEdges, cycles) {
      visNodes.get().forEach(n => visNodes.update({ id: n.id, color: { background: '#fff', border: '#cfeef0' }, font: { color: '#062a2a', bold: false } }));
      visEdges.get().forEach(e => visEdges.update({ id: e.id, color: { color: '#cbd5e1' }, width: 1 }));
      if (!Array.isArray(cycles) || !cycles.length) return;
      cycles.forEach(cycle => {
        const uniq = Array.from(new Set(cycle));
        uniq.forEach(id => {
          if (Number.isFinite(Number(id))) visNodes.update({ id: Number(id), color: { background: '#fee2e2', border: '#ef4444' }, font: { color: '#7f1d1d', bold: true } });
        });
        for (let i = 0; i < cycle.length - 1; i++) {
          const from = Number(cycle[i]), to = Number(cycle[i + 1]);
          visEdges.get().forEach(e => {
            if (e.from === from && e.to === to) visEdges.update({ id: e.id, color: { color: '#ef4444' }, width: 2 });
          });
        }
      });
    }

    // public API
    window.renderDependencyGraphFromUI = function () {
      const src = getAnalyzedSource();
      const cycles = Array.isArray(window.lastAnalyzeCycles) ? window.lastAnalyzeCycles : [];
      safeRender(src, cycles);
    };

    window.__setAnalyzeCyclesAndDraw = function (cyclesArr) {
      if (!Array.isArray(cyclesArr)) return;
      window.lastAnalyzeCycles = cyclesArr;
      window.renderDependencyGraphFromUI();
    };

    // debug helper
    window.__graphRenderTest = function () {
      const sample = [
        { id: 1, title: 'A', due_date: '2025-12-01', estimated_hours: 2, importance: 8, dependencies: [2] },
        { id: 2, title: 'B', due_date: '2025-12-03', estimated_hours: 5, importance: 6, dependencies: [3] },
        { id: 3, title: 'C', due_date: '2025-12-05', estimated_hours: 1, importance: 5, dependencies: [] }
      ];
      const cycles = [[1, 2, 3, 1]];
      safeRender(sample, cycles);
      console.log('Graph test rendered (sample).');
    };

    // initial draw
    try { window.renderDependencyGraphFromUI(); } catch (e) { /* ignore */ }
  } // end initGraphModule
})(); // IIFE end
