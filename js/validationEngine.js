/**
 * validationEngine.js — All validation & alert logic
 *
 * Rules:
 *   1. Max bays per PGR per shift (default 2)
 *   2. Leave conflict — PGR assigned on leave day
 *   3. Preferred off-day violated
 *   4. Under / over duty for the month
 *   5. Weekly duty frequency (>= 4 duties in 7 days = overwork flag)
 */

const ValidationEngine = (() => {

  /**
   * Check all rules for a proposed assignment and return array of issues.
   * Does NOT block — callers decide what to do.
   *
   * @param {string} pgrId
   * @param {string} date  YYYY-MM-DD
   * @param {string} shift  Morning|Evening|Night
   * @param {string} unitId
   * @returns {Array<{severity:'error'|'warn', code:string, message:string}>}
   */
  function checkAssignment(pgrId, date, shift, unitId) {
    const issues = [];
    const cfg    = DB.getConfig();
    const pgr    = DB.getPGR(pgrId);
    if (!pgr) return issues;

    // 1. Leave conflict
    if (DB.isOnLeave(pgrId, date)) {
      issues.push({
        severity: 'error',
        code: 'LEAVE_CONFLICT',
        message: `${pgr.name} is on approved leave on ${date}. Assignment created with warning.`,
      });
    }

    // 2. Preferred off-day
    const pref = DB.getPrefForPGR(pgrId);
    if (pref.offDays.includes(date)) {
      issues.push({
        severity: 'warn',
        code: 'PREF_VIOLATION',
        message: `${pgr.name} has marked ${date} as preferred OFF. Assigning anyway.`,
      });
    }

    // 3. Max bays per shift
    const existingBays = DB.getRosterForDate(date)
      .filter(r => r.pgrId === pgrId && r.shift === shift && r.unitId !== unitId);
    const bayCount = existingBays.length + 1; // +1 for this new one
    if (bayCount > cfg.maxBaysPerPGR) {
      issues.push({
        severity: 'warn',
        code: 'OVER_ASSIGNED',
        message: `${pgr.name} will cover ${bayCount} bays in ${shift} shift on ${date} (max ${cfg.maxBaysPerPGR}).`,
      });
    }

    return issues;
  }

  /**
   * Validate full month roster and store alerts.
   * Called after auto-generate or on demand.
   * @param {string} ym  YYYY-MM
   */
  function validateMonth(ym) {
    const cfg   = DB.getConfig();
    const pgrs  = DB.getPGRs();
    const units = DB.getUnits();

    // --- Coverage check: every bay+shift+date should have ≥1 PGR ---
    const daysInMonth = new Date(
      parseInt(ym.split('-')[0]),
      parseInt(ym.split('-')[1]),
      0
    ).getDate();
    const shifts = DB.getShifts();
    const rosterEntries = DB.getRosterForMonth(ym);

    for (let d = 1; d <= daysInMonth; d++) {
      const date = `${ym}-${String(d).padStart(2,'0')}`;
      for (const shift of shifts) {
        for (const unit of units) {
          const covered = rosterEntries.some(
            r => r.date === date && r.shift === shift.id && r.unitId === unit.id
          );
          if (!covered) {
            DB.addAlert('error',
              `No PGR assigned: ${unit.name} / ${shift.label} on ${date}`);
          }
        }
      }
    }

    // --- Per-PGR duty count check ---
    for (const pgr of pgrs) {
      const minDuties = pgr.minDuties || cfg.minDutiesPerMonth;
      const actual    = DB.countDutiesForPGR(pgr.id, ym);
      if (actual < minDuties) {
        DB.addAlert('warn',
          `${pgr.name} is UNDER-ASSIGNED: ${actual}/${minDuties} duties in ${ym}`);
        // carry forward adjustment: they are owed (minDuties - actual) extra next month
        DB.setCarryFwdFor(pgr.id, ym, -(minDuties - actual));
      } else if (actual > minDuties) {
        DB.addAlert('warn',
          `${pgr.name} is OVER-ASSIGNED: ${actual}/${minDuties} duties in ${ym}`);
        DB.setCarryFwdFor(pgr.id, ym, actual - minDuties);
      }

      // Weekly overwork check
      checkWeeklyOverwork(pgr, ym);
    }
  }

  /**
   * Check if any PGR has ≥4 duties in any rolling 7-day window.
   */
  function checkWeeklyOverwork(pgr, ym) {
    const [year, month] = ym.split('-').map(Number);
    const daysInMonth   = new Date(year, month, 0).getDate();
    const entries = DB.getRosterForMonth(ym).filter(r => r.pgrId === pgr.id);

    for (let start = 1; start <= daysInMonth - 6; start++) {
      let count = 0;
      const shiftDates = new Set();
      for (let d = start; d < start + 7; d++) {
        const date = `${ym}-${String(d).padStart(2,'0')}`;
        entries
          .filter(r => r.date === date)
          .forEach(r => shiftDates.add(`${r.date}|${r.shift}`));
      }
      count = shiftDates.size;
      if (count >= 4) {
        DB.addAlert('warn',
          `${pgr.name} has ${count} duties in a 7-day window starting ${ym}-${String(start).padStart(2,'0')} — possible overwork.`);
        break; // one alert per month per PGR
      }
    }
  }

  /**
   * Validate a single leave application.
   * Returns array of issues.
   */
  function checkLeave(pgrId, date) {
    const issues = [];
    const pgr    = DB.getPGR(pgrId);
    if (!pgr) return issues;

    const ym = date.slice(0, 7);
    const existing = DB.getLeavesForPGR(pgrId).filter(
      l => l.date.startsWith(ym) && l.status !== 'rejected'
    );
    if (existing.length >= 2) {
      issues.push({
        severity: 'error',
        code: 'LEAVE_LIMIT',
        message: `${pgr.name} already has ${existing.length} leave(s) in ${ym}. Max 2 per month.`,
      });
    }

    // Already assigned on that day?
    const rosterOnDay = DB.getRosterForDate(date).filter(r => r.pgrId === pgrId);
    if (rosterOnDay.length > 0) {
      issues.push({
        severity: 'warn',
        code: 'DUTY_ON_LEAVE_DAY',
        message: `${pgr.name} has existing duty assignments on ${date}. Leave created with alert.`,
      });
    }

    return issues;
  }

  /**
   * Get overwork status for a PGR for current month.
   * Returns { overwork: bool, duties, minDuties, carryFwd, weeklyFlag }
   */
  function getOverworkStatus(pgrId, ym) {
    const pgr       = DB.getPGR(pgrId);
    const cfg       = DB.getConfig();
    const minDuties = (pgr && pgr.minDuties) || cfg.minDutiesPerMonth;
    const duties    = DB.countDutiesForPGR(pgrId, ym);
    const carryFwd  = DB.getCarryFwdFor(pgrId, ym);

    const [year, month] = ym.split('-').map(Number);
    const daysInMonth   = new Date(year, month, 0).getDate();
    const entries = DB.getRosterForMonth(ym).filter(r => r.pgrId === pgrId);
    let weeklyFlag = false;
    for (let start = 1; start <= daysInMonth - 6; start++) {
      const shiftDates = new Set();
      for (let d = start; d < start + 7; d++) {
        const date = `${ym}-${String(d).padStart(2,'0')}`;
        entries.filter(r => r.date === date).forEach(r => shiftDates.add(`${r.date}|${r.shift}`));
      }
      if (shiftDates.size >= 4) { weeklyFlag = true; break; }
    }

    return {
      overwork:   duties > minDuties || weeklyFlag,
      underwork:  duties < minDuties,
      duties,
      minDuties,
      carryFwd,
      weeklyFlag,
    };
  }

  return {
    checkAssignment,
    checkLeave,
    validateMonth,
    getOverworkStatus,
  };
})();
