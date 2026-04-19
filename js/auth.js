/**
 * auth.js  Email + PIN authentication
 *
 * Flow:
 *   Initial setup   Senior PGR creates the first admin account (one-time) with their email.
 *   Claim Invite    Invited user uses their email (as registered by Senior PGR), sets own PIN.
 *   Login           email + PIN
 *   Change PIN      current PIN + new PIN
 *
 * Firebase Auth email = user's real email address.
 * PIN + salt is stored as the Firebase Auth password.
 * Roles: senior_pgr | pgr | senior_resident | viewer
 */

const Auth = (() => {

  const _SALT = '__DN2026x';

  let _profile = null;

  //  Helpers
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
    btn.textContent = loading ? 'Please wait' : label;
  }

  function _friendlyError(e) {
    const c = e.code || '';
    if (c === 'auth/user-not-found' || c === 'auth/wrong-password' || c === 'auth/invalid-credential')
      return 'Invalid email or PIN.';
    if (c === 'auth/email-already-in-use')
      return 'An account with this email already exists.';
    if (c === 'auth/invalid-email')     return 'Invalid email address.';
    if (c === 'auth/too-many-requests') return 'Too many attempts. Try again later.';
    if (c === 'auth/network-request-failed') return 'Network error. Check your connection.';
    return e.message || 'An error occurred.';
  }

  //  Auth mode UI 
  function _setMode(mode) {
    ['login','setup','init'].forEach(m => {
      const el = document.getElementById(`auth-mode-${m}`);
      if (el) el.classList.toggle('active', m === mode);
    });
    _setMsg('');
  }

  function showLogin()        { _setBtnLoading('btn-login', false, 'Login');                _setMode('login'); }
  function showSetup()        { _setBtnLoading('btn-setup', false, 'Create Account');       _setMode('setup'); }
  function showInitialSetup() { _setBtnLoading('btn-init',  false, 'Create Admin Account');  _setMode('init'); }

  //  Login
  async function login() {
    const email = document.getElementById('login-email').value.trim().toLowerCase();
    const pin   = document.getElementById('login-pin').value.trim();

    if (!email || !pin) { _setMsg('Enter email and PIN.', true); return; }
    if (!/^\d{4,6}$/.test(pin)) { _setMsg('PIN must be 4–6 digits.', true); return; }

    console.log('[Auth] login(): email =', email);
    _setBtnLoading('btn-login', true, 'Login');
    try {
      await firebase.auth().signInWithEmailAndPassword(email, _fbPass(pin));
      console.log('[Auth] login(): Firebase Auth OK — handoff to onAuthStateChanged');
    } catch (e) {
      console.warn('[Auth] login(): failed', e.code, e.message);
      _setMsg(_friendlyError(e), true);
      _setBtnLoading('btn-login', false, 'Login');
    }
  }

  //  Claim Invite (invited user sets their own PIN)
  async function setupAccount() {
    const email   = document.getElementById('setup-email').value.trim().toLowerCase();
    const pin     = document.getElementById('setup-pin').value.trim();
    const confirm = document.getElementById('setup-confirm').value.trim();

    if (!email || !pin || !confirm)  { _setMsg('Fill all fields.', true); return; }
    if (pin !== confirm)             { _setMsg('PINs do not match.', true); return; }
    if (!/^\d{4,6}$/.test(pin))     { _setMsg('PIN must be 4–6 digits.', true); return; }
    if (!/^[^@]+@[^@]+\.[^@]+$/.test(email)) { _setMsg('Enter a valid email address.', true); return; }

    console.log('[Auth] setupAccount(): email =', email);
    _setBtnLoading('btn-setup', true, 'Create Account');
    try {
      // Find invite by email field
      console.log('[Auth] setupAccount(): querying invite doc by email');
      const snap = await firebase.firestore()
        .collection('pendingUsers').where('email', '==', email).limit(1).get();

      if (snap.empty) {
        throw { message: 'No invite found for this email. Ask your Senior PGR to invite you.' };
      }
      const inviteSnap = snap.docs[0];
      const invite     = inviteSnap.data();
      console.log('[Auth] setupAccount(): invite valid —', invite.name, 'role:', invite.role);

      // Build profile — uid filled in after Firebase Auth account is created
      const profileData = {
        uid: null, id: null,
        email,
        name:      invite.name,
        role:      invite.role,
        year:      invite.year || null,
        minDuties: invite.minDuties ?? null,
        createdAt: new Date().toISOString(),
        createdBy: invite.createdBy || '',
      };

      //  CRITICAL: set profile BEFORE the first await so that the
      // onAuthStateChanged callback (which fires as soon as
      // createUserWithEmailAndPassword resolves) sees currentUser() as
      // non-null and skips its own login sequence.
      Auth.setProfile(profileData);

      console.log('[Auth] setupAccount(): creating Firebase Auth account');
      const cred = await firebase.auth()
        .createUserWithEmailAndPassword(email, _fbPass(pin));
      const uid  = cred.user.uid;
      profileData.uid = uid;
      profileData.id  = uid;

      console.log('[Auth] setupAccount(): writing Firestore profile uid =', uid);
      await firebase.firestore().collection('users').doc(uid).set(profileData);

      console.log('[Auth] setupAccount(): deleting invite doc');
      await inviteSnap.ref.delete();

      console.log('[Auth] setupAccount(): calling DB.init()');
      await DB.init();

      console.log('[Auth] setupAccount(): calling App.onLogin()');
      App.onLogin(profileData);

    } catch (e) {
      console.error('[Auth] setupAccount(): error ', e.code || '', e.message);
      _profile = null; // reset guard so onAuthStateChanged can still clean up
      _setMsg(_friendlyError(e), true);
      _setBtnLoading('btn-setup', false, 'Create Account');
    }
  }

  //  Initial Setup (very first run — creates Senior PGR)
  async function initialSetup() {
    const name    = document.getElementById('init-name').value.trim();
    const email   = document.getElementById('init-email').value.trim().toLowerCase();
    const pin     = document.getElementById('init-pin').value.trim();
    const confirm = document.getElementById('init-confirm').value.trim();

    if (!name || !email || !pin) { _setMsg('Fill all fields.', true); return; }
    if (pin !== confirm)         { _setMsg('PINs do not match.', true); return; }
    if (!/^\d{4,6}$/.test(pin)) { _setMsg('PIN must be 4–6 digits.', true); return; }
    if (!/^[^@]+@[^@]+\.[^@]+$/.test(email)) { _setMsg('Enter a valid email address.', true); return; }

    console.log('[Auth] initialSetup(): name =', name, '| email =', email);
    _setBtnLoading('btn-init', true, 'Create Admin Account');
    try {
      const profileData = {
        uid: null, id: null,
        email, name,
        role: 'senior_pgr', minDuties: 8,
        createdAt: new Date().toISOString(),
      };

      //  CRITICAL: set profile guard BEFORE first await
      Auth.setProfile(profileData);

      console.log('[Auth] initialSetup(): creating Firebase Auth account');
      const cred = await firebase.auth()
        .createUserWithEmailAndPassword(email, _fbPass(pin));
      const uid  = cred.user.uid;
      profileData.uid = uid;
      profileData.id  = uid;

      console.log('[Auth] initialSetup(): writing users doc uid =', uid);
      await firebase.firestore().collection('users').doc(uid).set(profileData);

      console.log('[Auth] initialSetup(): writing config/main');
      await firebase.firestore().doc('config/main').set({
        units: [
          { id: 'ER',      name: 'ER'      },
          { id: 'HDU',     name: 'HDU'     },
          { id: 'Nursery', name: 'Nursery' },
          { id: 'PICU',    name: 'PICU'    },
        ],
        shiftMode: 3, maxBaysPerPGR: 2, minDutiesPerMonth: 8,
      });

      console.log('[Auth] initialSetup(): calling DB.init()');
      await DB.init();

      console.log('[Auth] initialSetup(): calling App.onLogin()');
      App.onLogin(profileData);

    } catch (e) {
      console.error('[Auth] initialSetup(): error ', e.code || '', e.message);
      _profile = null; // reset guard
      _setMsg(_friendlyError(e), true);
      _setBtnLoading('btn-init', false, 'Create Admin Account');
    }
  }

  //  Logout 
  async function logout() {
    console.log('[Auth] logout()');
    await firebase.auth().signOut();
    _profile = null;
    App.onLogout();
  }

  //  Change PIN 
  async function changePin() {
    const currentPin = document.getElementById('chpin-current').value.trim();
    const newPin     = document.getElementById('chpin-new').value.trim();
    const confirmPin = document.getElementById('chpin-confirm').value.trim();

    if (!currentPin || !newPin)    { _setMsg('Fill all fields.', true); return; }
    if (newPin !== confirmPin)     { _setMsg('New PINs do not match.', true); return; }
    if (!/^\d{4,6}$/.test(newPin)){ _setMsg('PIN must be 46 digits.', true); return; }

    _setBtnLoading('btn-chpin', true, 'Change PIN');
    try {
      const user = firebase.auth().currentUser;
      const cred = firebase.auth.EmailAuthProvider.credential(user.email, _fbPass(currentPin));
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

  //  Profile helpers 
  function setProfile(p)  { _profile = p; }
  function currentUser()  { return _profile; }

  function can(action) {
    if (!_profile) return false;
    const role = _profile.role;
    const map  = {
      editRoster:    ['senior_pgr'],
      manageLeaves:  ['senior_resident'],
      manageReplace: ['senior_resident'],
      applyLeave:    ['senior_resident'],
      setPrefs:      ['pgr', 'senior_pgr'],
      admin:         ['senior_pgr', 'senior_resident'],
      viewDashboard: ['senior_pgr', 'pgr', 'senior_resident', 'viewer'],
    };
    return (map[action] || []).includes(role);
  }

  function togglePIN(inputId, btn) {
    const inp  = document.getElementById(inputId);
    if (!inp) return;
    const show = inp.type === 'password';
    inp.type   = show ? 'text' : 'password';
    btn.textContent = show ? '' : '';
  }

  function showAuthError(msg) { _setMsg(msg, true); }

  return {
    showLogin, showSetup, showInitialSetup,
    login, setupAccount, initialSetup, logout, changePin,
    setProfile, currentUser, can, togglePIN, showAuthError,
  };
})();
