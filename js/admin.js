/**
 * admin.js — PGR management, unit config, shift settings, replacement log
 *
 * Senior PGR: full admin (invite PGRs, manage units/shifts, replacement log)
 * Senior Resident: focused view (add leaves directly, view replacement log)
 */

const Admin = (() => {

  // State for SR-managed PGR preference tab
  let _srPrefPGR   = null;
  let _srPrefSel   = new Set();
  let _srBayOrder  = [];        // priority order — excluded bays NOT in this list
  let _srExcluded  = new Set(); // bays this PGR cannot be assigned to

  function render() {
    const role = Auth.currentUser()?.role;
    if (!['senior_pgr', 'senior_registrar'].includes(role)) {
      document.getElementById('page-admin').innerHTML =
        '<div class="page-inner"><p class="muted">Access denied.</p></div>';
      return;
    }
    if (role === 'senior_registrar') {
      renderSRPanel();
    } else {
      renderPGRList();
      renderPendingInvites();
      renderUnitList();
      try { renderShiftSettings(); } catch (e) { console.error('[Admin] renderShiftSettings failed:', e); }
      renderReplacementLog();
      renderSRPrefsTab();
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
    let pending = [];
    try {
      pending = await DB.getPendingUsers();
    } catch (e) {
      console.warn('[Admin] Could not load pending invites:', e.message);
    }
    let html = `
      <div class="section-heading">Invite New PGR</div>
      <div class="admin-card">
        <div class="invite-form">
          <input type="text"  id="inv-name"  placeholder="Full name"   />
          <input type="email" id="inv-email" placeholder="Email address" />
          <select id="inv-role" onchange="Admin._onInviteRoleChange()">
            <option value="pgr">PGR</option>
            <option value="senior_pgr">Senior PGR</option>
            <option value="senior_registrar">Senior Registrar</option>
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
    const email    = document.getElementById('inv-email').value.trim().toLowerCase();
    const role     = document.getElementById('inv-role').value;
    const year     = parseInt(document.getElementById('inv-year').value) || null;
    const cfg      = DB.getConfig();
    const yd       = cfg.yearMinDuties || {};
    const defaultMin = year ? (yd[year] ?? cfg.minDutiesPerMonth) : cfg.minDutiesPerMonth;
    const minDuties  = parseInt(document.getElementById('inv-duties').value) || defaultMin;

    if (!name || !email) { alert('Name and email are required.'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      alert('Please enter a valid email address.'); return;
    }

    // Check if email already registered
    if (DB.getPGRs().find(p => (p.email || '').toLowerCase() === email)) {
      alert('A user with this email already exists.'); return;
    }

    const btn = document.querySelector('#pending-invites-section .btn-primary');
    if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }

    try {
      await DB.addPendingUser({
        name, email, role, year, minDuties,
        createdBy: Auth.currentUser()?.uid || '',
      });
      document.getElementById('inv-name').value  = '';
      document.getElementById('inv-email').value = '';

      // Open email client with a pre-filled invite message
      const appUrl  = window.location.href.split('#')[0];
      const subject = encodeURIComponent('DutyNama — You have been added to the team');
      const body    = encodeURIComponent(
        `Hi ${name},\n\n` +
        `You have been added to the DutyNama duty roster. ` +
        `You are already visible in the team and can be assigned duties.\n\n` +
        `To log in and manage your own preferences, open the app and set up your account:\n` +
        `${appUrl}\n\n` +
        `Click "Setup Account (I was invited)" and enter:\n` +
        `  Email: ${email}\n\n` +
        `You will then choose your own PIN to complete login setup.\n` +
        `(Account setup is optional — your admin can manage preferences on your behalf.)`
      );
      const _a = document.createElement('a');
      _a.href = `mailto:${email}?subject=${subject}&body=${body}`;
      _a.click();
      alert(
        `✅ ${name} added to the team!\n\n` +
        `Your email app should have opened with a ready-to-send message.\n` +
        `If it didn't open, manually tell them:\n` +
        `  Email: ${email}\n\n` +
        `They are already in the team roster. ` +
        `Account setup is only needed if they want to log in themselves.`
      );
      await renderPendingInvites();
    } catch (e) {
      alert('Error: ' + e.message);
      if (btn) { btn.disabled = false; btn.textContent = 'Send Invite'; }
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
    const ntEl = document.getElementById('pgr-night-target-input');
    if (ntEl) ntEl.value = pgr.nightTarget ?? '';
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
    const email     = document.getElementById('pgr-email-input').value.trim().toLowerCase();
    const role      = document.getElementById('pgr-role-input').value;
    const year      = parseInt(document.getElementById('pgr-year-input').value) || null;
    const minDuties  = parseInt(document.getElementById('pgr-min-duties-input').value) ?? null;
    const ntRaw      = document.getElementById('pgr-night-target-input')?.value;
    const nightTarget = ntRaw !== '' && ntRaw != null && !isNaN(parseInt(ntRaw)) ? parseInt(ntRaw) : null;
    const editId    = document.getElementById('pgr-edit-id').value;

    if (!name) { alert('Name required.'); return; }
    if (!editId) { alert('No user selected for editing.'); return; }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      alert('Invalid email address.'); return;
    }

    const existing = DB.getPGR(editId);
    const pgr = { ...existing, name, email: email || existing.email || '', role, year, minDuties, nightTarget };
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
    const sm = document.getElementById('shift-mode-select');
    if (sm) sm.value = cfg.shiftMode;
    const mb = document.getElementById('max-bays-input');
    if (mb) mb.value = cfg.maxBaysPerPGR;
    const md = document.getElementById('min-duties-input');
    if (md) md.value = cfg.minDutiesPerMonth;
    const ny = document.getElementById('num-years-input');
    if (ny) ny.value = cfg.numYears || 4;
    // Per-year min duties
    const yd  = cfg.yearMinDuties || {};
    const box = document.getElementById('year-duties-container');
    if (box) {
      box.innerHTML = years.map(y =>
        `<label style="margin:0">Y${y}</label>` +
        `<input type="number" id="year-duties-${y}" min="0" max="31" value="${yd[y] ?? cfg.minDutiesPerMonth}" ` +
        `style="width:64px" onchange="Admin.saveYearDuties()" />`
      ).join('');
    }
    // Per-year night duties
    const nyd  = cfg.yearNightDuties || {};
    const nbox = document.getElementById('year-night-duties-container');
    if (nbox) {
      nbox.innerHTML = years.map(y =>
        `<label style="margin:0">Y${y}</label>` +
        `<input type="number" id="year-night-${y}" min="0" max="${yd[y] ?? cfg.minDutiesPerMonth}" ` +
        `value="${nyd[y] ?? 0}" style="width:64px" onchange="Admin.saveYearNightDuties()" />`
      ).join('');
    }
    try { renderGlobalWeekendSection(); } catch (e) { console.error('[Admin] renderGlobalWeekendSection failed:', e); }
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

  async function saveYearNightDuties() {
    const cfg   = DB.getConfig();
    const years = DB.getYears();
    cfg.yearNightDuties = cfg.yearNightDuties || {};
    years.forEach(y => {
      const el = document.getElementById(`year-night-${y}`);
      if (el) cfg.yearNightDuties[y] = parseInt(el.value) || 0;
    });
    await DB.saveConfig(cfg);
    renderShiftSettings(); // rebuild night-per-year caps
  }

  // ── Global weekend quotas (Settings tab) — per training year ──────────
  function renderGlobalWeekendSection() {
    const el = document.getElementById('global-weekend-quota-section');
    if (!el) return;
    const years  = DB.getYears();
    const yqMap  = DB.getYearWeekendQuotas();
    const shifts = DB.getShifts();
    const nightIds = new Set(shifts.filter(s =>
      s.id === 'Night' || s.label.toLowerCase().includes('night') || (s.hours || 0) >= 10
    ).map(s => s.id));
    const dayLbl   = shifts.filter(s => !nightIds.has(s.id)).map(s => s.label).join('/') || 'Day';
    const nightLbl = shifts.filter(s =>  nightIds.has(s.id)).map(s => s.label).join('/') || 'Night';

    const headerRow = `
      <div class="year-wknd-grid" style="margin-bottom:.2rem">
        <span class="wknd-quota-label" style="font-weight:600">Year</span>
        <span class="wknd-quota-label" style="font-weight:600">Sat — ${dayLbl}</span>
        <span class="wknd-quota-label" style="font-weight:600">Sat — ${nightLbl}</span>
        <span class="wknd-quota-label" style="font-weight:600">Sun — ${dayLbl}</span>
        <span class="wknd-quota-label" style="font-weight:600">Sun — ${nightLbl}</span>
      </div>`;

    const dataRows = years.map(y => {
      const q = yqMap[y] || { satDay: 0, satNight: 0, sunDay: 0, sunNight: 0 };
      return `
        <div class="year-wknd-grid" style="margin-bottom:.35rem">
          <span class="wknd-quota-label">Y${y}</span>
          <input type="number" id="ywq-${y}-satDay"   class="input wknd-quota-input" min="0" max="8" value="${q.satDay}" />
          <input type="number" id="ywq-${y}-satNight" class="input wknd-quota-input" min="0" max="8" value="${q.satNight}" />
          <input type="number" id="ywq-${y}-sunDay"   class="input wknd-quota-input" min="0" max="8" value="${q.sunDay}" />
          <input type="number" id="ywq-${y}-sunNight" class="input wknd-quota-input" min="0" max="8" value="${q.sunNight}" />
        </div>`;
    }).join('');

    el.innerHTML = `
      <div style="margin:.5rem 0 .75rem">${headerRow}${dataRows}</div>
      <button class="btn btn-secondary btn-sm" onclick="Admin.saveGlobalWeekendQuotas()">Save Year Quotas</button>`;
  }

  async function saveGlobalWeekendQuotas() {
    const years = DB.getYears();
    const get   = (y, slot) => Math.max(0, parseInt(document.getElementById(`ywq-${y}-${slot}`)?.value || '0', 10) || 0);
    const map   = {};
    years.forEach(y => {
      map[y] = {
        satDay:   get(y, 'satDay'),
        satNight: get(y, 'satNight'),
        sunDay:   get(y, 'sunDay'),
        sunNight: get(y, 'sunNight'),
      };
    });
    await DB.saveYearWeekendQuotas(map);
    const btn = document.querySelector('#global-weekend-quota-section .btn-secondary');
    if (btn) { btn.textContent = 'Saved \u2713'; setTimeout(() => { btn.textContent = 'Save Year Quotas'; }, 1500); }
  }

  // ── SR-managed PGR Preferences Tab ─────────────────────
  function renderSRPrefsTab() {
    const el = document.getElementById('admin-tab-prefs');
    if (!el) return;
    const pgrs    = DB.getPGRs().filter(p => ['pgr','senior_pgr','senior_registrar'].includes(p.role));
    const ym      = RosterEngine.currentYM();
    const pgrOpts = pgrs.map(p =>
      `<option value="${p.id}"${_srPrefPGR === p.id ? ' selected' : ''}>${p.name}</option>`
    ).join('');

    // Re-sync srPrefSel from DB whenever we (re-)render the tab
    if (_srPrefPGR) {
      const pref = DB.getPrefForPGR(_srPrefPGR);
      _srPrefSel = new Set((pref.srOffDays || []).filter(d => d?.startsWith(ym)));
    }
    // Build each sub-section individually so a crash in one doesn't blank the whole tab
    let calHtml = '', bayHtml = '', quotaHtml = '';
    if (_srPrefPGR) {
      try { calHtml   = _buildSRPrefCalendar(ym);    } catch (e) { console.error('[Admin] _buildSRPrefCalendar failed:', e); calHtml = `<p style="color:var(--err);font-size:.8rem">Error: ${e.message}</p>`; }
      try { bayHtml   = _buildBayPrioritySection();  } catch (e) { console.error('[Admin] _buildBayPrioritySection failed:', e); }
      try { quotaHtml = _buildWeekendQuotaSection(); } catch (e) { console.error('[Admin] _buildWeekendQuotaSection failed:', e); }
    }
    el.innerHTML = `
      <div class="admin-section">
        <h3>Set PGR Off-Day Preferences</h3>
        <p class="muted" style="font-size:.82rem">
          These act as a fallback — if a PGR has not set their own preferences for the month,
          yours apply. The PGR’s own choices always take priority day-by-day.
        </p>
        <div style="display:flex;align-items:center;gap:.75rem;flex-wrap:wrap;margin-bottom:1rem">
          <label style="margin:0;white-space:nowrap">Select PGR</label>
          <select id="sr-pref-pgr-sel" onchange="Admin.selectSRPrefPGR(this.value)">
            <option value="">— choose a PGR —</option>
            ${pgrOpts}
          </select>
          ${_srPrefPGR
            ? `<button class="btn btn-primary btn-sm" onclick="Admin.saveSRPrefs()">Save Preferences</button>`
            : ''}
        </div>
        <div id="sr-pref-calendar">${calHtml}</div>
        ${_srPrefPGR ? `<div class="bay-settings-container">${bayHtml}</div>` : ''}
        ${_srPrefPGR ? `<div class="wknd-quota-container">${quotaHtml}</div>` : ''}
      </div>`;
  }

  function _buildSRPrefCalendar(ym) {
    const [year, month] = ym.split('-').map(Number);
    const daysInMonth   = new Date(year, month, 0).getDate();
    const DAY_NAMES     = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const today         = new Date().toISOString().slice(0, 10);
    const pgrPref       = DB.getPrefForPGR(_srPrefPGR);
    const pgrOwn        = new Set((pgrPref.offDays || []).filter(d => d?.startsWith(ym)));

    let html = `<div class="roster-matrix-wrap"><table class="roster-matrix" style="max-width:520px">
      <thead><tr>
        <th class="rm-hdr rm-date-hdr">Date</th>
        <th class="rm-hdr rm-day-hdr">Day</th>
        <th class="rm-hdr" style="text-align:left;padding-left:.75rem">SR Preference</th>
        <th class="rm-hdr" style="text-align:left;padding-left:.75rem">PGR’s Own</th>
      </tr></thead><tbody>`;

    for (let d = 1; d <= daysInMonth; d++) {
      const date   = `${ym}-${String(d).padStart(2,'0')}`;
      const dow    = new Date(year, month - 1, d).getDay();
      const isWknd = dow === 0 || dow === 6;
      const isTdy  = date === today;
      const isSel  = _srPrefSel.has(date);
      const ownOff = pgrOwn.has(date);
      const holidayName = RosterEngine.getHolidayName(date);
      html += `<tr class="rm-row${isTdy ? ' rm-today' : ''}${isWknd ? ' rm-weekend' : ''}${holidayName ? ' rm-holiday' : ''}">
        <td class="rm-date-cell${isTdy ? ' rm-today' : ''}${holidayName ? ' rm-holiday-date' : ''}"><span class="rm-date-num">${d}</span>${holidayName ? '<span class="rm-holiday-dot"></span>' : ''}</td>
        <td class="rm-dayname-cell${isWknd ? ' rm-wknd-text' : ''}" title="${holidayName || ''}">${DAY_NAMES[dow]}${holidayName ? `<span class="rm-holiday-tag">${holidayName}</span>` : ''}</td>
        <td class="rm-cell" onclick="Admin.toggleSRPrefDay('${date}')" style="cursor:pointer;padding:.3rem .6rem">
          ${isSel
            ? `<div class="rm-name rm-name-morning">Off (SR)</div>`
            : `<span class="rm-unassigned" style="font-size:.74rem">click to mark</span>`}
        </td>
        <td class="rm-cell" style="padding:.3rem .6rem">
          ${ownOff
            ? `<div class="rm-name rm-name-morning" style="opacity:.55">Off (PGR)</div>`
            : `<span class="rm-unassigned">—</span>`}
        </td>
      </tr>`;
    }
    html += `</tbody></table></div>`;
    return html;
  }

  function selectSRPrefPGR(id) {
    _srPrefPGR = id || null;
    if (_srPrefPGR) {
      const ym    = RosterEngine.currentYM();
      const pref  = DB.getPrefForPGR(_srPrefPGR);
      _srPrefSel  = new Set((pref.srOffDays || []).filter(d => d?.startsWith(ym)));
      _srExcluded = new Set(pref.excludedBays || []);
      // Bay order = saved priorities for non-excluded bays, then any missing
      const allUnitIds = DB.getUnits().map(u => u.id);
      const saved      = (pref.bayPriorities || []).filter(uid => !_srExcluded.has(uid));
      _srBayOrder = [
        ...saved.filter(uid => allUnitIds.includes(uid)),
        ...allUnitIds.filter(uid => !saved.includes(uid) && !_srExcluded.has(uid)),
      ];
    } else {
      _srBayOrder = [];
      _srExcluded = new Set();
    }
    renderSRPrefsTab();
  }

  function toggleSRPrefDay(date) {
    if (_srPrefSel.has(date)) _srPrefSel.delete(date);
    else _srPrefSel.add(date);
    const calEl = document.getElementById('sr-pref-calendar');
    if (calEl) calEl.innerHTML = _buildSRPrefCalendar(date.slice(0, 7));
  }

  async function saveSRPrefs() {
    if (!_srPrefPGR) return;
    const ym          = RosterEngine.currentYM();
    const pref        = DB.getPrefForPGR(_srPrefPGR);
    const otherMonths = (pref.srOffDays || []).filter(d => d && !d.startsWith(ym));
    await DB.saveSRPrefsForPGR(_srPrefPGR, [...otherMonths, ..._srPrefSel]);
    const btn = document.querySelector('#admin-tab-prefs .btn-primary');
    if (btn) { btn.textContent = 'Saved ✓'; setTimeout(() => { btn.textContent = 'Save Preferences'; }, 1500); }
  }

  function _buildBayPrioritySection() {
    const units = DB.getUnits();
    if (!units.length) return '';

    // ─ Excluded bays checkboxes
    let html = `
      <div style="margin-top:1.5rem">
        <h4 style="margin:0 0 .2rem">Bay Restrictions</h4>
        <p class="muted" style="font-size:.78rem;margin:0 0 .65rem">
          Tick bays this PGR <strong>cannot</strong> be assigned to.
          Auto-generate will skip them; manual assignment will show an error.
        </p>
        <div class="bay-exclude-list">`;
    units.forEach(u => {
      const checked = _srExcluded.has(u.id) ? 'checked' : '';
      html += `<label class="bay-exclude-row">
        <input type="checkbox" ${checked} onchange="Admin.toggleSRExcludedBay('${u.id}')" />
        <span>${u.name}</span>
        ${_srExcluded.has(u.id) ? '<span class="badge badge-err" style="margin-left:.5rem;font-size:.68rem">Excluded</span>' : ''}
      </label>`;
    });
    html += `</div>`;

    // ─ Priority order (only for non-excluded bays)
    if (_srBayOrder.length) {
      html += `
        <h4 style="margin:1.1rem 0 .2rem">Assignment Priority</h4>
        <p class="muted" style="font-size:.78rem;margin:0 0 .65rem">
          Rank allowed bays most-to-least preferred. Auto-generate uses this order.
        </p>
        <div class="bay-priority-list">`;
      _srBayOrder.forEach((uid, idx) => {
        const unit = units.find(u => u.id === uid);
        if (!unit) return;
        html += `<div class="bay-prio-row">
          <span class="bay-prio-num">${idx + 1}</span>
          <span class="bay-prio-name">${unit.name}</span>
          <div class="bay-prio-btns">
            ${idx > 0
              ? `<button class="btn btn-xs btn-ghost" onclick="Admin.moveSRBay('${uid}',-1)">↑</button>`
              : `<span style="display:inline-block;width:30px"></span>`}
            ${idx < _srBayOrder.length - 1
              ? `<button class="btn btn-xs btn-ghost" onclick="Admin.moveSRBay('${uid}',1)">↓</button>`
              : `<span style="display:inline-block;width:30px"></span>`}
          </div>
        </div>`;
      });
      html += `</div>`;
    }

    html += `
        <button class="btn btn-secondary btn-sm" style="margin-top:.9rem"
          onclick="Admin.saveSRBaySettings()">Save Bay Settings</button>
      </div>`;
    return html;
  }

  function toggleSRExcludedBay(unitId) {
    if (_srExcluded.has(unitId)) {
      _srExcluded.delete(unitId);
      // Re-add to bottom of priority order
      if (!_srBayOrder.includes(unitId)) _srBayOrder.push(unitId);
    } else {
      _srExcluded.add(unitId);
      _srBayOrder = _srBayOrder.filter(id => id !== unitId);
    }
    // Re-render the bay section only (don't reset the calendar scroll)
    const el = document.getElementById('admin-tab-prefs');
    if (el) {
      const bayDiv = el.querySelector('.bay-settings-container');
      if (bayDiv) bayDiv.outerHTML = `<div class="bay-settings-container">${_buildBayPrioritySection()}</div>`;
      else renderSRPrefsTab();
    }
  }

  function moveSRBay(id, dir) {
    const idx = _srBayOrder.indexOf(id);
    if (idx === -1) return;
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= _srBayOrder.length) return;
    [_srBayOrder[idx], _srBayOrder[newIdx]] = [_srBayOrder[newIdx], _srBayOrder[idx]];
    // Re-render just the bay section by rebuilding the prefs tab
    renderSRPrefsTab();
  }

  async function saveSRBaySettings() {
    if (!_srPrefPGR) return;
    await DB.saveBayPrioritiesForPGR(_srPrefPGR, [..._srBayOrder]);
    await DB.saveExcludedBaysForPGR(_srPrefPGR, [..._srExcluded]);
    const btn = document.querySelector('#admin-tab-prefs .btn-secondary');
    if (btn) { btn.textContent = 'Saved ✓'; setTimeout(() => { btn.textContent = 'Save Bay Settings'; }, 1500); }
  }

  // ── Weekend duty quotas section (per-PGR override) ─────
  function _buildWeekendQuotaSection() {
    const pref      = DB.getPrefForPGR(_srPrefPGR);
    const pgr       = DB.getPGR(_srPrefPGR);
    const global    = DB.getGlobalWeekendQuotasForYear(pgr?.year);  // year-specific baseline
    const hasOverride = pref.weekendQuotas != null;
    const effectiveQ  = DB.getWeekendQuotasForPGR(_srPrefPGR); // per-PGR or global fallback
    const shifts    = DB.getShifts();
    const ym        = RosterEngine.currentYM();
    const yr        = parseInt(ym.slice(0, 4));
    const mo        = parseInt(ym.slice(5, 7));

    // Shift label helpers
    const nightIds = new Set(shifts.filter(s =>
      s.id === 'Night' || s.label.toLowerCase().includes('night') || (s.hours || 0) >= 10
    ).map(s => s.id));
    const dayLabel   = shifts.filter(s => !nightIds.has(s.id)).map(s => s.label).join(' / ') || 'Day';
    const nightLabel = shifts.filter(s =>  nightIds.has(s.id)).map(s => s.label).join(' / ') || 'Night';

    // Month availability
    let satCount = 0, sunCount = 0;
    const daysInM = new Date(yr, mo, 0).getDate();
    for (let d = 1; d <= daysInM; d++) {
      const dow = new Date(yr, mo - 1, d).getDay();
      if (dow === 6) satCount++;
      if (dow === 0) sunCount++;
    }

    // Current month progress per bucket
    const done = { satDay: 0, satNight: 0, sunDay: 0, sunNight: 0 };
    DB.getRosterForMonth(ym).filter(r => r.pgrId === _srPrefPGR).forEach(r => {
      const dow = new Date(yr, mo - 1, parseInt(r.date.slice(8))).getDay();
      if (dow !== 6 && dow !== 0) return;
      const isNt = nightIds.has(r.shift);
      if (dow === 6) done[isNt ? 'satNight' : 'satDay']++;
      else           done[isNt ? 'sunNight' : 'sunDay']++;
    });

    // Duty cap & validation
    const dutyMax = Number(DB.getConfig().minDutiesPerMonth) || 10;
    const qSum    = Object.values(effectiveQ).reduce((a, b) => a + b, 0);
    const capWarn = qSum > dutyMax
      ? `<p class="wknd-quota-cap-warn">⚠ Total weekend quota (${qSum}) exceeds monthly duty cap (${dutyMax}). Reduce to avoid conflicts.</p>`
      : '';

    // Override status badge + reset button
    const statusBadge = hasOverride
      ? `<span class="badge badge-warn" style="font-size:.68rem">Custom override</span>`
      : `<span class="badge badge-ok"   style="font-size:.68rem">Using global defaults</span>`;
    const resetBtn = hasOverride
      ? `<button class="btn btn-xs btn-ghost" onclick="Admin.resetPGRWeekendToGlobal()"
           title="Remove custom override and revert to global defaults">Reset to global</button>`
      : '';

    function inp(id, val, globalVal, current, available, label) {
      const pct  = val > 0 ? Math.min(100, Math.round((current / val) * 100)) : 0;
      const met  = val > 0 && current >= val;
      const fill = val > 0 ? `style="width:${pct}%"` : 'style="width:0"';
      const gNote = hasOverride
        ? `<span style="font-size:.63rem;color:var(--text-muted);margin-left:.3rem">(global: ${globalVal})</span>` : '';
      return `
        <div class="wknd-quota-row wknd-quota-row-full">
          <label class="wknd-quota-label">${label}${gNote}</label>
          <input type="number" id="wknd-${id}" class="input wknd-quota-input"
            min="0" max="${available * 2}" value="${val}">
          <div class="wknd-quota-progress-bar">
            <div class="wknd-quota-progress-fill${met ? ' met' : ''}" ${fill}></div>
          </div>
          <div class="wknd-quota-meta">
            <span>${current} done this month</span>
            <span>${available} ${available === 1 ? 'day' : 'days'} in month</span>
          </div>
        </div>`;
    }

    const monthLabel = new Date(yr, mo - 1, 1)
      .toLocaleString('default', { month: 'long', year: 'numeric' });

    return `
      <div style="margin-top:1.5rem">
        <div style="display:flex;align-items:center;flex-wrap:wrap;gap:.35rem;margin-bottom:.3rem">
          <h4 style="margin:0">Weekend &amp; Holiday Duty Quotas</h4>
          ${statusBadge}${resetBtn}
        </div>
        <p class="wknd-quota-mandatory-note">📋 Mandatory minimums — auto-generate fills these first</p>
        <p class="muted" style="font-size:.78rem;margin:0 0 .6rem">
          How many weekend/holiday duties this PGR <strong>must</strong> receive per month.
          ${hasOverride ? 'This PGR has a <strong>custom override</strong> that differs from the global default.' : 'Inheriting the <strong>global default</strong> — save below to create a per-PGR override.'}
          These count toward the monthly duty cap (${dutyMax}).
        </p>
        <p class="muted" style="font-size:.74rem;margin:0 0 .85rem">Progress for <strong>${monthLabel}</strong></p>
        <div class="wknd-quota-grid">
          ${inp('satDay',   effectiveQ.satDay,   global.satDay,   done.satDay,   satCount, 'Saturday — ' + dayLabel)}
          ${inp('satNight', effectiveQ.satNight, global.satNight, done.satNight, satCount, 'Saturday — ' + nightLabel)}
          ${inp('sunDay',   effectiveQ.sunDay,   global.sunDay,   done.sunDay,   sunCount, 'Sunday — '   + dayLabel)}
          ${inp('sunNight', effectiveQ.sunNight, global.sunNight, done.sunNight, sunCount, 'Sunday — '   + nightLabel)}
        </div>
        ${capWarn}
        <button class="btn btn-secondary btn-sm" style="margin-top:.75rem"
          onclick="Admin.saveWeekendQuotas()">${hasOverride ? 'Save Override' : 'Save as Override'}</button>
      </div>`;
  }

  async function saveWeekendQuotas() {
    if (!_srPrefPGR) return;
    const get = id => Math.max(0, parseInt(document.getElementById(`wknd-${id}`)?.value || '0', 10) || 0);
    const quotas = {
      satDay:   get('satDay'),
      satNight: get('satNight'),
      sunDay:   get('sunDay'),
      sunNight: get('sunNight'),
    };
    await DB.saveWeekendQuotasForPGR(_srPrefPGR, quotas);
    // Re-render the quota section to reflect new override status
    const container = document.querySelector('.wknd-quota-container');
    if (container) container.outerHTML = `<div class="wknd-quota-container">${_buildWeekendQuotaSection()}</div>`;
  }

  async function resetPGRWeekendToGlobal() {
    if (!_srPrefPGR) return;
    await DB.clearWeekendQuotasForPGR(_srPrefPGR);
    const container = document.querySelector('.wknd-quota-container');
    if (container) container.outerHTML = `<div class="wknd-quota-container">${_buildWeekendQuotaSection()}</div>`;
  }

  // ── Replacement log ────────────────────────────
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
    render, switchTab,
    renderPGRList, renderPendingInvites, sendInvite, revokeInvite,
    _onInviteRoleChange,
    openEditPGR, closePGRModal, savePGR, deletePGR, transferAdmin,
    renderUnitList, addUnit, deleteUnit,
    saveShiftMode, saveMaxBays, saveMinDuties, saveNumYears, saveYearDuties, saveYearNightDuties,
    renderReplacementLog, addAdminLeave,
    renderSRPrefsTab, selectSRPrefPGR, toggleSRPrefDay, saveSRPrefs,
    toggleSRExcludedBay, moveSRBay, saveSRBaySettings,
    saveWeekendQuotas, resetPGRWeekendToGlobal,
    renderGlobalWeekendSection, saveGlobalWeekendQuotas,
  };
})();
