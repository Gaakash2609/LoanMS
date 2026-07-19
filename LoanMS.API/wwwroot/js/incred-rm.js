    // Add RM Emails sub-tab to InCred page on DOMContentLoaded
    document.addEventListener('DOMContentLoaded', function () {
      const incredPage = document.getElementById('page-incred');
      if (!incredPage) return;

      // Find existing tabs element in InCred page or create one
      let tabsEl = incredPage.querySelector('.tabs');
      if (!tabsEl) {
        tabsEl = document.createElement('div');
        tabsEl.className = 'tabs';
        tabsEl.style.marginBottom = '20px';
        incredPage.insertBefore(tabsEl, incredPage.children[1]);
      }

      // Inject RM Emails tab
      if (!tabsEl.querySelector('[data-incred-tab="rm"]')) {
        tabsEl.insertAdjacentHTML('beforeend',
          `<div class="tab" onclick="switchIncredTab('rm',this)" data-incred-tab="rm">👤 RM Emails</div>`);
      }

      // Inject RM panel into InCred page
      if (!document.getElementById('incred-rm-panel')) {
        const rmPanel = document.createElement('div');
        rmPanel.id = 'incred-rm-panel';
        rmPanel.style.display = 'none';
        rmPanel.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">
        <div><div style="font-family:var(--font-head);font-size:20px;font-weight:800">InCred Relationship Managers</div>
        <div style="font-size:13px;color:var(--text3)">Manage RM email records used for InCred API applications</div></div>
        <span class="badge badge-login" id="rm-count" style="margin-left:auto">0</span>
        <button class="btn btn-primary" onclick="openRmModal(null)">＋ Add RM</button>
      </div>
      <div class="card"><div class="table-wrap"><table>
        <thead><tr><th>RM Name</th><th>Location</th><th>Email ID</th><th>Contact No</th><th>Actions</th></tr></thead>
        <tbody id="rm-emails-list"></tbody>
      </table></div></div>`;
        incredPage.appendChild(rmPanel);
        renderRmEmails();
      }
    });

    function switchIncredTab(tab, el) {
      // Toggle RM panel
      const rmPanel = document.getElementById('incred-rm-panel');
      if (!rmPanel) return;
      if (tab === 'rm') {
        rmPanel.style.display = 'block';
        renderRmEmails();
      } else {
        rmPanel.style.display = 'none';
      }
      if (el) {
        const tabsEl = el.closest('.tabs');
        if (tabsEl) tabsEl.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        el.classList.add('active');
      }
    }

    // ── Expose functions to window for onclick handlers ──
    window.switchIncredTab = switchIncredTab;