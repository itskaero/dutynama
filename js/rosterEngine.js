/**
 * rosterEngine.js — Roster calendar rendering, assignment, auto-generation, export
 */

const RosterEngine = (() => {

  let _year  = new Date().getFullYear();
  let _month = new Date().getMonth() + 1; // 1-based
  let _swapSelection = null; // { entryId, el }

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

  // ── Main render — Day × Unit Matrix ─────────────────────
  function render() {
    const ym    = currentYM();
    const label = new Date(_year, _month - 1, 1)
      .toLocaleString('default', { month: 'long', year: 'numeric' });
    document.getElementById('roster-month-label').textContent  = label;
    document.getElementById('current-month-label').textContent = label;

    const daysInMonth = new Date(_year, _month, 0).getDate();
    const units       = DB.getUnits();
    const shifts      = DB.getShifts();
    const pgrs        = DB.getPGRs();
    const roster      = DB.getRosterForMonth(ym);
    const leaves      = DB.getLeavesForMonth(ym);
    const today       = todayStr();
    const canEdit     = Auth.can('editRoster');
    const cfg         = DB.getConfig();
    const maxBays     = cfg.maxBaysPerPGR || 2;

    // Pre-compute: how many bays each PGR covers per shift per day
    const bayMap = {};
    roster.forEach(r => {
      const k = `${r.pgrId}|${r.date}|${r.shift}`;
      bayMap[k] = (bayMap[k] || 0) + 1;
    });

    // Pre-compute: unique duty-shift count per PGR for the month
    const dutyCountMap = {};
    roster.forEach(r => {
      if (!dutyCountMap[r.pgrId]) dutyCountMap[r.pgrId] = new Set();
      dutyCountMap[r.pgrId].add(`${r.date}|${r.shift}`);
    });

    // Pre-compute: back-to-back 24h situations
    // Case 1 — Night (day D) + any shift (day D+1): no overnight rest
    // Case 2 — Night + any other shift on the SAME day (≥18h straight)
    const _shiftsByPD = {};
    roster.forEach(r => {
      const k = `${r.pgrId}|${r.date}`;
      if (!_shiftsByPD[k]) _shiftsByPD[k] = new Set();
      _shiftsByPD[k].add(r.shift);
    });
    const backTo24Set = new Set();
    roster.forEach(r => {
      if (r.shift === 'Night') {
        // Case 1: next calendar day
        const dt      = new Date(r.date + 'T00:00:00');
        dt.setDate(dt.getDate() + 1);
        const nextStr = dt.toISOString().slice(0, 10);
        const nextSh  = _shiftsByPD[`${r.pgrId}|${nextStr}`];
        if (nextSh && nextSh.size) {
          backTo24Set.add(`${r.pgrId}|${r.date}|Night`);
          nextSh.forEach(s => backTo24Set.add(`${r.pgrId}|${nextStr}|${s}`));
        }
        // Case 2: same day has other shifts too
        const sameSh = _shiftsByPD[`${r.pgrId}|${r.date}`];
        if (sameSh && sameSh.size >= 2) {
          sameSh.forEach(s => backTo24Set.add(`${r.pgrId}|${r.date}|${s}`));
        }
      }
    });

    const DAY_NAMES  = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const SHIFT_CLS  = { M:'morning', E:'evening', N:'night', D:'day' };

    // ── Two-row grouped header ───────────────────────────
    let html = `<div class="roster-matrix-wrap"><table class="roster-matrix"><thead>`;

    // Header row 1: Date | Day | [Shift name spanning units...] per shift
    html += `<tr>
      <th class="rm-hdr rm-date-hdr" rowspan="2">Date</th>
      <th class="rm-hdr rm-day-hdr"  rowspan="2">Day</th>`;
    shifts.forEach(sh => {
      const cls = SHIFT_CLS[sh.id] || sh.id.toLowerCase();
      html += `<th class="rm-hdr rm-shift-group rm-sg-${cls}" colspan="${units.length}">${sh.label}</th>`;
    });
    html += `</tr>`;

    // Header row 2: unit sub-headers per shift
    html += `<tr>`;
    shifts.forEach(sh => {
      const cls = SHIFT_CLS[sh.id] || sh.id.toLowerCase();
      units.forEach(u => {
        html += `<th class="rm-hdr rm-unit-hdr rm-uh-${cls}">${u.name}</th>`;
      });
    });
    html += `</tr></thead><tbody>`;

    // ── One row per day ──────────────────────────────────
    for (let d = 1; d <= daysInMonth; d++) {
      const date    = `${ym}-${String(d).padStart(2,'0')}`;
      const isToday = date === today;
      const dow     = new Date(_year, _month - 1, d).getDay();
      const isWknd  = dow === 0 || dow === 6;
      const isSat   = dow === 6;
      const dayLeaves = leaves.filter(l => l.date === date && l.status !== 'rejected');

      html += `<tr class="rm-row${isToday ? ' rm-today' : ''}${isWknd ? ' rm-weekend' : ''}">
        <td class="rm-date-cell${isToday ? ' rm-today' : ''}" onclick="RosterEngine.openDay('${date}')">
          <span class="rm-date-num">${d}</span>
        </td>
        <td class="rm-dayname-cell${isWknd ? ' rm-wknd-text' : ''}" onclick="RosterEngine.openDay('${date}')">
          ${DAY_NAMES[dow]}
        </td>`;

      shifts.forEach(sh => {
        const cls = SHIFT_CLS[sh.id] || sh.id.toLowerCase();
        units.forEach(u => {
          const entries = roster.filter(r =>
            r.date === date && r.shift === sh.id && r.unitId === u.id
          );

          let cellContent = '';
          if (entries.length) {
            entries.forEach(e => {
              const pgr        = pgrs.find(p => p.id === e.pgrId);
              const name       = pgr ? pgr.name : e.pgrId;
              const onLeave    = dayLeaves.some(l => l.pgrId === e.pgrId);
              const replaced   = e.replaced;
              const bays       = bayMap[`${e.pgrId}|${date}|${sh.id}`] || 0;
              const isOverBay  = !onLeave && !replaced && bays > maxBays;
              const monthDuties = dutyCountMap[e.pgrId]?.size || 0;
              const minDuties   = DB.getEffectiveMinDuties(pgr || {});
              const isOverDuty  = !onLeave && !replaced && monthDuties > minDuties;
              const is24h       = !onLeave && !replaced && backTo24Set.has(`${e.pgrId}|${date}|${sh.id}`);
              const alertCls   = is24h && isOverBay && isOverDuty ? ' rm-alert-24h-both'
                               : is24h && isOverBay  ? ' rm-alert-24h-bay'
                               : is24h && isOverDuty ? ' rm-alert-24h-duty'
                               : is24h               ? ' rm-alert-24h'
                               : isOverBay && isOverDuty ? ' rm-alert-both'
                               : isOverBay               ? ' rm-alert-bay'
                               : isOverDuty              ? ' rm-alert-duty' : '';
              const alertTip   = is24h && isOverBay && isOverDuty
                ? ` ⚠ Back-to-back 24h + ${bays} bays + over-assigned (${monthDuties}/${minDuties} duties)`
                : is24h && isOverBay
                ? ` \u26a0 Back-to-back 24h + ${bays} bays this shift`
                : is24h && isOverDuty
                ? ` \u26a0 Back-to-back 24h + over-assigned (${monthDuties}/${minDuties} duties)`
                : is24h
                ? ` \u26a0 Back-to-back duty \u2014 no overnight rest`
                : isOverBay && isOverDuty
                ? ` \u26a0 ${bays} bays + over-assigned (${monthDuties}/${minDuties} duties)`
                : isOverBay  ? ` \u26a0 ${bays} bays this shift (max ${maxBays})`
                : isOverDuty ? ` \u26a0 Over-assigned: ${monthDuties}/${minDuties} duties` : '';
              const swappable  = canEdit && !onLeave && !replaced;
              const swapAttrs  = swappable
                ? `data-eid="${e.id}" onclick="event.stopPropagation();RosterEngine.selectForSwap('${e.id}',this)"`
                : '';
              const delBtn = canEdit
                ? `<button class="rm-del-btn" onclick="event.stopPropagation();RosterEngine.removeAssignment('${e.id}','${date}')" title="Remove">✕</button>`
                : '';
              cellContent += `<div class="rm-name rm-name-${cls}${replaced ? ' rm-replaced' : ''}${onLeave ? ' rm-leave-warn' : alertCls}${swappable ? ' rm-swappable' : ''}${canEdit ? ' rm-has-del' : ''}"
                ${swapAttrs}
                title="${name}${replaced ? ' (replaced)' : ''}${onLeave ? ' \u26a0 On Leave!' : alertTip}"><span class="rm-chip-name">${name}</span>${delBtn}</div>`;
            });
          } else {
            cellContent = `<span class="rm-unassigned">\u2014</span>`;
          }

          html += `<td class="rm-cell rm-cell-${cls}${isToday ? ' rm-today' : ''}"
            onclick="RosterEngine.openDay('${date}')">${cellContent}</td>`;
        });
      });

      html += `</tr>`;
    }

    html += `</tbody></table></div>`;
    document.getElementById('roster-calendar').innerHTML = html;

    const autoBtn  = document.getElementById('btn-auto-roster');
    const clearBtn = document.getElementById('btn-clear-roster');
    if (autoBtn)  autoBtn.style.display  = canEdit ? '' : 'none';
    if (clearBtn) clearBtn.style.display = canEdit ? '' : 'none';

    // Cancel any pending swap when roster re-renders
    _swapSelection = null;
    const swapBar = document.getElementById('swap-status');
    if (swapBar) swapBar.classList.add('hidden');
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

  // ── Clear roster for month ─────────────────────────────
  function clearRoster() {
    if (!Auth.can('editRoster')) return;
    const ym    = currentYM();
    const count = DB.getRosterForMonth(ym).length;
    if (!count) { alert('No assignments to clear this month.'); return; }
    if (!confirm(`Clear all ${count} assignments for ${ym}?\nThis cannot be undone.`)) return;
    cancelSwap();
    DB.clearRosterForMonth(ym).then(() => render());
  }

  // ── Swap two slots ─────────────────────────────────────
  function selectForSwap(entryId, el) {
    if (!Auth.can('editRoster')) return;

    if (_swapSelection) {
      // Click the same chip — deselect
      if (_swapSelection.entryId === entryId) {
        cancelSwap();
        return;
      }

      // Second chip selected — execute swap
      const prevEl = _swapSelection.el;
      const prevId = _swapSelection.entryId;
      cancelSwap();

      const rA   = DB.getRoster().find(r => r.id === prevId);
      const rB   = DB.getRoster().find(r => r.id === entryId);
      if (!rA || !rB) return;
      const nameA = DB.getPGR(rA.pgrId)?.name || rA.pgrId;
      const nameB = DB.getPGR(rB.pgrId)?.name || rB.pgrId;

      if (!confirm(`Swap assignments?\n\n${nameA}  (${rA.date} · ${rA.shift} · ${rA.unitId})\n↕\n${nameB}  (${rB.date} · ${rB.shift} · ${rB.unitId})`)) return;

      DB.swapRosterEntries(prevId, entryId); // mutates C.roster synchronously before first await
      render(); // optimistic re-render — warnings recompute immediately
    } else {
      // First chip selected
      _swapSelection = { entryId, el };
      el.classList.add('rm-swap-selected');
      const bar = document.getElementById('swap-status');
      if (bar) {
        bar.textContent = '⇄ Swap mode: click a second slot to swap with, or click the same slot to cancel.';
        bar.classList.remove('hidden');
      }
    }
  }

  function cancelSwap() {
    if (_swapSelection) {
      _swapSelection.el.classList.remove('rm-swap-selected');
      _swapSelection = null;
    }
    const bar = document.getElementById('swap-status');
    if (bar) bar.classList.add('hidden');
  }

  // Called by DB onSnapshot listener to keep calendar in sync
  function refreshIfActive() {
    const page = document.getElementById('page-roster');
    if (page && !page.classList.contains('hidden')) render();
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
    clearRoster, selectForSwap, cancelSwap,
    refreshIfActive,
  };
})();
