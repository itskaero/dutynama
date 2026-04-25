/**
 * leaveManager.js — Leave application, approval, and UI
 */

const LeaveManager = (() => {

  function render() {
    const user = Auth.currentUser();
    renderAdminSection();
    renderMySection(user);
  }

  // ── SR calendar: all leaves as a day grid ──────────────
  function renderAdminSection() {
    const el = document.getElementById('leave-admin-section');
    if (!Auth.can('manageLeaves')) { el.innerHTML = ''; return; }

    const ym            = RosterEngine.currentYM();
    const leaves        = DB.getLeavesForMonth(ym);
    const pgrs          = DB.getPGRs();
    const [year, month] = ym.split('-').map(Number);
    const daysInMonth   = new Date(year, month, 0).getDate();
    const today         = new Date().toISOString().slice(0, 10);
    const DAY_NAMES     = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const monthLabel    = new Date(year, month - 1, 1)
      .toLocaleString('default', { month: 'long', year: 'numeric' });

    const pending = leaves.filter(l => l.status === 'pending').length;

    let html = `
      <div class="cal-toolbar">
        <span class="cal-month-label">Leave Review — ${monthLabel}</span>
        ${pending ? `<span class="badge badge-warn">${pending} pending</span>` : '<span class="badge badge-ok">All reviewed</span>'}
      </div>
      <div class="roster-matrix-wrap">
        <table class="roster-matrix">
          <thead>
            <tr>
              <th class="rm-hdr rm-date-hdr">Date</th>
              <th class="rm-hdr rm-day-hdr">Day</th>
              <th class="rm-hdr" style="text-align:left;padding-left:.75rem;min-width:280px">Leave Applications</th>
            </tr>
          </thead>
          <tbody>`;

    for (let d = 1; d <= daysInMonth; d++) {
      const date      = `${ym}-${String(d).padStart(2,'0')}`;
      const dow       = new Date(year, month - 1, d).getDay();
      const isWknd    = dow === 0 || dow === 6;
      const isTdy     = date === today;
      const dayLeaves = leaves.filter(l => l.date === date);

      const chips = dayLeaves.map(l => {
        const pgr  = pgrs.find(p => p.id === l.pgrId);
        const name = pgr ? pgr.name.split(' ')[0] : 'PGR'; // first name only
        const cls  = l.status === 'approved' ? 'rm-name-morning'
                   : l.status === 'rejected' ? 'rm-leave-warn'
                   : 'rm-name-evening'; // pending = amber
        return `<div class="rm-name ${cls} lv-chip"
          style="cursor:pointer;display:inline-flex;align-items:center;gap:.3rem;margin:.1rem .2rem"
          onclick="LeaveManager.openLeaveReview('${l.id}')"
          title="${pgr?.name} — ${l.status}${l.note ? ': ' + l.note : ''}">
          ${name}
          <span style="font-size:.65rem;opacity:.75">${l.status === 'pending' ? '⏳' : l.status === 'approved' ? '✓' : '✕'}</span>
        </div>`;
      }).join('');

      const holidayName = RosterEngine.getHolidayName(date);
      html += `<tr class="rm-row${isTdy ? ' rm-today' : ''}${isWknd ? ' rm-weekend' : ''}${holidayName ? ' rm-holiday' : ''}">
        <td class="rm-date-cell${isTdy ? ' rm-today' : ''}${holidayName ? ' rm-holiday-date' : ''}"><span class="rm-date-num">${d}</span>${holidayName ? '<span class="rm-holiday-dot"></span>' : ''}</td>
        <td class="rm-dayname-cell${isWknd ? ' rm-wknd-text' : ''}" title="${holidayName || ''}">${DAY_NAMES[dow]}${holidayName ? `<span class="rm-holiday-tag">${holidayName}</span>` : ''}</td>
        <td class="rm-cell" style="padding:.3rem .5rem">
          ${chips || '<span class="rm-unassigned">—</span>'}
        </td>
      </tr>`;
    }

    html += `</tbody></table></div>`;
    el.innerHTML = html;
  }

  // ── Leave review popup ─────────────────────────────────
  function openLeaveReview(leaveId) {
    const leave = DB.getLeaves().find(l => l.id === leaveId);
    if (!leave) return;
    const pgr = DB.getPGR(leave.pgrId);

    document.getElementById('lv-modal-name').textContent   = pgr?.name || leave.pgrId;
    document.getElementById('lv-modal-date').textContent   = leave.date;
    document.getElementById('lv-modal-note').textContent   = leave.note || '—';
    document.getElementById('lv-modal-status').textContent = leave.status;
    document.getElementById('lv-modal-status').className   =
      'badge ' + ({ approved:'badge-ok', rejected:'badge-err', pending:'badge-warn' }[leave.status] || '');

    const approveBtn = document.getElementById('lv-modal-approve');
    const rejectBtn  = document.getElementById('lv-modal-reject');
    approveBtn.style.display = leave.status !== 'approved' ? '' : 'none';
    rejectBtn.style.display  = leave.status !== 'rejected' ? '' : 'none';

    approveBtn.onclick = () => { approve(leaveId); closeLeaveReview(); };
    rejectBtn.onclick  = () => { reject(leaveId);  closeLeaveReview(); };
    document.getElementById('lv-modal-delete').onclick = () => {
      if (confirm('Delete this leave entry?')) { DB.deleteLeave(leaveId); closeLeaveReview(); render(); }
    };

    document.getElementById('leave-review-modal').classList.remove('hidden');
  }

  function closeLeaveReview() {
    document.getElementById('leave-review-modal').classList.add('hidden');
  }

  // ── My leaves section ──────────────────────────────────
  function renderMySection(user) {
    const el = document.getElementById('leave-my-section');
    if (!Auth.can('applyLeave')) { el.innerHTML = ''; return; }

    const ym            = RosterEngine.currentYM();
    const myLeaves      = DB.getLeavesForPGR(user.id).filter(l => l.date.startsWith(ym));
    const active        = myLeaves.filter(l => l.status !== 'rejected');
    const [year, month] = ym.split('-').map(Number);
    const daysInMonth   = new Date(year, month, 0).getDate();
    const today         = new Date().toISOString().slice(0, 10);
    const DAY_NAMES     = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const monthLabel    = new Date(year, month - 1, 1)
      .toLocaleString('default', { month: 'long', year: 'numeric' });

    let html = `
      <div class="cal-toolbar">
        <span class="cal-month-label">${monthLabel}</span>
        <span class="badge ${active.length >= 2 ? 'badge-err' : 'badge-ok'}">${active.length}/2 used</span>
      </div>
      <div class="leave-apply-form card" id="leave-apply-form">
        <div class="leave-form-row">
          <input type="date" id="leave-date-input"
            min="${ym}-01" max="${ym}-${String(daysInMonth).padStart(2,'0')}"
            placeholder="Select date" />
          <input type="text" id="leave-note-input" placeholder="Reason (optional)" />
          <button class="btn btn-primary btn-sm" onclick="LeaveManager.applyLeave()">Apply Leave</button>
        </div>
      </div>
      <div class="roster-matrix-wrap">
        <table class="roster-matrix">
          <thead>
            <tr>
              <th class="rm-hdr rm-date-hdr">Date</th>
              <th class="rm-hdr rm-day-hdr">Day</th>
              <th class="rm-hdr" style="min-width:130px;text-align:left;padding-left:.75rem">Status</th>
              <th class="rm-hdr" style="min-width:140px;text-align:left;padding-left:.75rem">Note</th>
              <th class="rm-hdr" style="min-width:80px">Action</th>
            </tr>
          </thead>
          <tbody>`;

    for (let d = 1; d <= daysInMonth; d++) {
      const date   = `${ym}-${String(d).padStart(2,'0')}`;
      const dow    = new Date(year, month - 1, d).getDay();
      const isWknd = dow === 0 || dow === 6;
      const isTdy  = date === today;
      const leave  = myLeaves.find(l => l.date === date);
      const status = leave?.status ?? null;

      const statusChip = status === 'approved'
        ? `<div class="rm-name rm-name-morning">approved</div>`
        : status === 'pending'
        ? `<div class="rm-name rm-name-evening">pending</div>`
        : status === 'rejected'
        ? `<div class="rm-name" style="background:var(--red-bg);color:var(--red);border-left:2px solid var(--red)">rejected</div>`
        : `<span class="rm-unassigned" style="font-size:.74rem;color:var(--text-subtle);cursor:pointer">click to apply</span>`;

      // Clicking a free day fills the date input
      const freeClick = !leave
        ? `onclick="document.getElementById('leave-date-input').value='${date}';document.getElementById('leave-apply-form').scrollIntoView({behavior:'smooth',block:'nearest'})"`
        : '';

      const holidayName = RosterEngine.getHolidayName(date);
      html += `<tr class="rm-row${isTdy ? ' rm-today' : ''}${isWknd ? ' rm-weekend' : ''}${holidayName ? ' rm-holiday' : ''}">
        <td class="rm-date-cell${isTdy ? ' rm-today' : ''}${holidayName ? ' rm-holiday-date' : ''}" ${freeClick} style="${!leave ? 'cursor:pointer' : ''}">
          <span class="rm-date-num">${d}</span>${holidayName ? '<span class="rm-holiday-dot"></span>' : ''}
        </td>
        <td class="rm-dayname-cell${isWknd ? ' rm-wknd-text' : ''}" ${freeClick} style="${!leave ? 'cursor:pointer' : ''}" title="${holidayName || ''}">
          ${DAY_NAMES[dow]}${holidayName ? `<span class="rm-holiday-tag">${holidayName}</span>` : ''}
        </td>
        <td class="rm-cell" style="padding:.3rem .6rem" ${freeClick}>
          ${statusChip}
        </td>
        <td class="rm-cell" style="padding:.3rem .6rem;font-size:.78rem;color:var(--text-muted)">
          ${leave?.note || '<span class="rm-unassigned">—</span>'}
        </td>
        <td class="rm-cell" style="text-align:center;padding:.25rem">
          ${status === 'pending'
            ? `<button class="btn btn-xs btn-ghost" onclick="LeaveManager.deleteLeave('${leave.id}')">Cancel</button>`
            : ''}
        </td>
      </tr>`;
    }

    html += `</tbody></table></div>`;
    el.innerHTML = html;
  }

  function applyLeave() {
    const user  = Auth.currentUser();
    const date  = document.getElementById('leave-date-input').value;
    const note  = document.getElementById('leave-note-input').value.trim();
    if (!date) { alert('Select a date.'); return; }

    const issues = ValidationEngine.checkLeave(user.id, date);
    const errors = issues.filter(i => i.severity === 'error');
    if (errors.length) {
      const proceed = confirm(errors.map(i => i.message).join('\n') + '\n\nApply anyway?');
      if (!proceed) return;
    }

    // Low coverage: warn PGR but still allow — they can proceed
    const lowCovIssue = issues.find(i => i.code === 'LOW_COVERAGE');
    if (lowCovIssue) {
      const proceed = confirm(
        `⚠️ Low coverage warning:\n${lowCovIssue.message}\n\nYou can still apply — do you want to continue?`
      );
      if (!proceed) return;
      // Create an alert for senior PGR
      DB.addAlert('warn', lowCovIssue.seniorMessage);
      UI.refreshAlerts();
    }

    issues.filter(i => i.severity === 'warn' && i.code !== 'LOW_COVERAGE').forEach(i =>
      DB.addAlert('warn', i.message)
    );

    const result = DB.applyLeave(user.id, date, note);
    if (!result) { alert('Leave for this date already exists.'); return; }

    issues.filter(i => i.severity === 'error').forEach(i =>
      DB.addAlert('error', i.message)
    );

    document.getElementById('leave-date-input').value = '';
    document.getElementById('leave-note-input').value  = '';
    UI.refreshAlerts();
    render();
  }

  function approve(leaveId) {
    DB.updateLeaveStatus(leaveId, 'approved');
    const leave = DB.getLeaves().find(l => l.id === leaveId);
    if (leave) {
      const pgr = DB.getPGR(leave.pgrId);

      // Duty conflict: PGR has assignments on the approved leave day
      const duties = DB.getRosterForDate(leave.date).filter(r => r.pgrId === leave.pgrId);
      if (duties.length) {
        DB.addAlert('error',
          `[SR] Leave approved for ${pgr?.name} on ${leave.date} — they have ${duties.length} duty assignment(s) that day! Roster needs updating.`);
        UI.refreshAlerts();
      }

      // Post-roster coverage: re-check how many PGRs are now available on that day
      const allOnLeaveNow = DB.getLeaves()
        .filter(l => l.date === leave.date && l.status === 'approved' && l.pgrId !== leave.pgrId);
      const totalPGRs = DB.getPGRs().filter(p => p.role !== 'viewer').length;
      const available  = totalPGRs - allOnLeaveNow.length - 1;
      const threshold  = Math.max(2, Math.floor(totalPGRs * 0.4));
      if (available < threshold) {
        DB.addAlert('warn',
          `[SR] Coverage low on ${leave.date} after approving ${pgr?.name}'s leave — only ${available} PGR(s) available. Review roster.`);
        UI.refreshAlerts();
      }
    }
    render();
  }

  function reject(leaveId) {
    DB.updateLeaveStatus(leaveId, 'rejected');
    render();
  }

  function deleteLeave(leaveId) {
    if (!confirm('Delete this leave entry?')) return;
    DB.deleteLeave(leaveId);
    render();
  }

  return { render, applyLeave, approve, reject, deleteLeave, openLeaveReview, closeLeaveReview };
})();
