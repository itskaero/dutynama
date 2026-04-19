/**
 * rosterEngine.js — Roster calendar rendering, assignment, auto-generation, export
 */

const RosterEngine = (() => {

  let _year  = new Date().getFullYear();
  let _month = new Date().getMonth() + 1; // 1-based

  function currentYM() {
    return `${_year}-${String(_month).padStart(2,'0')}`;
  }

  function prevMonth() {
    _month--;
    if (_month < 1) { _month = 12; _year--; }
    render();
  }

  function nextMonth() {
    _month++;
    if (_month > 12) { _month = 1; _year++; }
    render();
  }

  // ── Main render ──────────────────────────────────────────
  function render() {
    const ym    = currentYM();
    const label = new Date(_year, _month - 1, 1)
      .toLocaleString('default', { month: 'long', year: 'numeric' });
    document.getElementById('roster-month-label').textContent    = label;
    document.getElementById('current-month-label').textContent   = label;

    const daysInMonth = new Date(_year, _month, 0).getDate();
    const firstDay    = new Date(_year, _month - 1, 1).getDay(); // 0=Sun

    const units  = DB.getUnits();
    const shifts = DB.getShifts();
    const pgrs   = DB.getPGRs();
    const roster = DB.getRosterForMonth(ym);
    const leaves = DB.getLeavesForMonth(ym);
    const canEdit = Auth.can('editRoster');

    // Build calendar grid
    let html = `<div class="cal-header">`;
    ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].forEach(d =>
      html += `<div class="cal-head-cell">${d}</div>`
    );
    html += `</div><div class="cal-grid">`;

    // Empty cells before month starts
    for (let i = 0; i < firstDay; i++) {
      html += `<div class="cal-cell empty"></div>`;
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const date      = `${ym}-${String(d).padStart(2,'0')}`;
      const isToday   = date === todayStr();
      const dayLeaves = leaves.filter(l => l.date === date);
      const dayRoster = roster.filter(r => r.date === date);
      const isWeekend = [0, 6].includes(new Date(_year, _month - 1, d).getDay());

      html += `<div class="cal-cell ${isToday ? 'today' : ''} ${isWeekend ? 'weekend' : ''}"
        onclick="RosterEngine.openDay('${date}')">
        <div class="cal-day-num">${d}</div>`;

      // Leave pills
      dayLeaves.forEach(l => {
        const pgr = pgrs.find(p => p.id === l.pgrId);
        html += `<div class="pill leave" title="${pgr?.name} — Leave (${l.status})">
          L: ${pgr?.name?.split(' ')[0] || '?'}
        </div>`;
      });

      // Shift summaries (one row per shift)
      shifts.forEach(sh => {
        const shiftEntries = dayRoster.filter(r => r.shift === sh.id);
        if (!shiftEntries.length) return;

        // Unique PGRs in this shift
        const uniquePGRs = [...new Set(shiftEntries.map(r => r.pgrId))];
        uniquePGRs.forEach(pgrId => {
          const pgr   = pgrs.find(p => p.id === pgrId);
          const bays  = shiftEntries.filter(r => r.pgrId === pgrId).map(r => r.unitId);
          const hasReplace = shiftEntries.some(r => r.pgrId === pgrId && r.replaced);
          const shiftClass = sh.id.toLowerCase();
          html += `<div class="pill ${shiftClass} ${hasReplace ? 'replaced' : ''}"
            title="${sh.label}: ${pgr?.name} — ${bays.join(', ')}">
            ${sh.id[0]}: ${pgr?.name?.split(' ')[0] || '?'}${bays.length > 1 ? ` (${bays.length})` : ''}
            ${hasReplace ? '<span class="r-tag">R</span>' : ''}
          </div>`;
        });
      });

      html += `</div>`; // cal-cell
    }

    html += `</div>`; // cal-grid
    document.getElementById('roster-calendar').innerHTML = html;

    // Show/hide edit controls
    const autoBtn   = document.getElementById('btn-auto-roster');
    if (autoBtn) autoBtn.style.display = canEdit ? '' : 'none';
  }

  // ── Day detail modal ──────────────────────────────────────
  function openDay(date) {
    const units   = DB.getUnits();
    const shifts  = DB.getShifts();
    const pgrs    = DB.getPGRs();
    const roster  = DB.getRosterForDate(date);
    const leaves  = DB.getLeaves().filter(l => l.date === date);
    const canEdit = Auth.can('editRoster');
    const canReplace = Auth.can('manageReplace');

    const d       = new Date(date + 'T00:00:00');
    const label   = d.toLocaleDateString('default', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
    document.getElementById('day-modal-title').textContent = label;

    let html = '';

    // Leave summary
    if (leaves.length) {
      html += `<div class="modal-section"><h4>Leaves</h4>`;
      leaves.forEach(l => {
        const pgr = pgrs.find(p => p.id === l.pgrId);
        html += `<div class="leave-chip ${l.status}">${pgr?.name} — ${l.status}</div>`;
      });
      html += `</div>`;
    }

    // Shift assignments table
    html += `<div class="modal-section"><h4>Assignments</h4>`;
    html += `<table class="data-table shift-table">
      <thead><tr><th>Shift</th><th>Unit</th><th>PGR</th><th>Status</th>${canEdit ? '<th>Edit</th>' : ''}${canReplace ? '<th>Replace</th>' : ''}</tr></thead>
      <tbody>`;

    shifts.forEach(sh => {
      units.forEach(unit => {
        const entries = roster.filter(r => r.shift === sh.id && r.unitId === unit.id);
        if (entries.length) {
          entries.forEach(entry => {
            const pgr = pgrs.find(p => p.id === entry.pgrId);
            html += `<tr class="${entry.replaced ? 'row-replaced' : ''}">
              <td><span class="legend-chip ${sh.id.toLowerCase()}">${sh.id[0]}</span> ${sh.label}</td>
              <td>${unit.name}</td>
              <td>${pgr?.name || entry.pgrId}
                ${DB.isOnLeave(entry.pgrId, date) ? '<span class="badge badge-err">ON LEAVE!</span>' : ''}
              </td>
              <td>${entry.replaced
                ? `<span class="badge badge-warn">Replaced by ${pgrs.find(p=>p.id===entry.replacedBy)?.name || entry.replacedBy}</span>`
                : '<span class="badge badge-ok">Active</span>'}</td>
              ${canEdit
                ? `<td><button class="btn btn-xs btn-danger"
                    onclick="RosterEngine.removeAssignment('${entry.id}','${date}')">Remove</button></td>`
                : ''}
              ${canReplace && !entry.replaced
                ? `<td><button class="btn btn-xs btn-secondary"
                    onclick="RosterEngine.openReplaceDialog('${entry.id}')">Mark Replace</button></td>`
                : canReplace ? '<td></td>' : ''}
            </tr>`;
          });
        } else {
          html += `<tr class="row-empty">
            <td><span class="legend-chip ${sh.id.toLowerCase()}">${sh.id[0]}</span> ${sh.label}</td>
            <td>${unit.name}</td>
            <td colspan="${2 + (canEdit?1:0) + (canReplace?1:0)}">
              ${canEdit
                ? `<div class="inline-assign">
                    <select id="assign-pgr-${sh.id}-${unit.id}" class="select-sm">
                      <option value="">— assign PGR —</option>
                      ${pgrs.map(p => `<option value="${p.id}">${p.name}</option>`).join('')}
                    </select>
                    <button class="btn btn-xs btn-primary"
                      onclick="RosterEngine.assignPGR('${date}','${sh.id}','${unit.id}')">Assign</button>
                  </div>`
                : '<span class="muted">Unassigned</span>'}
            </td>
          </tr>`;
        }
      });
    });

    html += `</tbody></table></div>`;

    // Replacement dialog placeholder
    html += `<div id="replace-dialog"></div>`;

    document.getElementById('day-modal-body').innerHTML = html;
    document.getElementById('day-modal').classList.remove('hidden');
    document.getElementById('overlay').classList.remove('hidden');
  }

  function assignPGR(date, shift, unitId) {
    const selectId = `assign-pgr-${shift}-${unitId}`;
    const pgrId    = document.getElementById(selectId)?.value;
    if (!pgrId) { alert('Select a PGR first.'); return; }

    const issues = ValidationEngine.checkAssignment(pgrId, date, shift, unitId);
    if (issues.length) {
      const msgs = issues.map(i => `[${i.severity.toUpperCase()}] ${i.message}`).join('\n');
      const ok   = confirm(msgs + '\n\nProceed with assignment?');
      if (!ok) return;
      issues.forEach(i => DB.addAlert(i.severity, i.message));
      UI.refreshAlerts();
    }

    DB.assignShift({ date, shift, unitId, pgrId });
    openDay(date);      // re-render modal
    render();           // re-render calendar
  }

  function removeAssignment(entryId, date) {
    if (!confirm('Remove this assignment?')) return;
    DB.deleteRosterEntry(entryId);
    openDay(date);
    render();
  }

  function openReplaceDialog(entryId) {
    const pgrs = DB.getPGRs();
    const html = `<div class="card" style="margin-top:1rem">
      <h4>Mark as Replaced</h4>
      <label>Replaced by</label>
      <select id="replace-by-select">
        <option value="">— select doctor —</option>
        ${pgrs.map(p => `<option value="${p.id}">${p.name}</option>`).join('')}
      </select>
      <label>Note</label>
      <input type="text" id="replace-note-input" placeholder="Optional note..." />
      <button class="btn btn-primary btn-sm" onclick="RosterEngine.saveReplace('${entryId}')">Confirm</button>
      <button class="btn btn-ghost btn-sm" onclick="document.getElementById('replace-dialog').innerHTML=''">Cancel</button>
    </div>`;
    document.getElementById('replace-dialog').innerHTML = html;
  }

  function saveReplace(entryId) {
    const replacedBy   = document.getElementById('replace-by-select').value;
    const replacedNote = document.getElementById('replace-note-input').value;
    if (!replacedBy) { alert('Select a replacement doctor.'); return; }

    const roster  = DB.getRoster();
    const entry   = roster.find(r => r.id === entryId);
    if (!entry) return;
    entry.replaced     = true;
    entry.replacedBy   = replacedBy;
    entry.replacedNote = replacedNote;
    DB.saveRoster(roster);
    DB.addAlert('info', `Duty on ${entry.date} (${entry.shift}/${entry.unitId}) replaced by ${DB.getPGR(replacedBy)?.name}.`);
    UI.refreshAlerts();

    // Re-open day modal to reflect change
    openDay(entry.date);
    render();
  }

  // ── Auto-generate roster ───────────────────────────────
  function autoGenerate() {
    const ym = currentYM();
    const existing = DB.getRosterForMonth(ym);
    if (existing.length > 0) {
      if (!confirm(`Roster for ${ym} already has ${existing.length} entries.\nAuto-generate will ADD to existing entries (won't duplicate). Continue?`)) return;
    }

    const [year, month] = ym.split('-').map(Number);
    const daysInMonth   = new Date(year, month, 0).getDate();
    const pgrs   = DB.getPGRs().filter(p => ['pgr','senior_pgr'].includes(p.role));
    const units  = DB.getUnits();
    const shifts = DB.getShifts();

    if (!pgrs.length)  { alert('No PGRs available.'); return; }
    if (!units.length) { alert('No units configured.'); return; }

    let assignmentCount = 0;

    // Simple round-robin: for each day/shift/unit, pick the PGR with fewest duties this month
    for (let d = 1; d <= daysInMonth; d++) {
      const date = `${ym}-${String(d).padStart(2,'0')}`;
      for (const shift of shifts) {
        for (const unit of units) {
          // Already assigned?
          const already = DB.getRosterForDate(date).find(
            r => r.shift === shift.id && r.unitId === unit.id
          );
          if (already) continue;

          // Find eligible PGR (not on leave, sorted by duty count)
          const eligible = pgrs
            .filter(p => !DB.isOnLeave(p.id, date))
            .sort((a, b) => {
              const aCount = DB.countDutiesForPGR(a.id, ym);
              const bCount = DB.countDutiesForPGR(b.id, ym);
              return aCount - bCount;
            });

          if (!eligible.length) {
            DB.addAlert('error', `No eligible PGR for ${unit.name}/${shift.label} on ${date}`);
            continue;
          }

          const chosen = eligible[0];
          DB.assignShift({ date, shift: shift.id, unitId: unit.id, pgrId: chosen.id });
          assignmentCount++;
        }
      }
    }

    // Validate and raise alerts
    ValidationEngine.validateMonth(ym);
    UI.refreshAlerts();
    render();
    alert(`Auto-generation complete: ${assignmentCount} assignments created.\nCheck alerts for any issues.`);
  }

  // ── Export CSV ─────────────────────────────────────────
  function exportCSV() {
    const ym     = currentYM();
    const roster = DB.getRosterForMonth(ym);
    const pgrs   = DB.getPGRs();
    const units  = DB.getUnits();
    const shifts = DB.getShifts();

    const rows = [['Date','Shift','Unit','PGR','Replaced','Replaced By','Note']];
    roster.forEach(r => {
      const pgr  = pgrs.find(p => p.id === r.pgrId);
      const repBy = r.replacedBy ? pgrs.find(p => p.id === r.replacedBy)?.name : '';
      rows.push([r.date, r.shift, r.unitId, pgr?.name || '', r.replaced ? 'Yes' : 'No', repBy, r.replacedNote || '']);
    });

    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a    = document.createElement('a');
    a.href     = URL.createObjectURL(blob);
    a.download = `roster_${ym}.csv`;
    a.click();
  }

  function todayStr() {
    return new Date().toISOString().slice(0, 10);
  }

  return {
    render, currentYM, prevMonth, nextMonth,
    openDay, assignPGR, removeAssignment,
    openReplaceDialog, saveReplace,
    autoGenerate, exportCSV,
  };
})();
