  // ═══════════════════════════════════════════════════════
  //  GLOBAL TASKS PAGE
  // ═══════════════════════════════════════════════════════

  // Seed tasks derived from existing applications
  var _TASKS_PAGE_DATA = [
  ];

  let gtFilter = 'all';

  function renderGlobalTasks() {
    const body = document.getElementById('global-tasks-body');
    if (!body) return;

    const today = new Date(); today.setHours(0,0,0,0);

    let tasks = [..._TASKS_PAGE_DATA];
    if (gtFilter === 'pending')  tasks = tasks.filter(t => !t.done && new Date(t.due) >= today);
    if (gtFilter === 'overdue')  tasks = tasks.filter(t => !t.done && new Date(t.due) < today);
    if (gtFilter === 'done')     tasks = tasks.filter(t => t.done);

    if (!tasks.length) {
      body.innerHTML = `<div style="text-align:center;padding:48px 24px;color:var(--text3)">
        <div style="font-size:36px;margin-bottom:12px">✅</div>
        <div style="font-size:14px;font-weight:600">No tasks here</div>
        <div style="font-size:12px;margin-top:4px">You're all caught up!</div>
      </div>`;
      return;
    }

    body.innerHTML = tasks.map(t => {
      const dueDate = new Date(t.due);
      dueDate.setHours(0,0,0,0);
      const isOverdue = !t.done && dueDate < today;
      const dueFmt = dueDate.toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' });
      return `
      <div class="task-card ${t.done ? 'done' : ''} ${isOverdue ? 'overdue' : ''}" id="task-card-${t.id}">
        <div class="task-check ${t.done ? 'checked' : ''}" onclick="toggleGlobalTask('${t.id}')"></div>
        <div style="flex:1;min-width:0">
          <div style="font-size:13.5px;font-weight:600;color:var(--text);margin-bottom:5px;${t.done ? 'text-decoration:line-through;color:var(--text3)' : ''}">${t.title}</div>
          <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">
            <span style="font-size:11.5px;color:var(--text3);background:var(--surface2);border-radius:6px;padding:2px 8px;cursor:pointer" onclick="showPage('applications',null)">#${t.appId} — ${t.appName}</span>
            <span class="task-priority ${t.priority}">${t.priority}</span>
            <span style="font-size:11.5px;color:${isOverdue ? 'var(--accent2)' : 'var(--text3)'}">
              ${isOverdue ? '⚠ Overdue · ' : '📅 Due: '}${dueFmt}
            </span>
          </div>
        </div>
        <button onclick="deleteGlobalTask('${t.id}')" title="Remove task"
          style="background:none;border:none;cursor:pointer;color:var(--text3);font-size:16px;padding:4px;border-radius:6px;transition:color .15s;flex-shrink:0"
          onmouseover="this.style.color='var(--danger)'" onmouseout="this.style.color='var(--text3)'">✕</button>
      </div>`;
    }).join('');

    // Update nav badge — count pending + overdue
    const pendingCount = _TASKS_PAGE_DATA.filter(t => !t.done).length;
    const navBadge = document.getElementById('tasks-nav-badge');
    if (navBadge) {
      navBadge.textContent = pendingCount || '';
      navBadge.style.display = pendingCount ? '' : 'none';
    }
  }

  function filterGlobalTasks(f, btn) {
    gtFilter = f;
    document.querySelectorAll('.tasks-filter-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    renderGlobalTasks();
  }

  function toggleGlobalTask(id) {
    const t = _TASKS_PAGE_DATA.find(x => x.id === id);
    if (t) { t.done = !t.done; renderGlobalTasks(); }
  }

  function deleteGlobalTask(id) {
    const idx = _TASKS_PAGE_DATA.findIndex(x => x.id === id);
    if (idx > -1) { _TASKS_PAGE_DATA.splice(idx, 1); renderGlobalTasks(); }
  }

  // Refresh badge on page load after a brief delay
  document.addEventListener('DOMContentLoaded', function() {
    setTimeout(function() {
      updateTasksNavBadge();
    }, 800);
  });