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
    try {
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
        return;
      }
      const profile = snap.data();
      profile.id  = profile.uid || firebaseUser.uid;
      profile.uid = profile.id;
      Auth.setProfile(profile);

      // Load all data into cache
      await DB.init();

      onLogin(profile);
    } catch (e) {
      console.error('[DutyNama] Error loading profile:', e);
      _hideLoading();
      Auth.showLogin();
    }
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
          // Firestore unreachable (bad config, no internet, etc.)
          // Still show init screen so user can at least see something actionable
          console.warn('[DutyNama] Firestore check failed — showing init screen:', e.message);
          Auth.showInitialSetup();
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

    UI.setUserChip(profile);
    UI.buildNav(profile.role);
    UI.navigate('dashboard');
    UI.refreshAlerts();
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

