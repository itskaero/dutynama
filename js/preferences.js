/**
 * preferences.js — Preferred off-day selection (calendar picker) + weekend duty quotas
 */

const Preferences = (() => {

  let _selected    = new Set();
  let _dirty       = false;
  let _wkndQuota   = { satDay: 0, satNight: 0, sunDay: 0, sunNight: 0 };

  function render() {
    const user  = Auth.currentUser();
    const ym    = RosterEngine.currentYM();
    const pref  = DB.getPrefForPGR(user.id);
    _selected   = new Set((pref.offDays || []).filter(d => d?.startsWith(ym)));
    _dirty      = false;
    // Render calendar and bay info first so a quota crash can't blank the whole tab
    try { _renderCalendar(ym);    } catch (e) { console.error('[Prefs] _renderCalendar failed:', e); }
    try { _renderBayInfo(pref);   } catch (e) { console.error('[Prefs] _renderBayInfo failed:', e); }
    // Load quota after calendar is visible; fall back to zeros on any error
    try {
      _wkndQuota = DB.getWeekendQuotasForPGR(user.id);
    } catch (e) {
      console.error('[Prefs] getWeekendQuotasForPGR failed:', e);
      _wkndQuota = { satDay: 0, satNight: 0, sunDay: 0, sunNight: 0 };
    }
    try { _renderWeekendQuota(ym); } catch (e) { console.error('[Prefs] _renderWeekendQuota failed:', e); }
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
      .filter(l => l.date?.startsWith(ym) && l.status !== 'rejected');

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

      const holidayName = RosterEngine.getHolidayName(date);
      html += `<tr class="rm-row${isTdy ? ' rm-today' : ''}${isWknd ? ' rm-weekend' : ''}${holidayName ? ' rm-holiday' : ''}">
        <td class="rm-date-cell${isTdy ? ' rm-today' : ''}${holidayName ? ' rm-holiday-date' : ''}">
          <span class="rm-date-num">${d}</span>${holidayName ? '<span class="rm-holiday-dot"></span>' : ''}
        </td>
        <td class="rm-dayname-cell${isWknd ? ' rm-wknd-text' : ''}" title="${holidayName || ''}">${DAY_NAMES[dow]}${holidayName ? `<span class="rm-holiday-tag">${holidayName}</span>` : ''}</td>
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

    const otherMonths = (pref.offDays || []).filter(d => d && !d.startsWith(ym));
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

  // ── Weekend duty quota section (read-only for PGRs) ──────────────────
  function _renderWeekendQuota(ym) {
    const el = document.getElementById('pref-weekend-quota');
    if (!el) return;

    const shifts    = DB.getShifts();
    const yr        = parseInt(ym.slice(0, 4));
    const mo        = parseInt(ym.slice(5, 7));
    const daysInM   = new Date(yr, mo, 0).getDate();
    const roster    = DB.getRosterForMonth(ym);
    const user      = Auth.currentUser();
    const nightIds  = new Set(shifts.filter(s =>
      s.id === 'Night' || s.label.toLowerCase().includes('night') || (s.hours || 0) >= 10
    ).map(s => s.id));

    // Count how many weekend slots this PGR already has this month
    const done = { satDay: 0, satNight: 0, sunDay: 0, sunNight: 0 };
    roster.filter(r => r.pgrId === user.id).forEach(r => {
      const dow   = new Date(yr, mo - 1, parseInt(r.date.slice(8))).getDay();
      const isSat = dow === 6;
      const isSun = dow === 0;
      if (!isSat && !isSun) return;
      const isNt = nightIds.has(r.shift);
      if (isSat) done[isNt ? 'satNight' : 'satDay']++;
      else       done[isNt ? 'sunNight' : 'sunDay']++;
    });

    let satCount = 0, sunCount = 0;
    for (let d = 1; d <= daysInM; d++) {
      const dow = new Date(yr, mo - 1, d).getDay();
      if (dow === 6) satCount++;
      if (dow === 0) sunCount++;
    }

    const pref           = DB.getPrefForPGR(user.id);
    const hasOverride    = pref.weekendQuotas != null;
    const effectiveQ     = _wkndQuota; // already loaded in render() via getWeekendQuotasForPGR
    const dayLabel       = shifts.filter(s => !nightIds.has(s.id)).map(s => s.label).join(' / ') || 'Day';
    const nightLabel     = shifts.filter(s =>  nightIds.has(s.id)).map(s => s.label).join(' / ') || 'Night';
    const monthLabel     = new Date(yr, mo - 1, 1)
      .toLocaleString('default', { month: 'long', year: 'numeric' });

    const totalTarget = Object.values(effectiveQ).reduce((a, b) => a + b, 0);
    if (totalTarget === 0) {
      el.innerHTML = `<div class="wq-section"><p class="muted" style="font-size:.8rem;margin:.5rem 0">
        No weekend duty targets have been configured by your admin yet.</p></div>`;
      return;
    }

    function row(label, quota, current, available) {
      const pct  = quota > 0 ? Math.min(100, Math.round((current / quota) * 100)) : 0;
      const met  = quota > 0 && current >= quota;
      const fill = quota > 0 ? `style="width:${pct}%"` : 'style="width:0"';
      const cls  = met ? 'wq-status-met' : quota > 0 ? 'wq-status-pending' : 'wq-status-none';
      return `
        <div class="wq-row">
          <div class="wq-row-label">
            <span class="wq-label-text">${label}</span>
            <span class="wq-avail">${available} ${available === 1 ? 'day' : 'days'} this month</span>
          </div>
          <div class="wq-row-controls" style="opacity:.75;pointer-events:none">
            <input type="number" class="input wq-input" value="${quota}" disabled>
            <span class="wq-unit">/ month</span>
          </div>
          <span class="wq-status ${cls}">${current}/${quota} done</span>
        </div>
        <div class="wknd-quota-progress-bar" style="margin:.15rem 0 .3rem">
          <div class="wknd-quota-progress-fill${met ? ' met' : ''}" ${fill}></div>
        </div>`;
    }

    const sourceBadge = hasOverride
      ? `<span class="badge badge-warn" style="font-size:.68rem">Custom targets set by admin</span>`
      : `<span class="badge badge-ok"   style="font-size:.68rem">Team default targets</span>`;

    el.innerHTML = `
      <div class="wq-section">
        <div class="wq-header">
          <div style="display:flex;align-items:center;gap:.4rem;flex-wrap:wrap">
            <h4 class="wq-title" style="margin:0">Weekend Duty Targets</h4>
            ${sourceBadge}
          </div>
          <p class="wq-subtitle muted" style="margin-top:.3rem">
            Your mandatory weekend duty minimums for ${monthLabel},
            set by your admin. Auto-generation prioritises these slots for you first.
          </p>
        </div>
        <div class="wq-grid">
          <div class="wq-col-header">Saturday</div>
          <div class="wq-col-header">Sunday</div>
          ${effectiveQ.satDay   > 0 ? row(dayLabel,   effectiveQ.satDay,   done.satDay,   satCount) : ''}
          ${effectiveQ.sunDay   > 0 ? row(dayLabel,   effectiveQ.sunDay,   done.sunDay,   sunCount) : ''}
          ${effectiveQ.satNight > 0 ? row(nightLabel, effectiveQ.satNight, done.satNight, satCount) : ''}
          ${effectiveQ.sunNight > 0 ? row(nightLabel, effectiveQ.sunNight, done.sunNight, sunCount) : ''}
        </div>
      </div>`;
  }

  function onWkndChange() {} // no-op: quotas managed by admin

  return { render, toggle, save, onWkndChange };
