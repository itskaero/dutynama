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

    // ── DETAIL VIEW ───────────────────────────────────────
    if (_selectedPGRId) {
      const p = pgrs.find(x => x.id === _selectedPGRId);
      if (!p) { _selectedPGRId = null; }  // PGR removed — fall through to list
      else {
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
        const shifts    = DB.getShifts(); // needed for label→abbreviation lookup

        // Group roster entries by date+shift
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
            // Use the actual shift label from DB for abbreviation — never hardcode IDs
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

        el.innerHTML = `
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

        return;
      }
    }

    // ── LIST VIEW ─────────────────────────────────────────
    const sorted = [...pgrs].sort((a, b) => {
      const da = dutySet[a.id]?.size || 0, db = dutySet[b.id]?.size || 0;
      if (da !== db) return da - db;
      return (a.year || 99) - (b.year || 99);
    });

    let html = `<div class="pgr-panel-heading">Team &mdash; ${monthLabel} <span class="pgr-panel-hint">(click name to inspect)</span></div>`;

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
    el.innerHTML = html;
  }

  // Select a PGR for detail view; toggle off if same PGR clicked again
  function selectPGRPanel(pgrId) {
    _selectedPGRId = (_selectedPGRId === pgrId) ? null : pgrId;
    _renderPGRPanel();
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

  // Step 3: actual generation engine
  function _doAutoGenerate(moSkipped) {
    const ym          = currentYM();
    const existing    = DB.getRosterForMonth(ym);
    const [calYear, month] = ym.split('-').map(Number);
    const daysInMonth = new Date(calYear, month, 0).getDate();
    let   pgrs        = DB.getPGRs().filter(p => ['pgr','senior_pgr'].includes(p.role));
    const units       = DB.getUnits();
    const shifts      = DB.getShifts();

    if (!pgrs.length)  { alert('No PGRs available.'); return; }
    if (!units.length) { alert('No units configured.'); return; }

    // Fisher-Yates shuffle — different roster each run (tiebreaks vary)
    for (let i = pgrs.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pgrs[i], pgrs[j]] = [pgrs[j], pgrs[i]];
    }

    // ── Per-PGR state ────────────────────────────────────
    const offDays = {};
    pgrs.forEach(p => {
      const all = DB.getEffectiveOffDays(p.id);
      offDays[p.id] = new Set(all.filter(d => d.startsWith(ym)));
    });

    const allUnitIds   = units.map(u => u.id);
    const bayPrio      = {};
    const excludedBays = {};
    pgrs.forEach(p => {
      const pref         = DB.getPrefForPGR(p.id);
      excludedBays[p.id] = new Set(pref.excludedBays || []);
      const saved        = (pref.bayPriorities || []).filter(id => !excludedBays[p.id].has(id));
      bayPrio[p.id]      = [
        ...saved.filter(id => allUnitIds.includes(id)),
        ...allUnitIds.filter(id => !saved.includes(id) && !excludedBays[p.id].has(id)),
      ];
    });

    const nightTarget = {};
    const dutyMax     = {}; // minDuties = auto-assign ceiling
    const maxBays     = DB.getConfig().maxBaysPerPGR || 2;
    pgrs.forEach(p => {
      nightTarget[p.id] = DB.getEffectiveNightTarget(p);
      dutyMax[p.id]     = DB.getEffectiveMinDuties(p);
    });

    // Duty count = unique date|shift pairs (one PGR working 2 bays same shift = 1 duty)
    const dutyCounted    = {}; // pgrId -> Set<'date|shift'>
    const assignedDates  = {}; // pgrId -> Set<date>
    const dateToShift    = {}; // `pgrId|date` -> shift.id already on that date
    const nightCount     = {};
    const bayCount       = {}; // `pgrId|date|shift` -> number of units already assigned

    pgrs.forEach(p => {
      const entries         = existing.filter(r => r.pgrId === p.id);
      dutyCounted[p.id]    = new Set(entries.map(r => `${r.date}|${r.shift}`));
      assignedDates[p.id]  = new Set(entries.map(r => r.date));
      nightCount[p.id]     = entries.filter(r => r.shift === 'Night').length;
      entries.forEach(r => {
        const dk = `${p.id}|${r.date}`;
        if (!dateToShift[dk]) dateToShift[dk] = r.shift;
        const bk = `${p.id}|${r.date}|${r.shift}`;
        bayCount[bk] = (bayCount[bk] || 0) + 1;
      });
    });

    // Returns how many consecutive calendar days ending on `date-1` the PGR is already assigned
    function consecutiveBefore(pgrId, date) {
      let count = 0;
      const d = new Date(date + 'T00:00:00');
      d.setDate(d.getDate() - 1);
      while (assignedDates[pgrId].has(d.toISOString().slice(0, 10))) {
        count++;
        d.setDate(d.getDate() - 1);
      }
      return count;
    }

    // Sort within a pool: year → duty count → bay pref → off-day avoidance
    // Night quota is checked first. Within same year, fewest duties first so
    // Year 1 PGRs are exhausted before Year 2, Year 2 before Year 3, etc.
    function sortPool(pool, unitId, isNight, date) {
      pool.sort((a, b) => {
        // 1. Night quota
        const aNeedsNight = nightTarget[a.id] > 0 && nightCount[a.id] < nightTarget[a.id];
        const bNeedsNight = nightTarget[b.id] > 0 && nightCount[b.id] < nightTarget[b.id];
        if (isNight) {
          if ( aNeedsNight && !bNeedsNight) return -1;
          if (!aNeedsNight &&  bNeedsNight) return  1;
        } else {
          if (!aNeedsNight &&  bNeedsNight) return -1;
          if ( aNeedsNight && !bNeedsNight) return  1;
        }
        // 2. Year — lower year assigned first (Year 1 → 2 → 3 → 4)
        const aY = a.year || 99, bY = b.year || 99;
        if (aY !== bY) return aY - bY;
        // 3. Duty count within same year — fewest first for even distribution
        const dDiff = dutyCounted[a.id].size - dutyCounted[b.id].size;
        if (dDiff !== 0) return dDiff;
        // 4. Bay preference
        const ai = bayPrio[a.id].indexOf(unitId), bi = bayPrio[b.id].indexOf(unitId);
        if (ai !== bi) return ai - bi;
        return 0;
      });
    }

    // Hard-constraint check.
    // maxBaysForSlot — how many bays this PGR may occupy in this shift today:
    //   Pass 1 sets this to 1 (one bay per PGR per shift, broad first-fill).
    //   Pass 2 sets this to config maxBays (fill remaining gaps).
    // Exclusions, duty cap, consecutive limit, one-shift-per-day always enforced.
    function hardFilter(p, unitId, date, shiftId, maxBaysForSlot) {
      if (excludedBays[p.id].has(unitId)) return false;
      if (dutyCounted[p.id].size >= dutyMax[p.id]) return false;
      if (consecutiveBefore(p.id, date) >= 3) return false;
      const existingShift = dateToShift[`${p.id}|${date}`];
      if (existingShift && existingShift !== shiftId) return false;
      if ((bayCount[`${p.id}|${date}|${shiftId}`] || 0) >= maxBaysForSlot) return false;
      return true;
    }

    let assignmentCount = 0;
    let skippedCount    = 0;

    // Two-pass fill:
    //   Pass 1 (passMaxBays = 1) — give every PGR at most 1 bay per shift-day first.
    //                               Spreads duties broadly before any doubling up.
    //   Pass 2 (passMaxBays = maxBays) — fill any still-empty slots, now allowing
    //                               up to the configured bay cap per PGR per shift.
    // If maxBays is already 1, both passes are identical so only one is run.
    const passes = maxBays > 1 ? [1, maxBays] : [maxBays];

    for (const passMaxBays of passes) {
      const isLastPass = passMaxBays === passes[passes.length - 1];

      for (let d = 1; d <= daysInMonth; d++) {
        const date = `${ym}-${String(d).padStart(2,'0')}`;

        for (const shift of shifts) {
          for (const unit of units) {
            // Skip MO-covered slots
            if (moSkipped.has(`${shift.id}|${unit.id}`)) continue;

            // Already assigned (by earlier pass or pre-existing manual entry)?
            if (DB.getRosterForDate(date).find(r => r.shift === shift.id && r.unitId === unit.id)) continue;

            const isNight    = shift.id === 'Night';
            const notOnLeave = pgrs.filter(p => !DB.isOnLeave(p.id, date));

            // Pool A — strict: within passMaxBays bay limit, not on off-day
            const poolA = notOnLeave.filter(p =>
              hardFilter(p, unit.id, date, shift.id, passMaxBays) && !offDays[p.id].has(date)
            );

            // Pool B — relaxed: off-days allowed, bay limit still passMaxBays,
            // duty cap / consecutive limit / bay exclusion / one-shift-per-day enforced.
            const poolB = notOnLeave.filter(p =>
              hardFilter(p, unit.id, date, shift.id, passMaxBays)
            );

            // No eligible PGR at all — leave empty (skip counter only on last pass)
            if (!poolA.length && !poolB.length) {
              if (isLastPass) skippedCount++;
              continue;
            }

            const pool = poolA.length ? poolA : poolB;
            sortPool(pool, unit.id, isNight, date);
            const chosen = pool[0];

            if (!poolA.length && offDays[chosen.id].has(date)) {
              DB.addAlert('warn', `${chosen.name} assigned on preferred off-day ${date} (${shift.label} / ${unit.name}).`);
            }
            // Only warn about extra bay in Pass 2, since Pass 1 prevents it by design
            if (passMaxBays > 1 && (bayCount[`${chosen.id}|${date}|${shift.id}`] || 0) >= 1) {
              DB.addAlert('warn', `${chosen.name} given 2nd bay on ${date} ${shift.label} / ${unit.name} (no single-bay option left).`);
            }

            DB.assignShift({ date, shift: shift.id, unitId: unit.id, pgrId: chosen.id });

            // Update running state
            const dsKey = `${date}|${shift.id}`;
            dutyCounted[chosen.id].add(dsKey);
            assignedDates[chosen.id].add(date);
            if (!dateToShift[`${chosen.id}|${date}`]) dateToShift[`${chosen.id}|${date}`] = shift.id;
            const bk = `${chosen.id}|${date}|${shift.id}`;
            bayCount[bk] = (bayCount[bk] || 0) + 1;
            if (isNight) nightCount[chosen.id]++;
            assignmentCount++;
          }
        }
      }
    }

    if (skippedCount > 0) {
      DB.addAlert('info', `${skippedCount} slot(s) left unassigned — no eligible PGR available (duty cap or bay restriction). Fill manually.`);
    }

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
    autoGenerate, runAutoGenerate, exportCSV, exportWord,
    clearRoster, selectForSwap, cancelSwap,
    selectPGRPanel, refreshIfActive,
  };
})();
