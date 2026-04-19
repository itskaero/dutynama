/**
 * admin.js — PGR management, unit config, shift settings, replacement log
 *
 * Senior PGR: full admin (invite PGRs, manage units/shifts, replacement log)
 * Senior Resident: focused view (add leaves directly, view replacement log)
 */

const Admin = (() => {

  function render() {
    const role = Auth.currentUser()?.role;
    if (!['senior_pgr', 'senior_resident'].includes(role)) {
      document.getElementById('page-admin').innerHTML =
        '<div class="page-inner"><p class="muted">Access denied.</p></div>';
      return;
    }
    if (role === 'senior_resident') {
      renderSRPanel();
    } else {
      renderPGRList();
      renderPendingInvites();
      renderUnitList();
      renderShiftSettings();
      renderReplacementLog();
      switchTab('team');
    }
  }

  function switchTab(name) {
    document.querySelectorAll('.admin-tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === name);
    });
    document.querySelectorAll('.admin-tab-panel').forEach(panel => {
      panel.classList.toggle('active', panel.id === 'admin-tab-' + name);
    });
  }

  // ── PGR List (Senior PGR only) ────────────────────────
  function renderPGRList() {
    const me   = Auth.currentUser();
    const pgrs = DB.getPGRs();
    let html = `
      <div class="section-heading">Team Members</div>
      <div class="admin-card">
        <table class="data-table">
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Year</th><th>Min Duties</th><th>Actions</th></tr></thead>
          <tbody>`;
    pgrs.forEach(pgr => {
      const isSelf        = pgr.id === me?.id;
      const canTransfer   = !isSelf && pgr.role !== 'senior_pgr';
      html += `<tr>
        <td>${pgr.name}${isSelf ? ' <span class="muted">(you)</span>' : ''}</td>
        <td>${pgr.email}</td>
        <td><span class="role-badge role-${pgr.role}">${pgr.role.replace(/_/g,' ')}</span></td>
        <td>${pgr.year ? 'Y' + pgr.year : '—'}</td>
        <td>${DB.getEffectiveMinDuties(pgr)}</td>
        <td>
          <button class="btn btn-xs btn-secondary" onclick="Admin.openEditPGR('${pgr.id}')">Edit</button>
          ${canTransfer ? `<button class="btn btn-xs btn-warn" onclick="Admin.transferAdmin('${pgr.id}')">Make Admin</button>` : ''}
          ${!isSelf ? `<button class="btn btn-xs btn-danger" onclick="Admin.deletePGR('${pgr.id}')">Remove</button>` : ''}
        </td>
      </tr>`;
    });
    html += `</tbody></table></div>`;
    document.getElementById('pgr-list-table').innerHTML = html;
  }

  // ── Transfer admin to another PGR ────────────────────
  async function transferAdmin(targetId) {
    const target = DB.getPGR(targetId);
    if (!target) return;
    const me = Auth.currentUser();
    if (!confirm(`Make ${target.name} the new Senior PGR?\n\nYour role will be changed to PGR. You will no longer have admin access.`)) return;

    // Promote target
    await DB.upsertPGR({ ...target, role: 'senior_pgr' });
    // Demote self
    if (me) await DB.upsertPGR({ ...DB.getPGR(me.id), role: 'pgr' });

    alert(`${target.name} is now Senior PGR. You have been demoted to PGR.\nPlease log out and back in for changes to take effect.`);
    renderPGRList();
  }

  // ── Pending Invites ───────────────────────────────────
  async function renderPendingInvites() {
    const pending = await DB.getPendingUsers();
    let html = `
      <div class="section-heading">Invite New PGR</div>
      <div class="admin-card">
        <div class="invite-form">
          <input type="text"  id="inv-name"  placeholder="Full name"   />
          <input type="email" id="inv-email" placeholder="Email address" />
          <select id="inv-role" onchange="Admin._onInviteRoleChange()">
            <option value="pgr">PGR</option>
            <option value="senior_pgr">Senior PGR</option>
            <option value="senior_resident">Senior Resident</option>
            <option value="viewer">Viewer</option>
          </select>
          <select id="inv-year" title="PGR year of training">
            <option value="">Year —</option>
            ${DB.getYears().map(y => `<option value="${y}">Year ${y}</option>`).join('')}
          </select>
          <input type="number" id="inv-duties" placeholder="Min duties" min="0" max="31" style="width:100px" />
          <button class="btn btn-primary btn-sm" onclick="Admin.sendInvite()">Send Invite</button>
        </div>`;

    if (pending.length) {
      html += `<div class="section-subheading">Pending Invites</div>
        <table class="data-table">
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Actions</th></tr></thead>
          <tbody>`;
      pending.forEach(p => {
        html += `<tr>
          <td>${p.name}</td>
          <td>${p.email}</td>
          <td><span class="role-badge role-${p.role}">${p.role.replace(/_/g,' ')}</span></td>
          <td><button class="btn btn-xs btn-danger" onclick="Admin.revokeInvite('${p._docId}')">Revoke</button></td>
        </tr>`;
      });
      html += `</tbody></table>`;
    } else {
      html += `<p class="muted" style="margin-top:.5rem">No pending invites.</p>`;
    }
    html += `</div>`;
    document.getElementById('pending-invites-section').innerHTML = html;
  }

  // Auto-fill min duties when year changes on invite form
  function _onInviteRoleChange() {
    const year = parseInt(document.getElementById('inv-year')?.value) || 0;
    if (!year) return;
    const yd  = DB.getConfig().yearMinDuties || {};
    const inp = document.getElementById('inv-duties');
    if (inp && !inp.value) inp.value = yd[year] ?? DB.getConfig().minDutiesPerMonth;
  }

  async function sendInvite() {
    const name     = document.getElementById('inv-name').value.trim();
    const username = document.getElementById('inv-username').value.trim().toLowerCase();
    const role     = document.getElementById('inv-role').value;
    const year     = parseInt(document.getElementById('inv-year').value) || null;
    const cfg      = DB.getConfig();
    const yd       = cfg.yearMinDuties || {};
    const defaultMin = year ? (yd[year] ?? cfg.minDutiesPerMonth) : cfg.minDutiesPerMonth;
    const minDuties  = parseInt(document.getElementById('inv-duties').value) || defaultMin;

    if (!name || !username) { alert('Name and username are required.'); return; }
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(username) || username.length < 2 || username.length > 20) {
      alert('Username: 2–20 chars, only letters/digits/dots/hyphens, must start with a letter or digit.');
      return;
    }

    // Check if username already taken
    if (DB.getPGRs().find(p => (p.username || '').toLowerCase() === username)) {
      alert('A user with this username already exists.'); return;
    }

    const setupCode = _genSetupCode();
    const btn = document.querySelector('#pending-invites-section .btn-primary');
    if (btn) { btn.disabled = true; btn.textContent = 'Creating…'; }

    try {
      await DB.addPendingUser({
        name, username, role, year, minDuties,
        createdBy: Auth.currentUser()?.uid || '',
        setupCode,
      });
      document.getElementById('inv-name').value     = '';
      document.getElementById('inv-username').value = '';

      alert(
        `✅ Invite created!\n\n` +
        `Tell ${name} to click “Claim Invite” on the login screen and enter:\n` +
        `  Username:    ${username}\n` +
        `  Setup Code:  ${setupCode}\n\n` +
        `They will then choose their own PIN.`
      );
      await renderPendingInvites();
    } catch (e) {
      alert('Error: ' + e.message);
      if (btn) { btn.disabled = false; btn.textContent = 'Create Invite'; }
    }
  }

  async function revokeInvite(docId) {
    if (!confirm('Revoke this invite?')) return;
    await DB.deletePendingUser(docId);
    await renderPendingInvites();
  }

  // ── Edit existing PGR ────────────────────────────────
  function openEditPGR(id) {
    const pgr = DB.getPGR(id);
    if (!pgr) return;
    document.getElementById('pgr-modal-title').textContent       = 'Edit Team Member';
    document.getElementById('pgr-name-input').value  = pgr.name;
    document.getElementById('pgr-email-input').value = pgr.email || '';
    document.getElementById('pgr-role-input').value              = pgr.role;
    document.getElementById('pgr-min-duties-input').value        = pgr.minDuties ?? DB.getEffectiveMinDuties(pgr);
    document.getElementById('pgr-edit-id').value                 = pgr.id;
    // Rebuild year options in case numYears changed since modal was last opened
    const yearSel = document.getElementById('pgr-year-input');
    yearSel.innerHTML = '<option value="">Not set</option>' +
      DB.getYears().map(y => `<option value="${y}">Year ${y}</option>`).join('');
    yearSel.value = pgr.year || '';
    document.getElementById('pgr-modal').classList.remove('hidden');
    document.getElementById('overlay').classList.remove('hidden');
  }

  function closePGRModal() {
    document.getElementById('pgr-modal').classList.add('hidden');
    document.getElementById('overlay').classList.add('hidden');
  }

  async function savePGR() {
    const name      = document.getElementById('pgr-name-input').value.trim();
    const role      = document.getElementById('pgr-role-input').value;
    const year      = parseInt(document.getElementById('pgr-year-input').value) || null;
    const minDuties = parseInt(document.getElementById('pgr-min-duties-input').value) ?? null;
    const editId    = document.getElementById('pgr-edit-id').value;

    if (!name) { alert('Name required.'); return; }
    if (!editId) { alert('No user selected for editing.'); return; }

    const pgr = { ...DB.getPGR(editId), name, role, year, minDuties };
    await DB.upsertPGR(pgr);
    closePGRModal();
    renderPGRList();
  }

  async function deletePGR(id) {
    const pgr = DB.getPGR(id);
    if (!pgr) return;
    if (!confirm(`Remove ${pgr.name}? This will NOT delete their roster entries.`)) return;
    await DB.deletePGR(id);
    renderPGRList();
  }

  // ── Unit List ─────────────────────────────────────────
  function renderUnitList() {
    const units = DB.getUnits();
    let html = '';
    units.forEach(u => {
      html += `<div class="unit-row">
        <span>${u.name}</span>
        <button class="btn btn-xs btn-danger" onclick="Admin.deleteUnit('${u.id}')">Remove</button>
      </div>`;
    });
    document.getElementById('unit-list').innerHTML = html || '<p class="muted">No units.</p>';
  }

  async function addUnit() {
    const name = document.getElementById('new-unit-name').value.trim();
    if (!name) return;
    const cfg = DB.getConfig();
    if (cfg.units.find(u => u.name.toLowerCase() === name.toLowerCase())) {
      alert('Unit already exists.'); return;
    }
    cfg.units.push({ id: name.replace(/\s+/g,'_'), name });
    await DB.saveConfig(cfg);
    document.getElementById('new-unit-name').value = '';
    renderUnitList();
  }

  async function deleteUnit(id) {
    if (!confirm('Remove unit?')) return;
    const cfg = DB.getConfig();
    cfg.units  = cfg.units.filter(u => u.id !== id);
    await DB.saveConfig(cfg);
    renderUnitList();
  }

  // ── Shift settings ────────────────────────────────────
  function renderShiftSettings() {
    const cfg   = DB.getConfig();
    const years = DB.getYears();
    document.getElementById('shift-mode-select').value = cfg.shiftMode;
    document.getElementById('max-bays-input').value    = cfg.maxBaysPerPGR;
    document.getElementById('min-duties-input').value  = cfg.minDutiesPerMonth;
    document.getElementById('num-years-input').value   = cfg.numYears || 4;
    // Build per-year duty inputs dynamically
    const yd  = cfg.yearMinDuties || {};
    const box = document.getElementById('year-duties-container');
    if (box) {
      box.innerHTML = years.map(y =>
        `<label style="margin:0">Y${y}</label>` +
        `<input type="number" id="year-duties-${y}" min="0" max="31" value="${yd[y] ?? cfg.minDutiesPerMonth}" ` +
        `style="width:64px" onchange="Admin.saveYearDuties()" />`
      ).join('');
    }
  }

  async function saveNumYears() {
    const n = parseInt(document.getElementById('num-years-input').value);
    if (!n || n < 1 || n > 10) return;
    const cfg = DB.getConfig();
    cfg.numYears = n;
    // Seed any new years with the global default
    cfg.yearMinDuties = cfg.yearMinDuties || {};
    for (let y = 1; y <= n; y++) {
      if (cfg.yearMinDuties[y] == null) cfg.yearMinDuties[y] = cfg.minDutiesPerMonth;
    }
    await DB.saveConfig(cfg);
    renderShiftSettings();   // rebuild the per-year inputs
  }

  async function saveYearDuties() {
    const cfg   = DB.getConfig();
    const years = DB.getYears();
    cfg.yearMinDuties = cfg.yearMinDuties || {};
    years.forEach(y => {
      const el = document.getElementById(`year-duties-${y}`);
      if (el) cfg.yearMinDuties[y] = parseInt(el.value) || cfg.minDutiesPerMonth;
    });
    await DB.saveConfig(cfg);
  }

  async function saveShiftMode() {
    const cfg = DB.getConfig();
    cfg.shiftMode = parseInt(document.getElementById('shift-mode-select').value);
    await DB.saveConfig(cfg);
  }

  async function saveMaxBays() {
    const cfg = DB.getConfig();
    cfg.maxBaysPerPGR = parseInt(document.getElementById('max-bays-input').value);
    await DB.saveConfig(cfg);
  }

  async function saveMinDuties() {
    const cfg = DB.getConfig();
    cfg.minDutiesPerMonth = parseInt(document.getElementById('min-duties-input').value);
    await DB.saveConfig(cfg);
  }

  // ── Replacement log ────────────────────────────────────
  function renderReplacementLog() {
    const roster = DB.getRoster().filter(r => r.replaced);
    const pgrs   = DB.getPGRs();

    if (!roster.length) {
      document.getElementById('replacement-log').innerHTML = '<p class="muted">No replacements recorded.</p>';
      return;
    }

    let html = `<table class="data-table">
      <thead><tr><th>Date</th><th>Shift</th><th>Unit</th><th>Original</th><th>Replaced By</th><th>Note</th></tr></thead>
      <tbody>`;
    roster.slice().sort((a, b) => b.date.localeCompare(a.date)).forEach(r => {
      const orig  = pgrs.find(p => p.id === r.pgrId);
      const repBy = pgrs.find(p => p.id === r.replacedBy);
      html += `<tr>
        <td>${r.date}</td>
        <td>${r.shift}</td>
        <td>${r.unitId}</td>
        <td>${orig?.name  || r.pgrId}</td>
        <td>${repBy?.name || r.replacedBy || '—'}</td>
        <td>${r.replacedNote || '—'}</td>
      </tr>`;
    });
    html += `</tbody></table>`;
    document.getElementById('replacement-log').innerHTML = html;
  }

  // ── Senior Resident Panel ─────────────────────────────
  function renderSRPanel() {
    const pgrs = DB.getPGRs();
    const pgrOpts = pgrs.map(p => `<option value="${p.id}">${p.name}</option>`).join('');

    const el = document.getElementById('page-admin');
    el.innerHTML = `
    <div class="page-inner">
      <h2>Admin Panel</h2>

      <div class="section-heading">Add Leave for PGR</div>
      <div class="admin-card">
        <div class="invite-form">
          <select id="sr-leave-pgr"><option value="">— select PGR —</option>${pgrOpts}</select>
          <input type="date" id="sr-leave-date" />
          <input type="text" id="sr-leave-note" placeholder="Reason (optional)" />
          <select id="sr-leave-status">
            <option value="approved">Approved</option>
            <option value="pending">Pending</option>
          </select>
          <button class="btn btn-primary btn-sm" onclick="Admin.addAdminLeave()">Add Leave</button>
        </div>
      </div>

      <div class="section-heading">Replacement Log</div>
      <div id="sr-replacement-log" class="admin-card"></div>
    </div>`;

    // Render replacement log into sr panel
    const roster = DB.getRoster().filter(r => r.replaced);
    const pgrMap = {};
    pgrs.forEach(p => { pgrMap[p.id] = p.name; });

    if (!roster.length) {
      document.getElementById('sr-replacement-log').innerHTML =
        '<p class="muted">No replacements recorded.</p>';
      return;
    }

    let html = `<table class="data-table">
      <thead><tr><th>Date</th><th>Shift</th><th>Unit</th><th>Original</th><th>Replaced By</th><th>Note</th></tr></thead>
      <tbody>`;
    roster.slice().sort((a,b) => b.date.localeCompare(a.date)).forEach(r => {
      html += `<tr>
        <td>${r.date}</td><td>${r.shift}</td><td>${r.unitId}</td>
        <td>${pgrMap[r.pgrId]  || r.pgrId}</td>
        <td>${pgrMap[r.replacedBy] || r.replacedBy || '—'}</td>
        <td>${r.replacedNote || '—'}</td>
      </tr>`;
    });
    html += `</tbody></table>`;
    document.getElementById('sr-replacement-log').innerHTML = html;
  }

  async function addAdminLeave() {
    const pgrId  = document.getElementById('sr-leave-pgr').value;
    const date   = document.getElementById('sr-leave-date').value;
    const note   = document.getElementById('sr-leave-note').value.trim();
    const status = document.getElementById('sr-leave-status').value;

    if (!pgrId || !date) { alert('Select PGR and date.'); return; }

    const result = await DB.addLeave(pgrId, date, note, status);
    if (!result) { alert('Leave already exists for this PGR on that date.'); return; }

    document.getElementById('sr-leave-pgr').value  = '';
    document.getElementById('sr-leave-date').value = '';
    document.getElementById('sr-leave-note').value = '';
    alert('Leave added.');
  }

  return {
    render,
    renderPGRList, renderPendingInvites, sendInvite, revokeInvite,
    _onInviteRoleChange,
    openEditPGR, closePGRModal, savePGR, deletePGR, transferAdmin,
    renderUnitList, addUnit, deleteUnit,
    saveShiftMode, saveMaxBays, saveMinDuties, saveNumYears, saveYearDuties,
    renderReplacementLog, addAdminLeave,
  };
})();
