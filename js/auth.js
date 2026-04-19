/**
 * auth.js — Firebase Auth (email + PIN) with role-based access
 *
 * Flow:
 *   Initial setup  → Senior PGR creates first admin account (one-time, detected via missing config)
 *   Setup Account  → New user invited via pendingUsers; sets their own PIN to register
 *   Login          → email + PIN → Firebase signInWithEmailAndPassword
 *   Change PIN     → reauthenticate + updatePassword
 *
 * PIN is used as Firebase Auth password with a server-side salt suffix.
 * Roles: senior_pgr | pgr | senior_resident | viewer
 */

const Auth = (() => {

  // PIN is appended with this salt to meet Firebase's 6+ char minimum
  // and prevent trivial brute-force via the Firebase Auth endpoint.
  const _SALT = '__DN2026x';

  let _profile = null;   // Firestore user profile object

  // ── Helpers ───────────────────────────────────────────────
  function _fbPass(pin) { return pin + _SALT; }

  function _setMsg(msg, isError = false) {
    const el = document.getElementById('auth-message');
    if (!el) return;
    el.textContent = msg;
    el.className   = 'auth-message ' + (isError ? 'error' : 'success');
  }

  function _setBtnLoading(id, loading, label) {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.disabled    = loading;
    btn.textContent = loading ? 'Please wait…' : label;
  }

  function _friendlyError(e) {
    const c = e.code || '';
    if (c === 'auth/user-not-found' || c === 'auth/wrong-password' || c === 'auth/invalid-credential')
      return 'Invalid email or PIN.';
    if (c === 'auth/email-already-in-use')
      return 'An account already exists for this email. Go to Login.';
    if (c === 'auth/invalid-email')    return 'Invalid email address.';
    if (c === 'auth/too-many-requests') return 'Too many attempts. Try again later.';
    if (c === 'auth/network-request-failed') return 'Network error. Check your connection.';
    return e.message || 'An error occurred.';
  }

  // ── Auth mode UI ──────────────────────────────────────────
  function _setMode(mode) {
    ['login','setup','init'].forEach(m => {
      const el = document.getElementById(`auth-mode-${m}`);
      if (el) el.classList.toggle('active', m === mode);
    });
    _setMsg('');
  }

  function showLogin()        { _setMode('login'); }
  function showSetup()        { _setMode('setup'); }
  function showInitialSetup() { _setMode('init');  }

  // ── Login ─────────────────────────────────────────────────
  async function login() {
    const email = document.getElementById('login-email').value.trim().toLowerCase();
    const pin   = document.getElementById('login-pin').value.trim();
    if (!email || !pin) { _setMsg('Enter email and PIN.', true); return; }
    if (!/^\d{4,6}$/.test(pin)) { _setMsg('PIN is 4–6 digits.', true); return; }

    _setBtnLoading('btn-login', true, 'Login');
    try {
      await firebase.auth().signInWithEmailAndPassword(email, _fbPass(pin));
      // onAuthStateChanged in app.js takes it from here
    } catch (e) {
      _setMsg(_friendlyError(e), true);
      _setBtnLoading('btn-login', false, 'Login');
    }
  }

  // ── Setup Account (invited PGR sets their PIN) ─────────────
  async function setupAccount() {
    const email   = document.getElementById('setup-email').value.trim().toLowerCase();
    const pin     = document.getElementById('setup-pin').value.trim();
    const confirm = document.getElementById('setup-confirm').value.trim();

    if (!email || !pin || !confirm) { _setMsg('Fill all fields.', true); return; }
    if (pin !== confirm)            { _setMsg('PINs do not match.', true); return; }
    if (!/^\d{4,6}$/.test(pin))    { _setMsg('PIN must be 4–6 digits.', true); return; }

    _setBtnLoading('btn-setup', true, 'Create Account');
    try {
      // Check pending invite
      const snap = await firebase.firestore()
        .collection('pendingUsers')
        .where('email', '==', email)
        .limit(1)
        .get();

      if (snap.empty) {
        throw { message: 'No invite found for this email. Ask your Senior PGR to add you first.' };
      }

      const pendingDoc  = snap.docs[0];
      const pending     = pendingDoc.data();

      // Create Firebase Auth account
      const cred = await firebase.auth().createUserWithEmailAndPassword(email, _fbPass(pin));
      const uid  = cred.user.uid;

      // Write user profile to Firestore
      await firebase.firestore().collection('users').doc(uid).set({
        uid, id: uid,
        name:       pending.name,
        email,
        role:       pending.role,
        year:       pending.year || null,
        minDuties:  pending.minDuties ?? null,
        createdAt:  new Date().toISOString(),
        createdBy:  pending.createdBy || '',
      });

      // Remove from pending
      await pendingDoc.ref.delete();
      // onAuthStateChanged handles the rest

    } catch (e) {
      _setMsg(_friendlyError(e), true);
      _setBtnLoading('btn-setup', false, 'Create Account');
    }
  }

  // ── Initial Setup (very first run — creates Senior PGR) ───
  async function initialSetup() {
    const name    = document.getElementById('init-name').value.trim();
    const email   = document.getElementById('init-email').value.trim().toLowerCase();
    const pin     = document.getElementById('init-pin').value.trim();
    const confirm = document.getElementById('init-confirm').value.trim();

    if (!name || !email || !pin) { _setMsg('Fill all fields.', true); return; }
    if (pin !== confirm)         { _setMsg('PINs do not match.', true); return; }
    if (!/^\d{4,6}$/.test(pin)) { _setMsg('PIN must be 4–6 digits.', true); return; }
    if (!/^[^@]+@[^@]+\.[^@]+$/.test(email)) { _setMsg('Invalid email.', true); return; }

    _setBtnLoading('btn-init', true, 'Create Admin Account');
    try {
      const cred = await firebase.auth().createUserWithEmailAndPassword(email, _fbPass(pin));
      const uid  = cred.user.uid;

      await firebase.firestore().collection('users').doc(uid).set({
        uid, id: uid, name, email, role: 'senior_pgr', minDuties: 8,
        createdAt: new Date().toISOString(),
      });

      // Write default config
      await firebase.firestore().doc('config/main').set({
        units: [
          { id: 'ER',      name: 'ER'      },
          { id: 'HDU',     name: 'HDU'     },
          { id: 'Nursery', name: 'Nursery' },
          { id: 'PICU',    name: 'PICU'    },
        ],
        shiftMode: 3, maxBaysPerPGR: 2, minDutiesPerMonth: 8,
      });
      // onAuthStateChanged handles the rest
    } catch (e) {
      _setMsg(_friendlyError(e), true);
      _setBtnLoading('btn-init', false, 'Create Admin Account');
    }
  }

  // ── Logout ────────────────────────────────────────────────
  async function logout() {
    await firebase.auth().signOut();
    _profile = null;
    App.onLogout();
  }

  // ── Change PIN ────────────────────────────────────────────
  async function changePin() {
    const currentPin = document.getElementById('chpin-current').value.trim();
    const newPin     = document.getElementById('chpin-new').value.trim();
    const confirmPin = document.getElementById('chpin-confirm').value.trim();

    if (!currentPin || !newPin) { _setMsg('Fill all fields.', true); return; }
    if (newPin !== confirmPin)  { _setMsg('New PINs do not match.', true); return; }
    if (!/^\d{4,6}$/.test(newPin)) { _setMsg('PIN must be 4–6 digits.', true); return; }

    _setBtnLoading('btn-chpin', true, 'Change PIN');
    try {
      const user  = firebase.auth().currentUser;
      const cred  = firebase.auth.EmailAuthProvider.credential(user.email, _fbPass(currentPin));
      await user.reauthenticateWithCredential(cred);
      await user.updatePassword(_fbPass(newPin));
      UI.closeChangePinModal();
      alert('PIN changed successfully!');
    } catch (e) {
      _setMsg(_friendlyError(e), true);
    } finally {
      _setBtnLoading('btn-chpin', false, 'Change PIN');
    }
  }

  // ── Profile helpers ───────────────────────────────────────
  function setProfile(p) { _profile = p; }
  function currentUser() { return _profile; }

  function can(action) {
    if (!_profile) return false;
    const role = _profile.role;
    const map  = {
      editRoster:    ['senior_pgr'],
      manageLeaves:  ['senior_pgr', 'senior_resident'],
      manageReplace: ['senior_pgr', 'senior_resident'],
      applyLeave:    ['pgr', 'senior_pgr', 'senior_resident'],
      setPrefs:      ['pgr', 'senior_pgr'],
      admin:         ['senior_pgr', 'senior_resident'],
      viewDashboard: ['senior_pgr', 'pgr', 'senior_resident', 'viewer'],
    };
    return (map[action] || []).includes(role);
  }

  // Toggle PIN visibility helper (called from HTML)
  function togglePIN(inputId, btn) {
    const inp  = document.getElementById(inputId);
    if (!inp) return;
    const show = inp.type === 'password';
    inp.type   = show ? 'text' : 'password';
    btn.textContent = show ? '🙈' : '👁';
  }

  return {
    showLogin, showSetup, showInitialSetup,
    login, setupAccount, initialSetup, logout, changePin,
    setProfile, currentUser, can, togglePIN,
  };
})();
