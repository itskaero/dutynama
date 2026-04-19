/**
 * preferences.js — Preferred off-day selection (calendar picker)
 */

const Preferences = (() => {

  let _selected = new Set();

  function render() {
    const user = Auth.currentUser();
    const ym   = RosterEngine.currentYM();
    const pref = DB.getPrefForPGR(user.id);
    _selected  = new Set(pref.offDays.filter(d => d.startsWith(ym)));

    const [year, month] = ym.split('-').map(Number);
    const daysInMonth   = new Date(year, month, 0).getDate();
    const firstDay      = new Date(year, month - 1, 1).getDay();

    let html = `<p>Month: <strong>${new Date(year, month-1, 1).toLocaleString('default',{month:'long',year:'numeric'})}</strong></p>`;
    html += `<div class="pref-cal-header">`;
    ['Su','Mo','Tu','We','Th','Fr','Sa'].forEach(d => html += `<div>${d}</div>`);
    html += `</div><div class="pref-cal-grid">`;

    for (let i = 0; i < firstDay; i++) html += `<div></div>`;
    for (let d = 1; d <= daysInMonth; d++) {
      const date = `${ym}-${String(d).padStart(2,'0')}`;
      const sel  = _selected.has(date);
      html += `<div class="pref-day ${sel ? 'pref-selected' : ''}" onclick="Preferences.toggle('${date}')">${d}</div>`;
    }
    html += `</div>`;
    document.getElementById('pref-calendar').innerHTML = html;
  }

  function toggle(date) {
    if (_selected.has(date)) _selected.delete(date);
    else _selected.add(date);

    const el = document.querySelector(`.pref-day[onclick*="${date}"]`);
    if (el) el.classList.toggle('pref-selected');
  }

  function save() {
    const user = Auth.currentUser();
    const ym   = RosterEngine.currentYM();
    const pref = DB.getPrefForPGR(user.id);

    // Merge: keep other months' off days, replace current month
    const otherMonths = pref.offDays.filter(d => !d.startsWith(ym));
    DB.savePrefForPGR(user.id, [...otherMonths, ..._selected]);
    alert('Preferences saved!');
  }

  return { render, toggle, save };
})();
