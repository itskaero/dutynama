/**
 * db.js — Firestore data layer with in-memory cache
 *
 * All READS are synchronous (from cache — loaded once on login).
 * All WRITES update cache immediately then fire Firestore async.
 * Real-time listeners keep the cache in sync across sessions.
 *
 * Collections: users, pendingUsers, roster, leaves, prefs,
 *              alerts, config (doc: main), carryFwd
 */

const DB = (() => {

  // Shorthand to get Firestore instance
  function fs() { return firebase.firestore(); }

  // ── In-memory cache ────────────────────────────────────
  const C = {
    users:    [],   // all PGR profiles
    roster:   [],
    leaves:   [],
    prefs:    [],
    alerts:   [],
    config:   null,
    carryFwd: {},   // { 'pgrId_YYYY-MM': delta }
  };

  const _unsubs = [];  // Firestore listener unsubscribe functions

  // ── UID helper ─────────────────────────────────────────
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  // ── Init: load all data from Firestore + attach listeners ─
  async function init() {
    console.log('[DB] init(): fetching config/main');
    const cfgSnap = await fs().doc('config/main').get();
    C.config = cfgSnap.exists ? cfgSnap.data() : _defaultConfig();
    console.log('[DB] init(): config loaded, exists:', cfgSnap.exists);

    // All parallel fetches (alerts loaded without orderBy to avoid index delays;
    // sorted client-side in getAlerts())
    console.log('[DB] init(): fetching all collections in parallel');
    const [usersSnap, rosterSnap, leavesSnap, prefsSnap, alertsSnap, cfwdSnap] =
      await Promise.all([
        fs().collection('users').get().then(s    => { console.log('[DB] init(): users fetched, count:', s.size); return s; }),
        fs().collection('roster').get().then(s   => { console.log('[DB] init(): roster fetched, count:', s.size); return s; }),
        fs().collection('leaves').get().then(s   => { console.log('[DB] init(): leaves fetched, count:', s.size); return s; }),
        fs().collection('prefs').get().then(s    => { console.log('[DB] init(): prefs fetched, count:', s.size); return s; }),
        fs().collection('alerts').limit(200).get().then(s => { console.log('[DB] init(): alerts fetched, count:', s.size); return s; }),
        fs().collection('carryFwd').get().then(s => { console.log('[DB] init(): carryFwd fetched, count:', s.size); return s; }),
      ]);

    C.users    = usersSnap.docs.map(_norm);
    C.roster   = rosterSnap.docs.map(d => d.data());
    C.leaves   = leavesSnap.docs.map(d => d.data());
    C.prefs    = prefsSnap.docs.map(d => d.data());
    C.alerts   = alertsSnap.docs.map(d => d.data());
    C.carryFwd = {};
    cfwdSnap.docs.forEach(d => { C.carryFwd[d.id] = d.data().value; });

    console.log('[DB] init(): attaching real-time listeners');
    // Real-time listeners
    _unsubs.push(
      fs().collection('users').onSnapshot(
        s => { C.users = s.docs.map(_norm); UI.refreshAlerts?.(); },
        e => console.error('[DB] users listener error:', e)
      ),
      fs().collection('roster').onSnapshot(
        s => {
          C.roster = s.docs.map(d => d.data());
          if (typeof RosterEngine !== 'undefined') RosterEngine.refreshIfActive?.();
        },
        e => console.error('[DB] roster listener error:', e)
      ),
      fs().collection('leaves').onSnapshot(
        s => { C.leaves = s.docs.map(d => d.data()); },
        e => console.error('[DB] leaves listener error:', e)
      ),
      fs().collection('alerts').limit(200).onSnapshot(
        s => { C.alerts = s.docs.map(d => d.data()); UI.refreshAlerts?.(); },
        e => console.error('[DB] alerts listener error:', e)
      ),
    );
    console.log('[DB] init(): complete');
  }

  // Normalize a Firestore users doc: ensure .id === .uid
  function _norm(doc) {
    const d = doc.data();
    d.uid = d.uid || doc.id;
    d.id  = d.uid;
    return d;
  }

  function teardown() {
    _unsubs.forEach(u => u());
    _unsubs.length = 0;
    // Clear cache
    C.users = []; C.roster = []; C.leaves = []; C.prefs = [];
    C.alerts = []; C.config = null; C.carryFwd = {};
  }

  // ── DEFAULT CONFIG ─────────────────────────────────────
  function _defaultConfig() {
    return {
      units: [
        { id: 'ER',      name: 'ER'      },
        { id: 'HDU',     name: 'HDU'     },
        { id: 'Nursery', name: 'Nursery' },
        { id: 'PICU',    name: 'PICU'    },
      ],
      shiftMode: 3, maxBaysPerPGR: 2, minDutiesPerMonth: 8,
      numYears: 4,
      yearMinDuties: { 1: 8, 2: 8, 3: 8, 4: 8 },
    };
  }

  // ── CONFIG ─────────────────────────────────────────────
  function getConfig()    { return C.config || _defaultConfig(); }
  function getUnits()     { return getConfig().units; }
  // Returns [1, 2, …, numYears] — the set of valid training years
  function getYears()     { return Array.from({ length: getConfig().numYears || 4 }, (_, i) => i + 1); }
  function getShifts() {
    return getConfig().shiftMode === 2
      ? [{ id:'Day',     label:'Day',     hours:12 },
         { id:'Night',   label:'Night',   hours:12 }]
      : [{ id:'Morning', label:'Morning', hours:6  },
         { id:'Evening', label:'Evening', hours:6  },
         { id:'Night',   label:'Night',   hours:12 }];
  }
  async function saveConfig(cfg) {
    C.config = cfg;
    await fs().doc('config/main').set(cfg);
  }

  // Returns the effective min duties for a PGR: individual override → year default → global default
  function getEffectiveMinDuties(pgr) {
    if (pgr.minDuties != null) return pgr.minDuties;
    const cfg = getConfig();
    const yd  = cfg.yearMinDuties || {};
    if (pgr.year && yd[pgr.year] != null) return yd[pgr.year];
    return cfg.minDutiesPerMonth;
  }

  // ── PGRs ───────────────────────────────────────────────
  function getPGRs()     { return C.users; }
  function getPGR(id)    { return C.users.find(p => p.id === id || p.uid === id) || null; }

  async function upsertPGR(pgr) {
    pgr.id  = pgr.uid || pgr.id;
    pgr.uid = pgr.id;
    const idx = C.users.findIndex(p => p.id === pgr.id);
    if (idx >= 0) C.users[idx] = pgr; else C.users.push(pgr);
    await fs().collection('users').doc(pgr.id).set(pgr, { merge: true });
  }

  async function deletePGR(id) {
    C.users = C.users.filter(p => p.id !== id);
    await fs().collection('users').doc(id).delete();
  }

  // ── PENDING USERS (invites) ────────────────────────────
  async function getPendingUsers() {
    const snap = await fs().collection('pendingUsers').get();
    return snap.docs.map(d => ({ _docId: d.id, ...d.data() }));
  }

  async function addPendingUser({ name, email, role, year, minDuties, createdBy }) {
    const ref = fs().collection('pendingUsers').doc();
    await ref.set({
      name,
      email: email.toLowerCase(),
      role,
      year:      year || null,
      minDuties: minDuties ?? null,
      createdBy,
      createdAt: new Date().toISOString(),
    });
    return ref.id;
  }

  async function deletePendingUser(docId) {
    await fs().collection('pendingUsers').doc(docId).delete();
  }

  // ── ROSTER ─────────────────────────────────────────────
  function getRoster()          { return C.roster; }
  function getRosterForMonth(ym)  { return C.roster.filter(r => r.date.startsWith(ym)); }
  function getRosterForDate(date) { return C.roster.filter(r => r.date === date); }

  async function assignShift(entry) {
    const existing = C.roster.find(r =>
      r.date === entry.date && r.shift === entry.shift &&
      r.unitId === entry.unitId && r.pgrId === entry.pgrId);
    if (existing) return existing;

    entry.id           = uid();
    entry.replaced     = false;
    entry.replacedBy   = null;
    entry.replacedNote = '';
    C.roster.push(entry);
    await fs().collection('roster').doc(entry.id).set(entry);
    return entry;
  }

  async function upsertRosterEntry(entry) {
    if (!entry.id) entry.id = uid();
    const idx = C.roster.findIndex(r => r.id === entry.id);
    if (idx >= 0) C.roster[idx] = entry; else C.roster.push(entry);
    await fs().collection('roster').doc(entry.id).set(entry, { merge: true });
    return entry;
  }

  async function deleteRosterEntry(id) {
    C.roster = C.roster.filter(r => r.id !== id);
    await fs().collection('roster').doc(id).delete();
  }

  function countDutiesForPGR(pgrId, ym) {
    const entries = getRosterForMonth(ym).filter(r => r.pgrId === pgrId);
    return new Set(entries.map(r => `${r.date}|${r.shift}`)).size;
  }

  // Legacy alias kept for compatibility
  async function removeShift(date, shift, unitId, pgrId) {
    const entry = C.roster.find(r =>
      r.date === date && r.shift === shift && r.unitId === unitId && r.pgrId === pgrId);
    if (entry) await deleteRosterEntry(entry.id);
  }

  // Batch save all roster entries (used by autoGenerate)
  async function saveRoster(list) {
    C.roster = list;
    const batch = fs().batch();
    list.forEach(e => batch.set(fs().collection('roster').doc(e.id), e));
    await batch.commit();
  }

  // ── LEAVES ─────────────────────────────────────────────
  function getLeaves()            { return C.leaves; }
  function getLeavesForPGR(pgrId)   { return C.leaves.filter(l => l.pgrId === pgrId); }
  function getLeavesForMonth(ym)    { return C.leaves.filter(l => l.date.startsWith(ym)); }
  function getLeavesForDate(date)   { return C.leaves.filter(l => l.date === date && l.status === 'approved'); }
  function isOnLeave(pgrId, date)   {
    return C.leaves.some(l => l.pgrId === pgrId && l.date === date && l.status === 'approved');
  }

  async function applyLeave(pgrId, date, note = '') {
    if (C.leaves.find(l => l.pgrId === pgrId && l.date === date)) return null;
    const entry = { id: uid(), pgrId, date, status: 'pending', note,
                    appliedAt: new Date().toISOString() };
    C.leaves.push(entry);
    await fs().collection('leaves').doc(entry.id).set(entry);
    return entry;
  }

  async function addLeave(pgrId, date, note = '', status = 'approved') {
    // Admin-created leave — goes in directly with given status
    if (C.leaves.find(l => l.pgrId === pgrId && l.date === date)) return null;
    const entry = { id: uid(), pgrId, date, status, note,
                    appliedAt: new Date().toISOString() };
    C.leaves.push(entry);
    await fs().collection('leaves').doc(entry.id).set(entry);
    return entry;
  }

  async function updateLeaveStatus(leaveId, status) {
    const l = C.leaves.find(x => x.id === leaveId);
    if (l) {
      l.status = status;
      await fs().collection('leaves').doc(leaveId).update({ status });
    }
  }

  async function deleteLeave(leaveId) {
    C.leaves = C.leaves.filter(l => l.id !== leaveId);
    await fs().collection('leaves').doc(leaveId).delete();
  }

  // ── PREFERENCES ────────────────────────────────────────
  function getPrefForPGR(pgrId) {
    return C.prefs.find(p => p.pgrId === pgrId) || { pgrId, offDays: [] };
  }

  async function savePrefForPGR(pgrId, offDays) {
    C.prefs = C.prefs.filter(p => p.pgrId !== pgrId);
    const entry = { pgrId, offDays };
    C.prefs.push(entry);
    await fs().collection('prefs').doc(pgrId).set(entry);
  }

  // ── ALERTS ─────────────────────────────────────────────
  // Sorted newest-first client-side (avoids requiring a Firestore index)
  function getAlerts()       { return [...C.alerts].sort((a, b) => b.date.localeCompare(a.date)); }
  function unseenAlertCount(){ return C.alerts.filter(a => !a.seen).length; }

  function addAlert(type, message) {
    const entry = { id: uid(), type, message, date: new Date().toISOString(), seen: false };
    C.alerts.unshift(entry);
    fs().collection('alerts').doc(entry.id).set(entry).catch(console.error);
  }

  async function markAlertsSeen() {
    const unseen = C.alerts.filter(a => !a.seen);
    unseen.forEach(a => { a.seen = true; });
    if (!unseen.length) return;
    const batch = fs().batch();
    unseen.forEach(a => batch.update(fs().collection('alerts').doc(a.id), { seen: true }));
    await batch.commit();
  }

  async function clearAlerts() {
    const ids = C.alerts.map(a => a.id);
    C.alerts = [];
    const batch = fs().batch();
    ids.forEach(id => batch.delete(fs().collection('alerts').doc(id)));
    await batch.commit();
  }

  // ── CARRY FORWARD ───────────────────────────────────────
  function getCarryFwdFor(pgrId, ym) {
    return C.carryFwd[`${pgrId}_${ym}`] || 0;
  }

  async function setCarryFwdFor(pgrId, ym, delta) {
    const key = `${pgrId}_${ym}`;
    C.carryFwd[key] = delta;
    await fs().collection('carryFwd').doc(key).set({ value: delta });
  }

  // ── Public API ─────────────────────────────────────────
  return {
    uid, init, teardown,
    // Config
    getConfig, saveConfig, getUnits, getShifts, getYears, getEffectiveMinDuties,
    // PGRs
    getPGRs, getPGR, upsertPGR, deletePGR,
    // Pending invites
    getPendingUsers, addPendingUser, deletePendingUser,
    // Roster
    getRoster, getRosterForMonth, getRosterForDate,
    assignShift, upsertRosterEntry, deleteRosterEntry,
    removeShift, saveRoster, countDutiesForPGR,
    // Leaves
    getLeaves, getLeavesForPGR, getLeavesForMonth, getLeavesForDate,
    isOnLeave, applyLeave, addLeave, updateLeaveStatus, deleteLeave,
    // Prefs
    getPrefForPGR, savePrefForPGR,
    // Alerts
    getAlerts, addAlert, markAlertsSeen, clearAlerts, unseenAlertCount,
    // Carry forward
    getCarryFwdFor, setCarryFwdFor,
  };
})();
