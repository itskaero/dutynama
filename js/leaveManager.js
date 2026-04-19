/**
 * leaveManager.js — Leave application, approval, and UI
 */

const LeaveManager = (() => {

  function render() {
    const user = Auth.currentUser();
    renderAdminSection();
    renderMySection(user);
  }

  // ── Admin section: all pending leaves ──────────────────
  function renderAdminSection() {
    const el = document.getElementById('leave-admin-section');
    if (!Auth.can('manageLeaves')) { el.innerHTML = ''; return; }

    const ym      = RosterEngine.currentYM();
    const leaves  = DB.getLeavesForMonth(ym);
    const pgrs    = DB.getPGRs();

    let html = `<div class="section-heading">All Leaves — ${ym}</div>`;
    if (!leaves.length) {
      html += `<p class="muted">No leave applications this month.</p>`;
    } else {
      html += `<table class="data-table">
        <thead><tr><th>PGR</th><th>Date</th><th>Note</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>`;
      leaves.forEach(l => {
        const pgr  = pgrs.find(p => p.id === l.pgrId);
        const name = pgr ? pgr.name : l.pgrId;
        const statusCls = { pending:'badge-warn', approved:'badge-ok', rejected:'badge-err' }[l.status] || '';
        html += `<tr>
          <td>${name}</td>
          <td>${l.date}</td>
          <td>${l.note || '—'}</td>
          <td><span class="badge ${statusCls}">${l.status}</span></td>
          <td>
            ${l.status === 'pending' ? `
              <button class="btn btn-xs btn-primary" onclick="LeaveManager.approve('${l.id}')">Approve</button>
              <button class="btn btn-xs btn-danger"  onclick="LeaveManager.reject('${l.id}')">Reject</button>
            ` : ''}
            <button class="btn btn-xs btn-ghost" onclick="LeaveManager.deleteLeave('${l.id}')">Delete</button>
          </td>
        </tr>`;
      });
      html += `</tbody></table>`;
    }
    el.innerHTML = html;
  }

  // ── My leaves section ──────────────────────────────────
  function renderMySection(user) {
    const el = document.getElementById('leave-my-section');
    if (!Auth.can('applyLeave')) { el.innerHTML = ''; return; }

    const ym      = RosterEngine.currentYM();
    const myLeaves = DB.getLeavesForPGR(user.id).filter(l => l.date.startsWith(ym));
    const pending  = myLeaves.filter(l => l.status !== 'rejected').length;

    let html = `<div class="section-heading">My Leaves — ${ym}
      <span class="badge ${pending >= 2 ? 'badge-err' : 'badge-ok'}">${pending}/2 used</span>
    </div>`;

    html += `<div class="leave-form card">
      <h4>Apply for Leave</h4>
      <label>Date</label>
      <input type="date" id="leave-date-input" min="${ym}-01" max="${ym}-31" />
      <label>Note (optional)</label>
      <input type="text" id="leave-note-input" placeholder="Reason..." />
      <button class="btn btn-primary" onclick="LeaveManager.applyLeave()">Apply</button>
    </div>`;

    if (!myLeaves.length) {
      html += `<p class="muted">No leaves applied this month.</p>`;
    } else {
      html += `<table class="data-table">
        <thead><tr><th>Date</th><th>Note</th><th>Status</th><th></th></tr></thead>
        <tbody>`;
      myLeaves.forEach(l => {
        const statusCls = { pending:'badge-warn', approved:'badge-ok', rejected:'badge-err' }[l.status] || '';
        html += `<tr>
          <td>${l.date}</td>
          <td>${l.note || '—'}</td>
          <td><span class="badge ${statusCls}">${l.status}</span></td>
          <td>
            ${l.status === 'pending'
              ? `<button class="btn btn-xs btn-ghost" onclick="LeaveManager.deleteLeave('${l.id}')">Cancel</button>`
              : ''}
          </td>
        </tr>`;
      });
      html += `</tbody></table>`;
    }
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
    issues.filter(i => i.severity === 'warn').forEach(i =>
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
    // Raise alert if PGR has duty on that day
    const leave = DB.getLeaves().find(l => l.id === leaveId);
    if (leave) {
      const duties = DB.getRosterForDate(leave.date).filter(r => r.pgrId === leave.pgrId);
      if (duties.length) {
        const pgr = DB.getPGR(leave.pgrId);
        DB.addAlert('error',
          `Leave approved for ${pgr?.name} on ${leave.date}, but they have ${duties.length} duty assignment(s) that day!`);
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

  return { render, applyLeave, approve, reject, deleteLeave };
})();
