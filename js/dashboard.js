/**
 * dashboard.js — Today's status, monthly stats, overwork indicators
 */

const Dashboard = (() => {

  function render() {
    renderTodayCards();
    renderDutyChart();
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

  // ── Duty chart (Chart.js bar) ──────────────────────────
  function renderDutyChart() {
    const canvas = document.getElementById('duties-chart');
    if (!canvas || typeof Chart === 'undefined') return;

    // Always use real current month, not roster navigation
    const ym   = todayStr().slice(0, 7);
    const pgrs = DB.getPGRs()
      .filter(p => ['pgr', 'senior_pgr'].includes(p.role))
      .sort((a, b) => (a.year || 99) - (b.year || 99) || a.name.localeCompare(b.name));

    const labels  = pgrs.map(p => p.year ? `${p.name.split(' ')[0]} Y${p.year}` : p.name.split(' ')[0]);
    const duties  = pgrs.map(p => DB.countDutiesForPGR(p.id, ym));
    const targets = pgrs.map(p => DB.getEffectiveMinDuties(p));

    // Per-bar colour: green = at/over target, amber = within 2, red = under
    const barColors = pgrs.map((p, i) => {
      const d = duties[i], t = targets[i];
      if (d >= t)       return 'rgba(63,185,80,0.65)';
      if (d >= t - 2)   return 'rgba(245,158,11,0.65)';
      return 'rgba(248,113,113,0.65)';
    });
    const borderColors = pgrs.map((p, i) => {
      const d = duties[i], t = targets[i];
      if (d >= t)     return '#3fb950';
      if (d >= t - 2) return '#f59e0b';
      return '#f87171';
    });

    if (canvas._chartInstance) canvas._chartInstance.destroy();
    canvas._chartInstance = new Chart(canvas, {
      data: {
        labels,
        datasets: [
          {
            type: 'bar',
            label: 'Duties done',
            data: duties,
            backgroundColor: barColors,
            borderColor: borderColors,
            borderWidth: 1,
            borderRadius: 4,
            order: 2,
          },
          {
            type: 'line',
            label: 'Target',
            data: targets,
            borderColor: 'rgba(139,92,246,0.7)',
            backgroundColor: 'transparent',
            borderWidth: 1.5,
            borderDash: [4, 3],
            pointRadius: 3,
            pointBackgroundColor: 'rgba(139,92,246,0.9)',
            tension: 0,
            order: 1,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            display: true,
            labels: { color: '#8b949e', font: { size: 11 }, boxWidth: 14 },
          },
          tooltip: {
            callbacks: {
              label: ctx => ctx.dataset.type === 'line'
                ? ` Target: ${ctx.parsed.y}`
                : ` Duties: ${ctx.parsed.y}`,
              afterLabel: (ctx) => {
                if (ctx.dataset.type !== 'bar') return '';
                const diff = duties[ctx.dataIndex] - targets[ctx.dataIndex];
                return diff === 0 ? ' ✓ On target'
                     : diff > 0  ? ` +${diff} over target`
                     : ` ${diff} below target`;
              },
            },
          },
        },
        scales: {
          x: {
            grid: { color: 'rgba(48,54,61,0.6)' },
            ticks: { color: '#8b949e', font: { size: 10 } },
          },
          y: {
            grid: { color: 'rgba(48,54,61,0.6)' },
            ticks: { color: '#8b949e', font: { size: 11 }, stepSize: 1 },
            beginAtZero: true,
          },
        },
      },
    });
  }

  return { render };
})();
