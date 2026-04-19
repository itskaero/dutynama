/**
 * app.js — Bootstrap: Firebase auth state → load profile → show app
 */

const App = (() => {

  function _showLoading(msg) {
    const ol = document.getElementById('loading-overlay');
    if (!ol) return;
    ol.classList.remove('hidden');
    const txt = ol.querySelector('.loading-text');
    if (txt) txt.textContent = msg || 'Loading…';
  }

  function _hideLoading() {
    document.getElementById('loading-overlay')?.classList.add('hidden');
  }

  // ── Called after Firebase Auth confirms a logged-in user ──
  async function _afterFirebaseLogin(firebaseUser) {
    _showLoading('Loading your data…');

    // Hard timeout — Firebase Firestore can buffer requests silently when the
    // project is unreachable, causing the UI to hang indefinitely.
    let _timeoutId;
    const _timeout = new Promise((_, reject) => {
      _timeoutId = setTimeout(
        () => reject(new Error('Connection timed out. Check your network and Firebase project settings.')),
        20000
      );
    });

    try {
      await Promise.race([_doAfterLogin(firebaseUser), _timeout]);
    } catch (e) {
      console.error('[DutyNama] Login error:', e.code || '', e.message);
      _hideLoading();
      Auth.showLogin();
      Auth.showAuthError(e.message || 'Failed to load. Please try again.');
    } finally {
      clearTimeout(_timeoutId);
    }
  }

  async function _doAfterLogin(firebaseUser) {
    // Guard: if initialSetup/setupAccount already completed login directly, nothing to do.
    if (Auth.currentUser()) return;

    // Load Firestore profile — retry a few times to handle the race where
    // onAuthStateChanged fires before the initial-setup writes complete.
    let snap = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      snap = await firebase.firestore().collection('users').doc(firebaseUser.uid).get();
      if (snap.exists) break;
      await new Promise(r => setTimeout(r, 700 * (attempt + 1)));
    }
    if (!snap.exists) {
      // Profile still missing after retries — sign out and show login
      await firebase.auth().signOut();
      _hideLoading();
      Auth.showLogin();
      Auth.showAuthError('Account setup incomplete. Please create your account again.');
      return;
    }
    const profile = snap.data();
    profile.id  = profile.uid || firebaseUser.uid;
    profile.uid = profile.id;
    Auth.setProfile(profile);

    // Load all data into cache
    await DB.init();

    onLogin(profile);
  }

  // ── App init (entry point) ────────────────────────────────
  async function init() {
    _showLoading('Connecting…');

    firebase.auth().onAuthStateChanged(async (firebaseUser) => {
      if (firebaseUser) {
        await _afterFirebaseLogin(firebaseUser);
      } else {
        // Check whether initial setup has been done
        try {
          const cfgSnap = await firebase.firestore().doc('config/main').get();
          if (cfgSnap.exists) {
            Auth.showLogin();
          } else {
            // config/main doesn't exist → first run → create Senior PGR
            Auth.showInitialSetup();
          }
        } catch (e) {
          const code = e.code || '';
          if (code === 'unavailable') {
            // Offline — can't determine state, show login as safe fallback
            Auth.showLogin();
          } else {
            // permission-denied (rules block unauth reads) OR any other error:
            // We can't read config/main, so we can't know if DB is set up.
            // Show init setup — it has its own guard (createUserWithEmailAndPassword
            // will fail with 'email-already-in-use' if an account already exists).
            Auth.showInitialSetup();
          }
        }
        _hideLoading();
        document.getElementById('auth-screen').classList.add('active');
      }
    });
  }

  // ── Login / Logout hooks (called from Auth & UI) ──────────
  function onLogin(profile) {
    document.getElementById('auth-screen').classList.remove('active');
    document.getElementById('app-screen').classList.add('active');
    _hideLoading();

    try {
      UI.setUserChip(profile);
      UI.buildNav(profile.role);
      UI.navigate('dashboard');
      UI.refreshAlerts();
    } catch (e) {
      console.error('[DutyNama] UI render error after login:', e);
      // App is still functional — non-fatal render errors shouldn't block the user
    }
  }

  function onLogout() {
    DB.teardown();
    document.getElementById('app-screen').classList.remove('active');
    document.getElementById('auth-screen').classList.add('active');
    Auth.showLogin();
  }

  return { init, onLogin, onLogout };
})();

document.addEventListener('DOMContentLoaded', App.init);

