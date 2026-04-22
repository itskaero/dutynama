/**
 * rosterEngine.js — Roster calendar rendering, assignment, auto-generation, export
 */

const RosterEngine = (() => {

  let _year  = new Date().getFullYear();
  let _month = new Date().getMonth() + 1; // 1-based
  let _swapSelection  = null;   // { entryId, el }
  let _selectedPGRId  = null;   // pgrId currently shown in detail panel
  let _rosterBayMap   = {};     // `pgrId|date|shift` -> bay count (from latest render)
  let _rosterB2BSet   = new Set(); // `pgrId|date|shift` keys flagged back-to-back
  let _rosterMaxBays  = 2;
  let _panelStates    = { pgr: true, violations: true }; // true = expanded

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

  // ── Pakistan Public Holidays ──────────────────────────
  // Fixed-date national + Islamic holidays.
  // Islamic dates shift ~11 days/year; Gregorian approximations listed per year.
  const PK_HOLIDAYS = {
    // ── Fixed national holidays ──────────────────────────
    '2025-02-05': 'Kashmir Solidarity Day',
    '2025-03-23': 'Pakistan Day',
    '2025-05-01': 'Labour Day',
    '2025-08-14': 'Independence Day',
    '2025-09-06': 'Defence Day',
    '2025-09-11': 'Death Anniversary of Quaid-e-Azam',
    '2025-11-09': 'Iqbal Day',
    '2025-12-25': 'Birthday of Quaid-e-Azam / Christmas',
    '2026-02-05': 'Kashmir Solidarity Day',
    '2026-03-23': 'Pakistan Day',
    '2026-05-01': 'Labour Day',
    '2026-08-14': 'Independence Day',
    '2026-09-06': 'Defence Day',
    '2026-09-11': 'Death Anniversary of Quaid-e-Azam',
    '2026-11-09': 'Iqbal Day',
    '2026-12-25': 'Birthday of Quaid-e-Azam / Christmas',
    '2027-02-05': 'Kashmir Solidarity Day',
    '2027-03-23': 'Pakistan Day',
    '2027-05-01': 'Labour Day',
    '2027-08-14': 'Independence Day',
    '2027-09-06': 'Defence Day',
    '2027-09-11': 'Death Anniversary of Quaid-e-Azam',
    '2027-11-09': 'Iqbal Day',
    '2027-12-25': 'Birthday of Quaid-e-Azam / Christmas',
    // ── Islamic holidays (approximate Gregorian dates) ────
    // Eid ul-Fitr (3 days)
    '2025-03-30': 'Eid ul-Fitr (Day 1)',
    '2025-03-31': 'Eid ul-Fitr (Day 2)',
    '2025-04-01': 'Eid ul-Fitr (Day 3)',
    '2026-03-20': 'Eid ul-Fitr (Day 1)',
    '2026-03-21': 'Eid ul-Fitr (Day 2)',
    '2026-03-22': 'Eid ul-Fitr (Day 3)',
    '2027-03-09': 'Eid ul-Fitr (Day 1)',
    '2027-03-10': 'Eid ul-Fitr (Day 2)',
    '2027-03-11': 'Eid ul-Fitr (Day 3)',
    // Eid ul-Adha (3 days)
    '2025-06-07': 'Eid ul-Adha (Day 1)',
    '2025-06-08': 'Eid ul-Adha (Day 2)',
    '2025-06-09': 'Eid ul-Adha (Day 3)',
    '2026-05-27': 'Eid ul-Adha (Day 1)',
    '2026-05-28': 'Eid ul-Adha (Day 2)',
    '2026-05-29': 'Eid ul-Adha (Day 3)',
    '2027-05-17': 'Eid ul-Adha (Day 1)',
    '2027-05-18': 'Eid ul-Adha (Day 2)',
    '2027-05-19': 'Eid ul-Adha (Day 3)',
    // Eid Milad-un-Nabi
    '2025-09-05': 'Eid Milad-un-Nabi',
    '2026-08-25': 'Eid Milad-un-Nabi',
    '2027-08-15': 'Eid Milad-un-Nabi',
    // Ashura (2 days)
    '2025-07-05': 'Ashura (9 Muharram)',
    '2025-07-06': 'Ashura (10 Muharram)',
    '2026-06-25': 'Ashura (9 Muharram)',
    '2026-06-26': 'Ashura (10 Muharram)',
    '2027-06-14': 'Ashura (9 Muharram)',
    '2027-06-15': 'Ashura (10 Muharram)',
    // Shab-e-Barat
    '2025-02-13': 'Shab-e-Barat',
    '2026-02-02': 'Shab-e-Barat',
    '2027-01-23': 'Shab-e-Barat',
    // Shab-e-Miraj
    '2025-01-27': 'Shab-e-Miraj',
    '2026-01-17': 'Shab-e-Miraj',
    '2027-01-06': 'Shab-e-Miraj',
  };

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

    // Pre-compute: back-to-back 24h situations
    // Only Case 1 — Night (day D) + ANY shift day D+1 (no overnight rest).
    // Case 2 (same-day Night + other shift) removed: autoGenerate now prevents it
    // and manual creation is the senior's deliberate choice.
    const _shiftsByPD = {};
    roster.forEach(r => {
      const k = `${r.pgrId}|${r.date}`;
      if (!_shiftsByPD[k]) _shiftsByPD[k] = new Set();
      _shiftsByPD[k].add(r.shift);
    });
    const backTo24Set = new Set();
    roster.forEach(r => {
      if (r.shift === 'Night') {
        const dt      = new Date(r.date + 'T00:00:00');
        dt.setDate(dt.getDate() + 1);
        const nextStr = dt.toISOString().slice(0, 10);
        const nextSh  = _shiftsByPD[`${r.pgrId}|${nextStr}`];
        if (nextSh && nextSh.size) {
          backTo24Set.add(`${r.pgrId}|${r.date}|Night`);
          nextSh.forEach(s => backTo24Set.add(`${r.pgrId}|${nextStr}|${s}`));
        }
      }
    });

    // Cache for the detail panel (read without recomputing on every click)
    _rosterBayMap  = bayMap;
    _rosterB2BSet  = backTo24Set;
    _rosterMaxBays = maxBays;

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
      const date        = `${ym}-${String(d).padStart(2,'0')}`;
      const isToday     = date === today;
      const dow         = new Date(_year, _month - 1, d).getDay();
      const isWknd      = dow === 0 || dow === 6;
      const isSat       = dow === 6;
      const holidayName = PK_HOLIDAYS[date] || null;
      const dayLeaves   = leaves.filter(l => l.date === date && l.status !== 'rejected');

      html += `<tr class="rm-row${isToday ? ' rm-today' : ''}${isWknd ? ' rm-weekend' : ''}${holidayName ? ' rm-holiday' : ''}">
        <td class="rm-date-cell${isToday ? ' rm-today' : ''}${holidayName ? ' rm-holiday-date' : ''}" onclick="RosterEngine.openDay('${date}')">
          <span class="rm-date-num">${d}</span>${holidayName ? `<span class="rm-holiday-dot"></span>` : ''}
        </td>
        <td class="rm-dayname-cell${isWknd ? ' rm-wknd-text' : ''}" onclick="RosterEngine.openDay('${date}')" title="${holidayName || ''}">
          ${DAY_NAMES[dow]}${holidayName ? `<span class="rm-holiday-tag">${holidayName}</span>` : ''}
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
              const bays      = bayMap[`${e.pgrId}|${date}|${sh.id}`] || 0;
              const isOverBay = !onLeave && !replaced && bays > maxBays;
              const is24h     = !onLeave && !replaced && backTo24Set.has(`${e.pgrId}|${date}|${sh.id}`);
              const alertCls  = is24h && isOverBay ? ' rm-alert-24h-bay'
                              : is24h              ? ' rm-alert-24h'
                              : isOverBay          ? ' rm-alert-bay' : '';
              const alertTip  = is24h && isOverBay
                ? ` \u26a0 Back-to-back 24h + ${bays} bays this shift`
                : is24h
                ? ` \u26a0 Back-to-back duty \u2014 no overnight rest`
                : isOverBay
                ? ` \u26a0 ${bays} bays this shift (max ${maxBays})` : '';
              const swappable  = canEdit && !onLeave && !replaced;
              const swapAttrs  = swappable
                ? `data-eid="${e.id}" onclick="event.stopPropagation();RosterEngine.selectForSwap('${e.id}',this)"`
                : '';
              const delBtn = canEdit
                ? `<button class="rm-del-btn" onclick="event.stopPropagation();RosterEngine.removeAssignment('${e.id}','${date}')" title="Remove">✕</button>`
                : '';
              cellContent += `<div class="rm-name rm-name-${cls}${replaced ? ' rm-replaced' : ''}${onLeave ? ' rm-leave-warn' : alertCls}${swappable ? ' rm-swappable' : ''}${canEdit ? ' rm-has-del' : ''}"
                data-pgrid="${e.pgrId}" ${swapAttrs}
                title="${name}${replaced ? ' (replaced)' : ''}${onLeave ? ' \u26a0 On Leave!' : alertTip}"><span class="rm-chip-name" onclick="event.stopPropagation();RosterEngine.selectPGRPanel('${e.pgrId}')">${name}</span>${delBtn}</div>`;
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

    _renderPGRPanel();
    _renderViolationsPanel();
    _highlightSelectedPGR();
  }

  // ── PGR summary side panel ────────────────────────────
  function _renderPGRPanel() {
    const el = document.getElementById('roster-pgr-panel');
    if (!el) return;

    const ym    = currentYM();
    const pgrs  = DB.getPGRs().filter(p => ['pgr','senior_pgr'].includes(p.role));
    const roster = DB.getRosterForMonth(ym);
    const units  = DB.getUnits();

    // Compute per-PGR sets (used by both views)
    const dutySet  = {}; // Set<'date|shift'>
    const nightSet = {}; // Set<date>
    const dateSet  = {}; // Set<date> — any assignment
    pgrs.forEach(p => {
      dutySet[p.id]  = new Set();
      nightSet[p.id] = new Set();
      dateSet[p.id]  = new Set();
    });
    roster.forEach(r => {
      if (!dutySet[r.pgrId])  dutySet[r.pgrId]  = new Set();
      if (!nightSet[r.pgrId]) nightSet[r.pgrId] = new Set();
      if (!dateSet[r.pgrId])  dateSet[r.pgrId]  = new Set();
      dutySet[r.pgrId].add(`${r.date}|${r.shift}`);
      dateSet[r.pgrId].add(r.date);
      if (r.shift === 'Night') nightSet[r.pgrId].add(r.date);
    });

    function streakFor(pgrId) {
      const dates = [...(dateSet[pgrId] || [])].sort();
      if (!dates.length) return 0;
      let count = 0;
      const d = new Date(dates[dates.length - 1] + 'T00:00:00');
      while (dateSet[pgrId].has(d.toISOString().slice(0, 10))) { count++; d.setDate(d.getDate() - 1); }
      return count;
    }

    function statusFor(duties, minD, strk) {
      if (duties >= minD)         return 'capped';
      if (strk >= 3)              return 'resting';
      if (duties >= minD - 2)     return 'close';
      return 'ok';
    }

    const monthLabel = new Date(_year, _month - 1, 1)
      .toLocaleString('default', { month: 'short', year: 'numeric' });

    let bodyHtml = '';

    // ── DETAIL VIEW ───────────────────────────────────────
    let showingDetail = false;
    if (_selectedPGRId) {
      const p = pgrs.find(x => x.id === _selectedPGRId);
      if (!p) {
        _selectedPGRId = null;  // PGR removed — fall through to list
      } else {
        showingDetail = true;
        const duties   = dutySet[p.id]?.size  || 0;
        const nights   = nightSet[p.id]?.size || 0;
        const minD     = DB.getEffectiveMinDuties(p);
        const nightTgt = DB.getEffectiveNightTarget(p);
        const strk     = streakFor(p.id);
        const capped   = duties >= minD;
        const close    = !capped && duties >= minD - 2;
        const stCls    = statusFor(duties, minD, strk);
        const stTip    = stCls === 'capped'  ? 'At duty cap'
                       : stCls === 'resting' ? `${strk} consecutive — rest needed`
                       : stCls === 'close'   ? 'Near duty cap' : 'Available';
        const pct = minD > 0 ? Math.min(100, Math.round(duties / minD * 100)) : (duties > 0 ? 100 : 0);
        const nightLeft = nightTgt > 0 ? Math.max(0, nightTgt - nights) : 0;
        const dutyLeft  = Math.max(0, minD - duties);

        const DAY_SHORT = ['Su','Mo','Tu','We','Th','Fr','Sa'];
        const shifts    = DB.getShifts();

        const grouped = {};
        roster.filter(r => r.pgrId === p.id).forEach(e => {
          const k = `${e.date}|${e.shift}`;
          if (!grouped[k]) grouped[k] = { date: e.date, shift: e.shift, entries: [] };
          grouped[k].entries.push(e);
        });

        const issues = [];
        let listHtml = '';

        Object.values(grouped)
          .sort((a, b) => a.date.localeCompare(b.date) || a.shift.localeCompare(b.shift))
          .forEach(g => {
            const day       = parseInt(g.date.split('-')[2]);
            const dow       = new Date(g.date + 'T00:00:00').getDay();
            const dayAbbr   = DAY_SHORT[dow];
            const bays      = g.entries.length;
            const isOverBay = bays > _rosterMaxBays;
            const is24h     = _rosterB2BSet.has(`${p.id}|${g.date}|${g.shift}`);
            const unitStr   = g.entries
              .map(e => units.find(u => u.id === e.unitId)?.name || e.unitId)
              .join(', ');
            const shiftObj  = shifts.find(s => s.id === g.shift);
            const shiftAbbr = shiftObj ? shiftObj.label[0].toUpperCase() : g.shift[0].toUpperCase();
            const shiftCls  = shiftObj ? shiftObj.label.toLowerCase() : g.shift.toLowerCase();

            if (isOverBay) issues.push(`<div class="pgr-issue-item pgr-issue-bay">⬡ ${day} ${dayAbbr}: ${bays} bays in ${g.shift} (max ${_rosterMaxBays})</div>`);
            if (is24h)     issues.push(`<div class="pgr-issue-item pgr-issue-24h">⏱ ${day} ${dayAbbr}: back-to-back (no overnight rest)</div>`);

            listHtml += `<div class="pgr-detail-entry${isOverBay || is24h ? ' pgr-entry-issue' : ''}">
              <span class="pgr-entry-date">${day} ${dayAbbr}</span>
              <span class="pgr-entry-shift pgr-es-${shiftCls}">${shiftAbbr}</span>
              <span class="pgr-entry-unit">${unitStr}</span>
              ${isOverBay ? `<span class="pgr-entry-flag pgr-flag-bay" title="${bays} bays this shift">⬡</span>` : ''}
              ${is24h     ? `<span class="pgr-entry-flag pgr-flag-24h" title="Back-to-back — no overnight rest">⏱</span>` : ''}
            </div>`;
          });

        bodyHtml = `
          <div class="pgr-detail-header">
            <button class="pgr-detail-back" onclick="RosterEngine.selectPGRPanel('${p.id}')">← All</button>
            <span class="pgr-status-dot pgr-dot-${stCls}" title="${stTip}"></span>
            <span class="pgr-detail-name" title="${p.name}">${p.name}</span>
            ${p.year ? `<span class="pgr-panel-year">Y${p.year}</span>` : ''}
          </div>

          <div class="pgr-detail-stats">
            <div class="pgr-stat-pill pgr-stat-${capped ? 'capped' : close ? 'close' : 'ok'}">
              <span class="pgr-stat-val">${duties}</span><span class="pgr-stat-of">/${minD}</span>&thinsp;duties
            </div>
            ${nightTgt > 0 ? `<div class="pgr-stat-pill pgr-stat-${nights >= nightTgt ? 'nightmet' : 'night'}">
              ☽&thinsp;<span class="pgr-stat-val">${nights}</span><span class="pgr-stat-of">/${nightTgt}</span>
            </div>` : ''}
            ${strk >= 2 ? `<div class="pgr-stat-pill pgr-stat-${strk >= 3 ? 'warn' : 'streak'}">
              ↑&thinsp;${strk}d streak
            </div>` : ''}
          </div>

          <div class="pgr-detail-remaining">
            ${dutyLeft > 0   ? `<span class="pgr-rem-item pgr-rem-duty">${dutyLeft} duties left</span>` : `<span class="pgr-rem-item pgr-rem-capped">Cap reached</span>`}
            ${nightTgt > 0 && nightLeft > 0 ? `<span class="pgr-rem-item pgr-rem-night">☽ ${nightLeft} nights left</span>` : ''}
          </div>

          <div class="pgr-detail-bar-wrap">
            <div class="pgr-detail-bar pgr-bar-${capped ? 'met' : close ? 'close' : 'under'}" style="width:${pct}%"></div>
          </div>

          <div class="pgr-detail-section">
            <div class="pgr-detail-section-hdr">
              Assignments
              <span class="pgr-section-count">${Object.keys(grouped).length} shift${Object.keys(grouped).length !== 1 ? 's' : ''}</span>
            </div>
            ${listHtml || '<div class="pgr-detail-empty">No assignments this month.</div>'}
          </div>

          ${issues.length ? `<div class="pgr-detail-section">
            <div class="pgr-detail-section-hdr pgr-issues-hdr">
              Issues&thinsp;<span class="pgr-section-count">${issues.length}</span>
            </div>
            ${issues.join('')}
          </div>` : ''}`;
      }
    }

    // ── LIST VIEW ─────────────────────────────────────────
    if (!showingDetail) {
      const sorted = [...pgrs].sort((a, b) => {
        const da = dutySet[a.id]?.size || 0, db = dutySet[b.id]?.size || 0;
        if (da !== db) return da - db;
        return (a.year || 99) - (b.year || 99);
      });

      let html = `<div class="pgr-panel-hint" style="font-size:.65rem;color:var(--text-muted);margin-bottom:.4rem">Click a name to inspect</div>`;

      sorted.forEach(p => {
        const duties   = dutySet[p.id]?.size  || 0;
        const nights   = nightSet[p.id]?.size || 0;
        const minD     = DB.getEffectiveMinDuties(p);
        const nightTgt = DB.getEffectiveNightTarget(p);
        const strk     = streakFor(p.id);
        const pct      = minD > 0 ? Math.min(100, Math.round(duties / minD * 100)) : (duties > 0 ? 100 : 0);
        const capped   = duties >= minD;
        const close    = !capped && duties >= minD - 2;
        const stCls    = statusFor(duties, minD, strk);
        const stTip    = stCls === 'capped'  ? 'At duty cap'
                       : stCls === 'resting' ? `${strk} consecutive days — needs rest`
                       : stCls === 'close'   ? 'Near cap' : 'Available';

        const nightHtml = nightTgt > 0
          ? `<span class="pgr-panel-nights pgr-nights-${nights >= nightTgt ? 'met' : 'under'}" title="Nights: ${nights} of ${nightTgt} target">☽ ${nights}/${nightTgt}</span>`
          : '';
        const streakHtml = strk >= 2
          ? `<span class="pgr-panel-streak pgr-streak-${strk >= 3 ? 'warn' : 'ok'}" title="${strk} consecutive days">${strk}d</span>`
          : '';
        const yearBadge = p.year ? `<span class="pgr-panel-year">Y${p.year}</span>` : '';
        const allDates  = [...dateSet[p.id]].sort();
        const lastDate  = allDates.length ? allDates[allDates.length - 1] : null;
        const lastD     = lastDate ? parseInt(lastDate.split('-')[2]) : null;
        const lastHtml  = lastD != null
          ? `<span class="pgr-panel-last" title="Last duty: ${lastDate}">last: ${lastD}</span>`
          : `<span class="pgr-panel-last">no duties</span>`;

        html += `
          <div class="pgr-panel-row" onclick="RosterEngine.selectPGRPanel('${p.id}')">
            <div class="pgr-panel-top">
              <span class="pgr-status-dot pgr-dot-${stCls}" title="${stTip}"></span>
              <span class="pgr-panel-name" title="${p.name}">${p.name}</span>
              <span class="pgr-panel-right">${streakHtml}${nightHtml}${yearBadge}</span>
            </div>
            <div class="pgr-panel-duty-row">
              <span class="pgr-panel-duty-count pgr-duty-${capped ? 'met' : close ? 'close' : 'under'}">${duties}<span class="pgr-duty-sep">/${minD}</span></span>
              <div class="pgr-panel-bar-wrap"><div class="pgr-panel-bar pgr-bar-${capped ? 'met' : close ? 'close' : 'under'}" style="width:${pct}%"></div></div>
              ${lastHtml}
            </div>
          </div>`;
      });

      if (!sorted.length) html += `<p class="pgr-panel-empty">No PGRs.</p>`;
      bodyHtml = html;
    }

    const collapsed = !_panelStates.pgr;
    el.innerHTML = `
      <div class="sp-header" onclick="RosterEngine.toggleSidePanel('pgr')" title="${collapsed ? 'Expand' : 'Collapse'}">
        <span class="sp-title">Team &mdash; ${monthLabel}</span>
        <span class="sp-chevron${collapsed ? ' sp-chevron-up' : ''}">▾</span>
      </div>
      <div class="sp-body">${bodyHtml}</div>`;
    el.classList.toggle('sp-collapsed', collapsed);
  }

  // ── Violations / alerts side panel ────────────────────────
  function _renderViolationsPanel() {
    const el = document.getElementById('roster-violations-panel');
    if (!el) return;

    const ym       = currentYM();
    const yr       = parseInt(ym.slice(0, 4));
    const mo       = parseInt(ym.slice(5, 7));
    const daysInM  = new Date(yr, mo, 0).getDate();
    const pgrs     = DB.getPGRs().filter(p => ['pgr','senior_pgr','senior_registrar'].includes(p.role));
    const roster   = DB.getRosterForMonth(ym);
    const shifts   = DB.getShifts();
    const nightIds = new Set(shifts.filter(s =>
      s.id === 'Night' || s.label.toLowerCase().includes('night') || (s.hours || 0) >= 10
    ).map(s => s.id));

    // Month-name abbreviation helper
    const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    function fmtDate(dateStr) {
      const d = parseInt(dateStr.slice(8));
      return `${MON[mo - 1]} ${d}`;
    }

    const alerts = []; // { level: 'critical'|'issue'|'warn', type, pgrName, headline, detail }

    pgrs.forEach(p => {
      const pName   = p.name || p.id;
      const entries = roster.filter(r => r.pgrId === p.id);
      const minD    = DB.getEffectiveMinDuties(p);
      const nightTgt = DB.getEffectiveNightTarget(p);
      const wkndQ   = DB.getWeekendQuotasForPGR(p.id);

      // ── 1. Leave conflict — assigned during approved leave ──────────────────
      entries.forEach(r => {
        if (DB.isOnLeave(p.id, r.date)) {
          alerts.push({
            level: 'critical', type: 'leave',
            pgrName: pName,
            headline: `On leave — still assigned`,
            detail: fmtDate(r.date),
          });
        }
      });

      // ── 2. Zero duties — completely unassigned ──────────────────────────────
      if (entries.length === 0 && minD > 0) {
        alerts.push({
          level: 'critical', type: 'duty',
          pgrName: pName,
          headline: `Not assigned any duties`,
          detail: `Target: ${minD}`,
        });
        return; // no point checking further for this PGR
      }

      // ── 3. Duty shortfall ───────────────────────────────────────────────────
      const dutyDelta = minD - entries.length;
      if (dutyDelta > 0) {
        alerts.push({
          level: dutyDelta >= 3 ? 'issue' : 'warn', type: 'duty',
          pgrName: pName,
          headline: dutyDelta >= 3
            ? `Short ${dutyDelta} duties`
            : `1 duty short`,
          detail: `${entries.length} / ${minD}`,
        });
      }

      // ── 4. Night target shortfall ───────────────────────────────────────────
      if (nightTgt > 0) {
        const nights = entries.filter(r => nightIds.has(r.shift)).length;
        const nd = nightTgt - nights;
        if (nd > 0) {
          alerts.push({
            level: 'warn', type: 'night',
            pgrName: pName,
            headline: `Night target not met`,
            detail: `${nights} / ${nightTgt} nights`,
          });
        }
      }

      // ── 5. Consecutive duty runs ────────────────────────────────────────────
      const uniqueDates = [...new Set(entries.map(r => r.date))].sort();
      let run = 1, runStart = uniqueDates[0];
      let worstRun = 1, worstStart = uniqueDates[0], worstEnd = uniqueDates[0];
      for (let i = 1; i < uniqueDates.length; i++) {
        const prev = new Date(uniqueDates[i - 1] + 'T00:00:00');
        prev.setDate(prev.getDate() + 1);
        if (prev.toISOString().slice(0, 10) === uniqueDates[i]) {
          run++;
          if (run > worstRun) {
            worstRun   = run;
            worstStart = runStart;
            worstEnd   = uniqueDates[i];
          }
        } else {
          run = 1;
          runStart = uniqueDates[i];
        }
      }
      if (worstRun >= 3) {
        const rangeStr = worstStart === worstEnd
          ? fmtDate(worstStart)
          : `${fmtDate(worstStart)}–${parseInt(worstEnd.slice(8))}`;
        alerts.push({
          level: worstRun > 3 ? 'issue' : 'warn', type: 'consec',
          pgrName: pName,
          headline: worstRun > 3
            ? `${worstRun} consecutive days`
            : `3 days in a row`,
          detail: rangeStr,
        });
      }

      // ── 6. Back-to-back 24 h (Night → next day) ────────────────────────────
      // Leverage the already-computed _rosterB2BSet where key = pgrId|date|shift
      const b2bDates = [];
      entries.forEach(r => {
        if (_rosterB2BSet.has(`${p.id}|${r.date}|${r.shift}`) && nightIds.has(r.shift)) {
          b2bDates.push(r.date);
        }
      });
      if (b2bDates.length) {
        const d = b2bDates[0];
        const next = new Date(d + 'T00:00:00');
        next.setDate(next.getDate() + 1);
        alerts.push({
          level: 'issue', type: 'b2b',
          pgrName: pName,
          headline: `No rest after night duty`,
          detail: `Night ${fmtDate(d)} → ${parseInt(next.toISOString().slice(8, 10))}`,
        });
      }

      // ── 7. Over-bay (more bays than maxBays in one shift) ──────────────────
      const overBayDates = [];
      entries.forEach(r => {
        const cnt = _rosterBayMap[`${p.id}|${r.date}|${r.shift}`] || 1;
        if (cnt > _rosterMaxBays) overBayDates.push(r.date);
      });
      const overBayUniq = [...new Set(overBayDates)];
      if (overBayUniq.length) {
        alerts.push({
          level: 'warn', type: 'overbay',
          pgrName: pName,
          headline: `Over-bay assignment`,
          detail: `${overBayUniq.length} shift${overBayUniq.length > 1 ? 's' : ''} (${fmtDate(overBayUniq[0])})`,
        });
      }

      // ── 8. Off-day violations ───────────────────────────────────────────────
      const prefOffDays = new Set(DB.getEffectiveOffDays(p.id).filter(d => d.startsWith(ym)));
      const offDayHits  = entries.filter(r => prefOffDays.has(r.date));
      if (offDayHits.length) {
        alerts.push({
          level: 'warn', type: 'offday',
          pgrName: pName,
          headline: `Assigned on preferred day off`,
          detail: `${offDayHits.length} time${offDayHits.length > 1 ? 's' : ''}`,
        });
      }

      // ── 9. Weekend quota shortfalls (only if quotas were actually set) ──────
      const hasQuota = ['satDay','satNight','sunDay','sunNight'].some(k => (wkndQ[k] || 0) > 0);
      if (hasQuota) {
        const wkndDone = { satDay: 0, satNight: 0, sunDay: 0, sunNight: 0 };
        entries.forEach(r => {
          const dow    = new Date(yr, mo - 1, parseInt(r.date.slice(8))).getDay();
          const isHol  = !!(PK_HOLIDAYS && PK_HOLIDAYS[r.date]);
          const isSat  = dow === 6 || isHol;
          const isSun  = dow === 0 || isHol;
          if (!isSat && !isSun) return;
          const isNt = nightIds.has(r.shift);
          if (isSat) wkndDone[isNt ? 'satNight' : 'satDay']++;
          else       wkndDone[isNt ? 'sunNight' : 'sunDay']++;
        });
        const shortBuckets = ['satDay','satNight','sunDay','sunNight'].filter(k =>
          (wkndQ[k] || 0) > 0 && wkndDone[k] < wkndQ[k]
        );
        if (shortBuckets.length) {
          const labels = { satDay:'Sat D', satNight:'Sat N', sunDay:'Sun D', sunNight:'Sun N' };
          alerts.push({
            level: 'warn', type: 'wknd',
            pgrName: pName,
            headline: `Weekend quota not met`,
            detail: shortBuckets.map(k => `${labels[k]}: ${wkndDone[k]}/${wkndQ[k]}`).join(', '),
          });
        }
      }
    });

    // ── Render ────────────────────────────────────────────
    const criticals = alerts.filter(a => a.level === 'critical');
    const issues    = alerts.filter(a => a.level === 'issue');
    const warns     = alerts.filter(a => a.level === 'warn');
    const total     = alerts.length;

    // Sort: criticals first, then issues, then warns — within each, keep original order
    const sorted = [...criticals, ...issues, ...warns];

    const ICON = {
      leave:   '🚫',
      duty:    '📋',
      night:   '🌙',
      consec:  '⚡',
      b2b:     '⏱',
      overbay: '⬡',
      offday:  '📅',
      wknd:    '📆',
    };

    function alertItem(a) {
      const lvlCls = a.level === 'critical' ? 'vp-item-crit'
                   : a.level === 'issue'    ? 'vp-item-err'
                   :                          'vp-item-warn';
      return `<div class="vp-item ${lvlCls}">
        <span class="vp-item-icon">${ICON[a.type] || '•'}</span>
        <div class="vp-item-body">
          <span class="vp-item-name">${a.pgrName}</span>
          <span class="vp-item-headline">${a.headline}</span>
          <span class="vp-item-detail">${a.detail}</span>
        </div>
      </div>`;
    }

    let bodyHtml;
    if (!roster.length) {
      bodyHtml = `<p class="vp-empty">No roster entries yet.</p>`;
    } else if (!total) {
      bodyHtml = `<p class="vp-empty vp-ok">All targets met ✓</p>`;
    } else {
      const critBadge  = criticals.length ? `<span class="vp-summary-chip vp-chip-crit">${criticals.length} critical</span>` : '';
      const issueBadge = issues.length    ? `<span class="vp-summary-chip vp-chip-err">${issues.length} issue${issues.length > 1 ? 's' : ''}</span>` : '';
      const warnBadge  = warns.length     ? `<span class="vp-summary-chip vp-chip-warn">${warns.length} warning${warns.length > 1 ? 's' : ''}</span>` : '';
      bodyHtml = `
        <div class="vp-summary-row">${critBadge}${issueBadge}${warnBadge}</div>
        ${sorted.map(alertItem).join('')}`;
    }

    const collapsed = !_panelStates.violations;
    const totalBadge = total
      ? `<span class="sp-badge ${criticals.length ? 'sp-badge-crit' : issues.length ? 'sp-badge-err' : 'sp-badge-warn'}">${total}</span>`
      : `<span class="sp-badge sp-badge-ok">✓</span>`;

    el.innerHTML = `
      <div class="sp-header" onclick="RosterEngine.toggleSidePanel('violations')" title="${collapsed ? 'Expand' : 'Collapse'}">
        <span class="sp-title">Alerts</span>
        ${totalBadge}
        <span class="sp-chevron${collapsed ? ' sp-chevron-up' : ''}">▾</span>
      </div>
      <div class="sp-body">${bodyHtml}</div>`;
    el.classList.toggle('sp-collapsed', collapsed);
  }

  // Toggle a side panel open/closed without re-rendering content
  function toggleSidePanel(name) {
    _panelStates[name] = !_panelStates[name];
    const id = name === 'pgr' ? 'roster-pgr-panel' : 'roster-violations-panel';
    const el = document.getElementById(id);
    if (!el) return;
    const collapsed = !_panelStates[name];
    el.classList.toggle('sp-collapsed', collapsed);
    // Flip chevron direction
    const chev = el.querySelector('.sp-chevron');
    if (chev) chev.classList.toggle('sp-chevron-up', collapsed);
    el.querySelector('.sp-header')?.setAttribute('title', collapsed ? 'Expand' : 'Collapse');
  }

  // Select a PGR for detail view; toggle off if same PGR clicked again
  function selectPGRPanel(pgrId) {
    _selectedPGRId = (_selectedPGRId === pgrId) ? null : pgrId;
    _renderPGRPanel();
    _renderViolationsPanel();
    _highlightSelectedPGR();
  }

  // Highlight all chips in the roster table belonging to the selected PGR
  function _highlightSelectedPGR() {
    document.querySelectorAll('.rm-name[data-pgrid]').forEach(el => {
      el.classList.toggle('rm-pgr-selected', el.dataset.pgrid === _selectedPGRId);
    });
  }

  // ── Export as Word document (HTML table, .doc) ─────────────
  function exportWord() {
    const ym     = currentYM();
    const roster = DB.getRosterForMonth(ym);
    const pgrs   = DB.getPGRs();
    const units  = DB.getUnits();
    const shifts = DB.getShifts();
    const [yr, mo] = ym.split('-').map(Number);
    const daysInMonth = new Date(yr, mo, 0).getDate();
    const monthLabel  = new Date(yr, mo - 1, 1)
      .toLocaleString('default', { month: 'long', year: 'numeric' });
    const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

    const tdStyle = 'border:1px solid #ccc;padding:4px 6px;font-size:9pt;text-align:center';
    const thStyle = 'border:1px solid #aaa;padding:5px 6px;font-size:9pt;background:#e8e8e8;text-align:center';

    let table = `<table style="border-collapse:collapse;width:100%;font-family:Arial">`;
    table += `<thead><tr>
      <th style="${thStyle}">Date</th>
      <th style="${thStyle}">Day</th>`;
    shifts.forEach(sh => {
      units.forEach(u => {
        table += `<th style="${thStyle}">${sh.label}<br/>${u.name}</th>`;
      });
    });
    table += `</tr></thead><tbody>`;

    for (let d = 1; d <= daysInMonth; d++) {
      const date   = `${ym}-${String(d).padStart(2,'0')}`;
      const dow    = new Date(yr, mo - 1, d).getDay();
      const isWknd = dow === 0 || dow === 6;
      const rowBg  = isWknd ? 'background:#f5f5f5' : '';
      table += `<tr>
        <td style="${tdStyle};${rowBg};font-weight:600">${d}</td>
        <td style="${tdStyle};${rowBg}">${DAY_NAMES[dow]}</td>`;
      shifts.forEach(sh => {
        units.forEach(u => {
          const entry = roster.find(r => r.date === date && r.shift === sh.id && r.unitId === u.id);
          const name  = entry ? (pgrs.find(p => p.id === entry.pgrId)?.name || '—') : '—';
          table += `<td style="${tdStyle};${rowBg}">${name}</td>`;
        });
      });
      table += `</tr>`;
    }
    table += `</tbody></table>`;

    const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
      <head><meta charset="utf-8"><title>Roster ${monthLabel}</title>
      <!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>90</w:Zoom>
      <w:DoNotOptimizeForBrowser/></w:WordDocument></xml><![endif]-->
      <style>body{font-family:Arial;font-size:10pt}</style></head>
      <body><h2 style="margin-bottom:8pt">Duty Roster — ${monthLabel}</h2>${table}</body></html>`;

    const blob = new Blob(['\ufeff', html], { type: 'application/msword' });
    const a    = document.createElement('a');
    a.href     = URL.createObjectURL(blob);
    a.download = `roster-${ym}.doc`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

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

  // Step 1: show MO-covered bays dialog, then run generation on confirm
  function autoGenerate() {
    const ym = currentYM();
    const existing = DB.getRosterForMonth(ym);
    if (existing.length > 0) {
      if (!confirm(`Roster for ${ym} already has ${existing.length} entries.\nAuto-generate will ADD to existing entries (won't duplicate). Continue?`)) return;
    }

    // Populate and show MO-slots modal
    const units  = DB.getUnits();
    const shifts = DB.getShifts();
    const saved  = DB.getConfig().moSlots || [];

    let gridHtml = `<table class="mo-slots-table"><thead><tr><th>Bay / Shift</th>`;
    shifts.forEach(sh => { gridHtml += `<th>${sh.label}</th>`; });
    gridHtml += `</tr></thead><tbody>`;
    units.forEach(u => {
      gridHtml += `<tr><td>${u.name}</td>`;
      shifts.forEach(sh => {
        const chk = saved.some(s => s.shift === sh.id && s.unitId === u.id) ? 'checked' : '';
        gridHtml += `<td><input type="checkbox" id="mo-${sh.id}-${u.id}" ${chk}/></td>`;
      });
      gridHtml += `</tr>`;
    });
    gridHtml += `</tbody></table>`;
    document.getElementById('mo-slots-grid').innerHTML = gridHtml;
    document.getElementById('mo-slots-modal').classList.remove('hidden');
    document.getElementById('overlay').classList.remove('hidden');
  }

  // Step 2: called by modal "Generate" button
  function runAutoGenerate() {
    const units  = DB.getUnits();
    const shifts = DB.getShifts();
    const moSlots   = [];
    const moSkipped = new Set();
    shifts.forEach(sh => {
      units.forEach(u => {
        const el = document.getElementById(`mo-${sh.id}-${u.id}`);
        if (el && el.checked) {
          moSlots.push({ shift: sh.id, unitId: u.id });
          moSkipped.add(`${sh.id}|${u.id}`);
        }
      });
    });
    // Persist MO slots to config so they're pre-checked next time
    const cfg = DB.getConfig();
    cfg.moSlots = moSlots;
    DB.saveConfig(cfg);

    document.getElementById('mo-slots-modal').classList.add('hidden');
    document.getElementById('overlay').classList.add('hidden');
    _doAutoGenerate(moSkipped);
  }

  // Step 3: Multi-iteration, scored, weighted-random generation engine
  //
  //  Architecture:
  //    • Per-PGR static data loaded once outside the loop (prefs, caps, targets).
  //    • allSlots built once: all (date × shift × unit) not yet assigned / MO-covered,
  //      sorted hardest-first within each date (night before day, fewer-eligible first).
  //    • ITERATIONS independent runs, each building a full virtual roster using
  //      weighted-random candidate selection driven by a soft-constraint score.
  //    • Best-scoring virtual roster committed to DB in a single batch at the end.
  //    • Two-pass fill per iteration: Pass 1 limits every PGR to 1 bay per shift-day
  //      (broad distribution); Pass 2 fills remaining gaps up to maxBaysPerPGR.
  //
  function _doAutoGenerate(moSkipped) {
    const ym               = currentYM();
    const existing         = DB.getRosterForMonth(ym);
    const [calYear, month] = ym.split('-').map(Number);
    const daysInMonth      = new Date(calYear, month, 0).getDate();
    const allPGRs          = DB.getPGRs().filter(p => ['pgr','senior_pgr'].includes(p.role));
    const units            = DB.getUnits();
    const shifts           = DB.getShifts();

    if (!allPGRs.length)  { alert('No PGRs available.'); return; }
    if (!units.length)    { alert('No units configured.'); return; }

    const cfg     = DB.getConfig();
    const maxBays = cfg.maxBaysPerPGR || 2;

    // ── Static per-PGR data (loaded once, shared across all iterations) ──────
    const allUnitIds = units.map(u => u.id);
    const pgrData    = {}; // pgrId -> { dutyMax, nightTgt, offDays Set, excl Set, bayPrio [], wkndQuota }

    allPGRs.forEach(p => {
      const pref = DB.getPrefForPGR(p.id);
      const excl = new Set(pref.excludedBays || []);
      const saved = (pref.bayPriorities || []).filter(id => !excl.has(id));
      pgrData[p.id] = {
        dutyMax:     DB.getEffectiveMinDuties(p),
        nightTgt:    DB.getEffectiveNightTarget(p),
        offDays:     new Set(DB.getEffectiveOffDays(p.id).filter(d => d.startsWith(ym))),
        excl,
        bayPrio: [
          ...saved.filter(id => allUnitIds.includes(id)),
          ...allUnitIds.filter(id => !saved.includes(id) && !excl.has(id)),
        ],
        wkndQuota: DB.getWeekendQuotasForPGR(p.id), // { satDay, satNight, sunDay, sunNight }
      };
    });

    // ── Leave coverage (pre-computed, avoids DB calls inside hot loop) ────────
    const leaveSet = new Set(); // 'pgrId|date'
    for (let d = 1; d <= daysInMonth; d++) {
      const date = `${ym}-${String(d).padStart(2,'0')}`;
      allPGRs.forEach(p => {
        if (DB.isOnLeave(p.id, date)) leaveSet.add(`${p.id}|${date}`);
      });
    }

    // ── Night-shift identification (dynamic, not hardcoded to 'Night') ────────
    const nightShiftIds = new Set(
      shifts
        .filter(s => s.id === 'Night' ||
                     s.label.toLowerCase().includes('night') ||
                     (s.hours || 0) >= 10)
        .map(s => s.id)
    );

    // ── Weekend / holiday date metadata ───────────────────────────────────────
    // wkndMeta[date] = { isSat, isSun, isHoliday }
    // Weekend slots = Saturday, Sunday, or any PK holiday in this month
    const wkndMeta = {};
    for (let d = 1; d <= daysInMonth; d++) {
      const date = `${ym}-${String(d).padStart(2,'0')}`;
      const dow  = new Date(calYear, month - 1, d).getDay(); // 0=Sun,6=Sat
      const isSat     = dow === 6;
      const isSun     = dow === 0;
      const isHoliday = !!PK_HOLIDAYS[date];
      if (isSat || isSun || isHoliday) {
        wkndMeta[date] = { isSat: isSat || isHoliday, isSun: isSun || isHoliday };
      }
    }

    // Helper: which quota bucket does a (date, shiftId) belong to?
    // Returns 'satDay' | 'satNight' | 'sunDay' | 'sunNight' | null
    function wkndBucket(date, shiftId) {
      const meta = wkndMeta[date];
      if (!meta) return null;
      const isNight = nightShiftIds.has(shiftId);
      if (meta.isSat) return isNight ? 'satNight' : 'satDay';
      if (meta.isSun) return isNight ? 'sunNight' : 'sunDay';
      return null;
    }

    // ── Slot list — all (date × shift × unit) that need filling ───────────────
    const existingKeys = new Set(existing.map(r => `${r.date}|${r.shift}|${r.unitId}`));
    const allSlots     = [];

    for (let d = 1; d <= daysInMonth; d++) {
      const date = `${ym}-${String(d).padStart(2,'0')}`;
      for (const sh of shifts) {
        for (const u of units) {
          if (moSkipped.has(`${sh.id}|${u.id}`)) continue;
          if (existingKeys.has(`${date}|${sh.id}|${u.id}`)) continue;
          allSlots.push({
            date,
            shiftId:  sh.id,
            unitId:   u.id,
            isNight:  nightShiftIds.has(sh.id),
          });
        }
      }
    }

    // ── Slot difficulty: used to sort within each date ─────────────────────────
    // Fewer eligible PGRs for a (shift, unit) combination → harder → assign first
    const eligibleCount = {};
    for (const sh of shifts) {
      for (const u of units) {
        const key = `${sh.id}|${u.id}`;
        eligibleCount[key] = allPGRs.filter(p =>
          !pgrData[p.id].excl.has(u.id) && pgrData[p.id].dutyMax > 0
        ).length;
      }
    }

    // Sort: date asc → within date: night first → fewer-eligible first
    allSlots.sort((a, b) => {
      const dc = a.date.localeCompare(b.date);
      if (dc !== 0) return dc;
      const aN = a.isNight ? 1 : 0, bN = b.isNight ? 1 : 0;
      if (aN !== bN) return bN - aN;
      return (eligibleCount[`${a.shiftId}|${a.unitId}`] || 0)
           - (eligibleCount[`${b.shiftId}|${b.unitId}`] || 0);
    });

    // ── Shared utilities ───────────────────────────────────────────────────────
    function weightedRandomPick(candidates, scoreFn) {
      // weight = 1 / (1 + score)  →  lower score = higher chance
      const weights = candidates.map(p => 1 / (1 + Math.max(0, scoreFn(p))));
      const total   = weights.reduce((s, w) => s + w, 0);
      let   rnd     = Math.random() * total;
      for (let i = 0; i < candidates.length; i++) {
        rnd -= weights[i];
        if (rnd <= 0) return candidates[i];
      }
      return candidates[candidates.length - 1];
    }

    // ── Single iteration ───────────────────────────────────────────────────────
    function generateIteration() {
      // Mutable state for this iteration (seeded with pre-existing assignments)
      const dutyCounted   = {}; // pgrId -> Set<'date|shiftId'>
      const assignedDates = {}; // pgrId -> Set<date>
      const dateToShift   = {}; // 'pgrId|date' -> shiftId  (one shift per day rule)
      const bayCount      = {}; // 'pgrId|date|shiftId' -> count
      const nightCount    = {}; // pgrId -> number
      const wkndCount     = {}; // pgrId -> { satDay, satNight, sunDay, sunNight }

      allPGRs.forEach(p => {
        const ex = existing.filter(r => r.pgrId === p.id);
        dutyCounted[p.id]   = new Set(ex.map(r => `${r.date}|${r.shift}`));
        assignedDates[p.id] = new Set(ex.map(r => r.date));
        nightCount[p.id]    = ex.filter(r => nightShiftIds.has(r.shift)).length;
        wkndCount[p.id]     = { satDay: 0, satNight: 0, sunDay: 0, sunNight: 0 };
        ex.forEach(r => {
          const dk = `${p.id}|${r.date}`;
          if (!dateToShift[dk]) dateToShift[dk] = r.shift;
          const bk = `${p.id}|${r.date}|${r.shift}`;
          bayCount[bk] = (bayCount[bk] || 0) + 1;
          const bkt = wkndBucket(r.date, r.shift);
          if (bkt) wkndCount[p.id][bkt]++;
        });
      });

      // Count consecutive assigned days ending on date-1
      function consecutiveBefore(pgrId, date) {
        let count = 0;
        const d = new Date(date + 'T00:00:00');
        d.setDate(d.getDate() - 1);
        while (count < 4 && assignedDates[pgrId].has(d.toISOString().slice(0, 10))) {
          count++;
          d.setDate(d.getDate() - 1);
        }
        return count;
      }

      // Hard-constraint gate: returns false if any hard rule is violated
      function eligible(p, date, shiftId, unitId, passMaxBays) {
        if (leaveSet.has(`${p.id}|${date}`))          return false;
        if (pgrData[p.id].excl.has(unitId))           return false;
        if (dutyCounted[p.id].size >= pgrData[p.id].dutyMax) return false;
        if (consecutiveBefore(p.id, date) >= 3)       return false;
        const existing = dateToShift[`${p.id}|${date}`];
        if (existing && existing !== shiftId)          return false;
        if ((bayCount[`${p.id}|${date}|${shiftId}`] || 0) >= passMaxBays) return false;
        return true;
      }

      // Soft-constraint score: lower = better candidate for this slot
      function scoreCandidate(p, date, shiftId, unitId, isNight) {
        let sc = 0;

        // Year-based priority: Year 1 preferred (lower year = lower base score)
        sc += (p.year || 4) * 3;

        // Workload balance: fewest duties first within same year tier
        sc += dutyCounted[p.id].size * 2;

        // Night duty balance
        const nightNeeded = pgrData[p.id].nightTgt;
        const nightDone   = nightCount[p.id];
        if (isNight) {
          if (nightNeeded > 0 && nightDone < nightNeeded) sc -= 15; // reward
          if (nightNeeded > 0 && nightDone >= nightNeeded) sc += 20; // already met quota
        } else {
          if (nightNeeded > 0 && nightDone < nightNeeded) sc += 8;  // needs nights, not getting them
        }

        // Weekend quota scoring — reward PGRs still below their weekend target,
        // and penalise those already at/over their target for this slot type.
        const bkt = wkndBucket(date, shiftId);
        if (bkt) {
          const quota = pgrData[p.id].wkndQuota[bkt] || 0;
          const done  = wkndCount[p.id][bkt] || 0;
          if (quota > 0) {
            if (done < quota)  sc -= 20; // strongly prefer: needs more weekend slots of this type
            if (done >= quota) sc += 35; // de-prefer: already met weekend quota for this type
          }
        }

        // Consecutive duty penalty — increases steeply to discourage 3-in-a-row
        const consec = consecutiveBefore(p.id, date);
        if (consec === 1) sc += 12;
        else if (consec === 2) sc += 55; // very high: one more = cap, strongly discourage

        // Bay preference (index 0 = most preferred)
        const bayIdx = pgrData[p.id].bayPrio.indexOf(unitId);
        if (bayIdx >= 0) sc += bayIdx * 4;

        // Off-day violation
        if (pgrData[p.id].offDays.has(date)) sc += 25;

        // Double-bay penalty (already covering another bay this shift-day)
        if ((bayCount[`${p.id}|${date}|${shiftId}`] || 0) >= 1) sc += 60;

        return sc;
      }

      // ── Two-pass assignment ──────────────────────────────────────────────────
      //   Pass 1: max 1 bay per PGR per shift-day (broad distribution)
      //   Pass 2: fill remaining gaps up to maxBays (fallback double-bay)
      const assignments = [];
      const filledKeys  = new Set(existingKeys);
      const passes      = maxBays > 1 ? [1, maxBays] : [maxBays];

      for (const passMaxBays of passes) {
        for (const slot of allSlots) {
          const { date, shiftId, unitId, isNight } = slot;
          const slotKey = `${date}|${shiftId}|${unitId}`;
          if (filledKeys.has(slotKey)) continue;

          // Pool A: strict — hard constraints + no off-day violation
          let pool = allPGRs.filter(p =>
            eligible(p, date, shiftId, unitId, passMaxBays) &&
            !pgrData[p.id].offDays.has(date)
          );

          // Pool B: relaxed — off-day violation allowed (all hard constraints still enforced)
          if (!pool.length) {
            pool = allPGRs.filter(p => eligible(p, date, shiftId, unitId, passMaxBays));
          }

          if (!pool.length) continue; // nobody available — try in next pass or leave empty

          const chosen = weightedRandomPick(
            pool,
            p => scoreCandidate(p, date, shiftId, unitId, isNight)
          );

          assignments.push({ date, shift: shiftId, unitId, pgrId: chosen.id });
          filledKeys.add(slotKey);

          // Update iteration state
          dutyCounted[chosen.id].add(`${date}|${shiftId}`);
          assignedDates[chosen.id].add(date);
          if (!dateToShift[`${chosen.id}|${date}`]) dateToShift[`${chosen.id}|${date}`] = shiftId;
          const bk = `${chosen.id}|${date}|${shiftId}`;
          bayCount[bk] = (bayCount[bk] || 0) + 1;
          if (isNight) nightCount[chosen.id]++;
          const bkt2 = wkndBucket(date, shiftId);
          if (bkt2) wkndCount[chosen.id][bkt2]++;
        }
      }

      // ── Total score for this iteration ───────────────────────────────────────
      let totalScore = 0;

      // Unmet duty/night targets (heaviest penalty — coverage is the primary goal)
      allPGRs.forEach(p => {
        const dutyShortfall  = Math.max(0, pgrData[p.id].dutyMax - dutyCounted[p.id].size);
        const nightShortfall = Math.max(0, pgrData[p.id].nightTgt - nightCount[p.id]);
        totalScore += dutyShortfall * 25;
        totalScore += nightShortfall * 15;

        // Weekend quota shortfall penalty (mild — best-effort, not mandatory)
        const wq = pgrData[p.id].wkndQuota;
        const wc = wkndCount[p.id];
        ['satDay','satNight','sunDay','sunNight'].forEach(bkt => {
          if ((wq[bkt] || 0) > 0) {
            totalScore += Math.max(0, wq[bkt] - (wc[bkt] || 0)) * 8;
          }
        });
      });

      // Off-day violations
      assignments.forEach(a => {
        if (pgrData[a.pgrId].offDays.has(a.date)) totalScore += 5;
      });

      // Consecutive duty violations in final state
      allPGRs.forEach(p => {
        const dates = [...assignedDates[p.id]].sort();
        let run = 1;
        for (let i = 1; i < dates.length; i++) {
          const prev = new Date(dates[i - 1] + 'T00:00:00');
          prev.setDate(prev.getDate() + 1);
          if (prev.toISOString().slice(0, 10) === dates[i]) {
            run++;
            if (run > 3) totalScore += 200; // hard violation
            else if (run === 3) totalScore += 30;
          } else {
            run = 1;
          }
        }
      });

      // Double-bay penalty
      assignments.forEach(a => {
        if ((bayCount[`${a.pgrId}|${a.date}|${a.shift}`] || 0) > 1) totalScore += 10;
      });

      return { assignments, totalScore, dutyCounted, nightCount, wkndCount };
    }

    // ── Run iterations, keep best result ──────────────────────────────────────
    const ITERATIONS = 80;
    let bestRoster    = null;
    let bestScore     = Infinity;
    let bestFinalState = null;

    for (let iter = 0; iter < ITERATIONS; iter++) {
      const result = generateIteration();
      if (result.totalScore < bestScore) {
        bestScore      = result.totalScore;
        bestRoster     = result.assignments;
        bestFinalState = { dutyCounted: result.dutyCounted, nightCount: result.nightCount, wkndCount: result.wkndCount };
      }
    }

    if (!bestRoster || !bestRoster.length) {
      alert('Auto-generation failed — no valid roster found.\nCheck PGR count, duty caps, and bay exclusions.');
      return;
    }

    // ── Commit best roster to DB ───────────────────────────────────────────────
    bestRoster.forEach(a => DB.assignShift(a));

    // ── Post-commit alerts ─────────────────────────────────────────────────────
    // Off-day violations
    const offDayNames = [...new Set(
      bestRoster
        .filter(a => pgrData[a.pgrId].offDays.has(a.date))
        .map(a => DB.getPGR(a.pgrId)?.name || a.pgrId)
    )];
    if (offDayNames.length) {
      DB.addAlert('warn', `Off-day violated for: ${offDayNames.join(', ')}. No better candidate was available.`);
    }

    // Double-bay assignments (Pass 2 fallback)
    const finalBayCounts = {};
    bestRoster.forEach(a => {
      const bk = `${a.pgrId}|${a.date}|${a.shift}`;
      finalBayCounts[bk] = (finalBayCounts[bk] || 0) + 1;
    });
    const doubleBayNames = [...new Set(
      Object.entries(finalBayCounts)
        .filter(([, v]) => v > 1)
        .map(([k]) => DB.getPGR(k.split('|')[0])?.name || k.split('|')[0])
    )];
    if (doubleBayNames.length) {
      DB.addAlert('warn', `Double-bay assigned for: ${doubleBayNames.join(', ')}. No single-bay candidate was available (Pass 2 fallback).`);
    }

    // Unmet duty targets
    allPGRs.forEach(p => {
      const done   = bestFinalState.dutyCounted[p.id]?.size || 0;
      const needed = pgrData[p.id].dutyMax;
      if (done < needed) {
        DB.addAlert('info', `${p.name}: ${done}/${needed} duties filled — not enough eligible slots remain.`);
      }
    });

    const skippedCount = allSlots.filter(s =>
      !bestRoster.some(a => a.date === s.date && a.shift === s.shiftId && a.unitId === s.unitId)
    ).length;
    if (skippedCount > 0) {
      DB.addAlert('info', `${skippedCount} slot(s) left unassigned after ${ITERATIONS} iterations. Fill manually.`);
    }

    ValidationEngine.validateMonth(ym);
    UI.refreshAlerts();
    render();
    alert(`Auto-generation complete: ${bestRoster.length} assignments created (best of ${ITERATIONS} iterations).`);
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
    autoGenerate, runAutoGenerate, exportCSV, exportWord,
    clearRoster, selectForSwap, cancelSwap,
    selectPGRPanel, refreshIfActive, toggleSidePanel,
  };
})();
