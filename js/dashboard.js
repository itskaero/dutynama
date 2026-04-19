/**
 * dashboard.js — Today's status, monthly stats, overwork indicators
 */

const Dashboard = (() => {

  function render() {
    renderTodayCards();
    renderTodayDutyTable();
    renderMonthlyStats();
    renderOverworkIndicators();
  }

  function todayStr() {
    return new Date().toISOString().slice(0, 10);
  }

  function currentYM() {
    return todayStr().slice(0, 7);
  }

  // ── Summary cards at top ──────────────────────────────
  function renderTodayCards() {
    const date   = todayStr();
    const ym     = currentYM();
    const pgrs   = DB.getPGRs();
    const roster = DB.getRosterForDate(date);
    const leaves = DB.getLeavesForDate(date);   // approved only

    const onDuty  = new Set(roster.map(r => r.pgrId)).size;
    const onLeave = leaves.length;
    const total   = pgrs.length;
    const offDuty = total - onDuty - onLeave;

    const html = `
      <div class="stat-card green">
        <div class="stat-num">${onDuty}</div>
        <div class="stat-label">On Duty Today</div>
      </div>
      <div class="stat-card red">
        <div class="stat-num">${onLeave}</div>
        <div class="stat-label">On Leave Today</div>
      </div>
      <div class="stat-card blue">
        <div class="stat-num">${offDuty < 0 ? 0 : offDuty}</div>
        <div class="stat-label">Off Today</div>
      </div>
      <div class="stat-card gray">
        <div class="stat-num">${total}</div>
        <div class="stat-label">Total PGRs</div>
      </div>
    `;
    document.getElementById('today-cards').innerHTML = html;
    document.getElementById('today-date-label').textContent =
      new Date().toLocaleDateString('default', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
  }

  // ── Today's duty table ────────────────────────────────
  function renderTodayDutyTable() {
    const date   = todayStr();
    const pgrs   = DB.getPGRs();
    const roster = DB.getRosterForDate(date);
    const leaves = DB.getLeavesForDate(date);
    const shifts = DB.getShifts();
    const units  = DB.getUnits();

    if (!roster.length && !leaves.length) {
      document.getElementById('today-duty-table').innerHTML =
        '<p class="muted">No assignments recorded for today.</p>';
      return;
    }

    let html = `<table class="data-table">
      <thead><tr><th>PGR</th><th>Shift</th><th>Unit(s)</th><th>Status</th></tr></thead>
      <tbody>`;

    // Group by PGR + Shift
    const seen = new Map(); // key = pgrId|shift
    roster.forEach(r => {
      const key = `${r.pgrId}|${r.shift}`;
      if (!seen.has(key)) seen.set(key, { pgrId: r.pgrId, shift: r.shift, units: [], replaced: r.replaced, replacedBy: r.replacedBy });
      seen.get(key).units.push(r.unitId);
    });

    seen.forEach(entry => {
      const pgr   = pgrs.find(p => p.id === entry.pgrId);
      const sh    = shifts.find(s => s.id === entry.shift);
      const onLv  = DB.isOnLeave(entry.pgrId, date);
      html += `<tr>
        <td>${pgr?.name || entry.pgrId}</td>
        <td><span class="legend-chip ${entry.shift.toLowerCase()}">${entry.shift[0]}</span> ${sh?.label || entry.shift}</td>
        <td>${entry.units.join(', ')}</td>
        <td>
          ${onLv ? '<span class="badge badge-err">ON LEAVE!</span>' : ''}
          ${entry.replaced ? `<span class="badge badge-warn">Replaced</span>` : '<span class="badge badge-ok">Active</span>'}
        </td>
      </tr>`;
    });

    // Leave rows
    leaves.forEach(l => {
      const pgr = pgrs.find(p => p.id === l.pgrId);
      html += `<tr class="row-leave">
        <td>${pgr?.name || l.pgrId}</td>
        <td colspan="2"><em>On Leave</em></td>
        <td><span class="badge badge-err">Leave</span></td>
      </tr>`;
    });

    html += `</tbody></table>`;
    document.getElementById('today-duty-table').innerHTML = html;
  }

  // ── Monthly stats per PGR ─────────────────────────────
  function renderMonthlyStats() {
    const ym   = RosterEngine.currentYM();
    const pgrs = DB.getPGRs();
    const cfg  = DB.getConfig();

    let html = `<table class="data-table">
      <thead><tr>
        <th>PGR</th><th>Role</th><th>Min</th><th>Duties</th>
        <th>+/−</th><th>Leaves</th><th>Carry Fwd</th>
      </tr></thead><tbody>`;

    pgrs.forEach(pgr => {
      const minDuties = DB.getEffectiveMinDuties(pgr);
      const duties    = DB.countDutiesForPGR(pgr.id, ym);
      const delta     = duties - minDuties;
      const leaves    = DB.getLeavesForPGR(pgr.id).filter(l => l.date.startsWith(ym) && l.status !== 'rejected').length;
      const carry     = DB.getCarryFwdFor(pgr.id, ym);

      const deltaCls = delta > 0 ? 'text-red' : delta < 0 ? 'text-orange' : 'text-green';
      html += `<tr>
        <td>${pgr.name}</td>
        <td><span class="role-badge role-${pgr.role}">${pgr.role.replace('_',' ')}</span></td>
        <td>${minDuties}</td>
        <td>${duties}</td>
        <td class="${deltaCls}">${delta > 0 ? '+' : ''}${delta}</td>
        <td>${leaves}/2</td>
        <td class="${carry > 0 ? 'text-red' : carry < 0 ? 'text-orange' : ''}">${carry > 0 ? '+' : ''}${carry}</td>
      </tr>`;
    });

    html += `</tbody></table>`;
    document.getElementById('monthly-stats-table').innerHTML = html;
  }

  // ── Overwork indicators ────────────────────────────────
  function renderOverworkIndicators() {
    const ym   = RosterEngine.currentYM();
    const pgrs = DB.getPGRs();

    let html = `<div class="overwork-grid">`;
    pgrs.forEach(pgr => {
      const status = ValidationEngine.getOverworkStatus(pgr.id, ym);
      let cls = 'ok';
      let label = 'Normal';
      if (status.overwork)  { cls = 'overwork'; label = 'Overworked'; }
      if (status.underwork) { cls = 'underwork'; label = 'Under-assigned'; }

      html += `<div class="overwork-card ${cls}">
        <div class="ow-name">${pgr.name}</div>
        <div class="ow-stat">${status.duties} duties</div>
        <div class="ow-label">${label}</div>
        ${status.weeklyFlag ? '<div class="ow-flag">⚠ Weekly overwork</div>' : ''}
        ${status.carryFwd !== 0 ? `<div class="ow-carry">Carry: ${status.carryFwd > 0 ? '+' : ''}${status.carryFwd}</div>` : ''}
      </div>`;
    });
    html += `</div>`;

    document.getElementById('overwork-indicators').innerHTML = html;
  }

  return { render };
})();
