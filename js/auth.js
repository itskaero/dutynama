/**
 * auth.js  Username + PIN authentication
 *
 * Flow:
 *   Initial setup   Senior PGR creates the first admin account (one-time).
 *   Claim Invite    Invited user uses username + setup code given by Senior PGR, sets own PIN.
 *   Login           username + PIN
 *   Change PIN      current PIN + new PIN
 *
 * Usernames are mapped to Firebase Auth emails internally:
 *   {username}@dutynama.local  (never shown to users  purely a Firebase Auth key)
 *
 * PIN + salt is stored as the Firebase Auth password.
 * Roles: senior_pgr | pgr | senior_resident | viewer
 *
 * Senior PGR responsibilities:
 *   - Creates invites for all new users (any role) from the Admin panel.
 *   - Can transfer Senior PGR role to any other user.
 *   - Invited users receive a username + 6-char setup code from the Senior PGR.
 */

const Auth = (() => {

  const _DOMAIN = '@dutynama.local';
  const _SALT   = '__DN2026x';

  let _profile = null;

  //  Helpers 
  function _userEmail(username) { return username.toLowerCase() + _DOMAIN; }
  function _fbPass(pin)         { return pin + _SALT; }

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
      return 'Invalid username or PIN.';
    if (c === 'auth/email-already-in-use')
      return 'This username is already taken.';
    if (c === 'auth/invalid-email')     return 'Invalid username format.';
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

  function showLogin()        { _setBtnLoading('btn-login', false, 'Login');               _setMode('login'); }
  function showSetup()        { _setBtnLoading('btn-setup', false, 'Create Account');      _setMode('setup'); }
  function showInitialSetup() { _setBtnLoading('btn-init',  false, 'Create Admin Account'); _setMode('init'); }

  //  Login 
  async function login() {
    const username = document.getElementById('login-username').value.trim().toLowerCase();
    const pin      = document.getElementById('login-pin').value.trim();

    if (!username || !pin) { _setMsg('Enter username and PIN.', true); return; }
    if (!/^\d{4,6}$/.test(pin)) { _setMsg('PIN is 46 digits.', true); return; }

    console.log('[Auth] login(): username =', username);
    _setBtnLoading('btn-login', true, 'Login');
    try {
      await firebase.auth().signInWithEmailAndPassword(_userEmail(username), _fbPass(pin));
      console.log('[Auth] login(): Firebase Auth OK  handoff to onAuthStateChanged');
      // onAuthStateChanged in app.js completes the login
    } catch (e) {
      console.warn('[Auth] login(): failed ', e.code, e.message);
      _setMsg(_friendlyError(e), true);
      _setBtnLoading('btn-login', false, 'Login');
    }
  }

  //  Claim Invite (invited user sets their own PIN) 
  async function setupAccount() {
    const username  = document.getElementById('setup-username').value.trim().toLowerCase();
    const setupCode = document.getElementById('setup-code').value.trim().toUpperCase();
    const pin       = document.getElementById('setup-pin').value.trim();
    const confirm   = document.getElementById('setup-confirm').value.trim();

    if (!username || !setupCode || !pin || !confirm) { _setMsg('Fill all fields.', true); return; }
    if (pin !== confirm)             { _setMsg('PINs do not match.', true); return; }
    if (!/^\d{4,6}$/.test(pin))     { _setMsg('PIN must be 46 digits.', true); return; }
    if (setupCode.length !== 6)     { _setMsg('Setup code is 6 characters.', true); return; }

    console.log('[Auth] setupAccount(): username =', username, '| code =', setupCode);
    _setBtnLoading('btn-setup', true, 'Create Account');
    try {
      // Invite doc ID = setupCode (acts as the invite token)
      console.log('[Auth] setupAccount(): fetching invite doc');
      const inviteSnap = await firebase.firestore()
        .collection('pendingUsers').doc(setupCode).get();

      if (!inviteSnap.exists) {
        throw { message: 'Invalid setup code. Ask your Senior PGR for the correct code.' };
      }
      const invite = inviteSnap.data();
      if (invite.username !== username) {
        throw { message: 'Username does not match this setup code. Check with your Senior PGR.' };
      }
      console.log('[Auth] setupAccount(): invite valid ', invite.name, 'role:', invite.role);

      // Build profile  uid filled in after Firebase Auth account is created
      const profileData = {
        uid: null, id: null,
        username,
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
        .createUserWithEmailAndPassword(_userEmail(username), _fbPass(pin));
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

  //  Initial Setup (very first run  creates Senior PGR) 
  async function initialSetup() {
    const name     = document.getElementById('init-name').value.trim();
    const username = document.getElementById('init-username').value.trim().toLowerCase();
    const pin      = document.getElementById('init-pin').value.trim();
    const confirm  = document.getElementById('init-confirm').value.trim();

    if (!name || !username || !pin) { _setMsg('Fill all fields.', true); return; }
    if (pin !== confirm)            { _setMsg('PINs do not match.', true); return; }
    if (!/^\d{4,6}$/.test(pin))    { _setMsg('PIN must be 46 digits.', true); return; }
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(username) || username.length < 2 || username.length > 20) {
      _setMsg('Username: 220 chars, letters/digits/dots/hyphens, must start with a letter or digit.', true); return;
    }

    console.log('[Auth] initialSetup(): name =', name, '| username =', username);
    _setBtnLoading('btn-init', true, 'Create Admin Account');
    try {
      const profileData = {
        uid: null, id: null,
        username, name,
        role: 'senior_pgr', minDuties: 8,
        createdAt: new Date().toISOString(),
      };

      //  CRITICAL: set profile guard BEFORE first await
      Auth.setProfile(profileData);

      console.log('[Auth] initialSetup(): creating Firebase Auth account');
      const cred = await firebase.auth()
        .createUserWithEmailAndPassword(_userEmail(username), _fbPass(pin));
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
      manageLeaves:  ['senior_pgr', 'senior_resident'],
      manageReplace: ['senior_pgr', 'senior_resident'],
      applyLeave:    ['pgr', 'senior_pgr', 'senior_resident'],
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
