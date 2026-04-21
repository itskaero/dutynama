/**
 * preferences.js — Preferred off-day selection (calendar picker)
 */

const Preferences = (() => {

  let _selected = new Set();
  let _dirty    = false;

  function render() {
    const user  = Auth.currentUser();
    const ym    = RosterEngine.currentYM();
    const pref  = DB.getPrefForPGR(user.id);
    _selected   = new Set(pref.offDays.filter(d => d.startsWith(ym)));
    _dirty      = false;
    _renderCalendar(ym);
    _renderBayInfo(pref);
  }

  function _renderBayInfo(pref) {
    const section = document.getElementById('pref-bay-info');
    if (!section) return;
    const units    = DB.getUnits();
    if (!units.length) { section.innerHTML = ''; return; }

    const excluded  = pref.excludedBays   || [];
    const priorities = pref.bayPriorities || [];
    const allowed   = units.filter(u => !excluded.includes(u.id));

    // Build ordered list of allowed bays
    const ordered = [
      ...priorities.filter(id => allowed.some(u => u.id === id)).map(id => units.find(u => u.id === id)),
      ...allowed.filter(u => !priorities.includes(u.id)),
    ].filter(Boolean);

    let html = `<div class="bay-info-panel">
      <h4 style="margin:0 0 .4rem">My Bay Assignments</h4>`;

    if (excluded.length) {
      html += `<p class="muted" style="font-size:.78rem;margin:0 0 .5rem">
        <strong>Cannot be assigned to:</strong>
        ${excluded.map(id => units.find(u => u.id === id)?.name || id).join(', ')}
      </p>`;
    }

    if (ordered.length) {
      html += `<p class="muted" style="font-size:.78rem;margin:0 0 .5rem">
        <strong>Preferred assignment order:</strong></p>
      <div class="bay-priority-list" style="pointer-events:none;opacity:.85">`;
      ordered.forEach((unit, idx) => {
        html += `<div class="bay-prio-row">
          <span class="bay-prio-num">${idx + 1}</span>
          <span class="bay-prio-name">${unit.name}</span>
        </div>`;
      });
      html += `</div>`;
    }

    if (!excluded.length && !priorities.length) {
      html += `<p class="muted" style="font-size:.78rem">No bay preferences set by admin yet.</p>`;
    }

    html += `<p class="muted" style="font-size:.72rem;margin-top:.6rem;opacity:.65">
      Bay preferences are set by the Senior PGR. Contact them to update.</p>
    </div>`;
    section.innerHTML = html;
  }

  function _renderCalendar(ym) {
    const user          = Auth.currentUser();
    const [year, month] = ym.split('-').map(Number);
    const daysInMonth   = new Date(year, month, 0).getDate();
    const today         = new Date().toISOString().slice(0, 10);
    const DAY_NAMES     = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const monthLabel    = new Date(year, month - 1, 1)
      .toLocaleString('default', { month: 'long', year: 'numeric' });

    // My leaves this month (for the Leave column)
    const myLeaves = DB.getLeavesForPGR(user.id)
      .filter(l => l.date.startsWith(ym) && l.status !== 'rejected');

    const selectedCount = _selected.size;
    const saveDisabled  = _dirty ? '' : 'style="opacity:.45;pointer-events:none"';

    let html = `
      <div class="cal-toolbar">
        <span class="cal-month-label">${monthLabel}</span>
        <span class="badge badge-ok">${selectedCount} off-day${selectedCount !== 1 ? 's' : ''} marked</span>
        <button class="btn btn-primary btn-sm" onclick="Preferences.save()" ${saveDisabled}>Save</button>
      </div>
      <div class="roster-matrix-wrap">
        <table class="roster-matrix">
          <thead>
            <tr>
              <th class="rm-hdr rm-date-hdr">Date</th>
              <th class="rm-hdr rm-day-hdr">Day</th>
              <th class="rm-hdr" style="min-width:150px;text-align:left;padding-left:.75rem">Off-Duty Preference</th>
              <th class="rm-hdr" style="min-width:100px;text-align:left;padding-left:.75rem">My Leave</th>
            </tr>
          </thead>
          <tbody>`;

    for (let d = 1; d <= daysInMonth; d++) {
      const date   = `${ym}-${String(d).padStart(2,'0')}`;
      const dow    = new Date(year, month - 1, d).getDay();
      const isWknd = dow === 0 || dow === 6;
      const isTdy  = date === today;
      const isSel  = _selected.has(date);
      const leave  = myLeaves.find(l => l.date === date);
      const lvStatus = leave?.status ?? null;

      const lvChip = lvStatus === 'approved'
        ? `<div class="rm-name rm-name-morning">${lvStatus}</div>`
        : lvStatus === 'pending'
        ? `<div class="rm-name rm-name-evening">${lvStatus}</div>`
        : `<span class="rm-unassigned">—</span>`;

      html += `<tr class="rm-row${isTdy ? ' rm-today' : ''}${isWknd ? ' rm-weekend' : ''}">
        <td class="rm-date-cell${isTdy ? ' rm-today' : ''}">
          <span class="rm-date-num">${d}</span>
        </td>
        <td class="rm-dayname-cell${isWknd ? ' rm-wknd-text' : ''}">${DAY_NAMES[dow]}</td>
        <td class="rm-cell" onclick="Preferences.toggle('${date}')"
            style="cursor:pointer;padding:.3rem .6rem">
          ${isSel
            ? `<div class="rm-name rm-name-morning">Off-Duty</div>`
            : `<span class="rm-unassigned" style="font-size:.74rem;color:var(--text-subtle)">click to mark</span>`}
        </td>
        <td class="rm-cell" style="padding:.3rem .6rem">${lvChip}</td>
      </tr>`;
    }

    html += `</tbody></table></div>`;
    document.getElementById('pref-calendar').innerHTML = html;
  }

  function toggle(date) {
    if (_selected.has(date)) _selected.delete(date);
    else _selected.add(date);
    _dirty = true;
    _renderCalendar(date.slice(0, 7));
  }

  function save() {
    const user = Auth.currentUser();
    const ym   = RosterEngine.currentYM();
    const pref = DB.getPrefForPGR(user.id);

    const otherMonths = pref.offDays.filter(d => !d.startsWith(ym));
    DB.savePrefForPGR(user.id, [...otherMonths, ..._selected]);

    // Check if many PGRs share the same off-duty day — notify Senior PGR
    const allPrefs  = DB.getAllPrefs();
    const totalPGRs = DB.getPGRs().filter(p => p.role !== 'viewer').length;
    const threshold = Math.max(2, Math.floor(totalPGRs * 0.4));

    const flagged = new Set();
    _selected.forEach(date => {
      const othersOff = allPrefs.filter(
        p => p.pgrId !== user.id && (p.offDays || []).includes(date)
      ).length + 1; // +1 for self
      if (othersOff >= threshold && !flagged.has(date)) {
        flagged.add(date);
        DB.addAlert('warn',
          `[Admin] ${othersOff}/${totalPGRs} PGRs prefer off on ${date} — may be hard to roster that day.`);
      }
    });

    if (flagged.size) UI.refreshAlerts?.();

    _dirty = false;
    _renderCalendar(ym);
  }

  return { render, toggle, save };
})();
