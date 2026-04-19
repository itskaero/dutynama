/**
 * ui.js — Navigation, alert panel, modal helpers, global UI utilities
 */

const UI = (() => {

  const PAGES = {
    dashboard:   { id: 'page-dashboard',   label: 'Dashboard',    icon: '📊' },
    roster:      { id: 'page-roster',      label: 'Roster',       icon: '📅' },
    leaves:      { id: 'page-leaves',      label: 'Leaves',       icon: '🌿' },
    preferences: { id: 'page-preferences', label: 'Preferences',  icon: '⚙️' },
    admin:       { id: 'page-admin',       label: 'Admin',        icon: '🛠' },
  };

  // Tabs visible per role
  const ROLE_TABS = {
    senior_pgr:      ['dashboard','roster','leaves','preferences','admin'],
    pgr:             ['dashboard','roster','leaves','preferences'],
    senior_registrar: ['dashboard','roster','leaves','admin'],
    viewer:          ['dashboard'],
  };

  let _currentPage = 'dashboard';

  function buildNav(role) {
    const tabs   = ROLE_TABS[role] || ['dashboard'];
    const navEl  = document.getElementById('main-nav');
    navEl.innerHTML = tabs.map(tab => {
      const p = PAGES[tab];
      return `<button class="tab-btn ${tab === _currentPage ? 'active' : ''}"
        onclick="UI.navigate('${tab}')">${p.icon} ${p.label}</button>`;
    }).join('');
  }

  function navigate(page) {
    _currentPage = page;
    // Hide all pages
    Object.values(PAGES).forEach(p => {
      document.getElementById(p.id)?.classList.remove('active');
    });
    document.getElementById(PAGES[page].id)?.classList.add('active');

    // Update nav active state
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    const activeBtn = [...document.querySelectorAll('.tab-btn')].find(
      b => b.getAttribute('onclick') === `UI.navigate('${page}')`
    );
    if (activeBtn) activeBtn.classList.add('active');

    // Render page content
    switch (page) {
      case 'dashboard':   Dashboard.render(); break;
      case 'roster':      RosterEngine.render(); break;
      case 'leaves':      LeaveManager.render(); break;
      case 'preferences': Preferences.render(); break;
      case 'admin':       Admin.render(); break;
    }
  }

  async function openAlerts() {
    refreshAlerts();
    document.getElementById('alert-panel').classList.remove('hidden');
    document.getElementById('overlay').classList.remove('hidden');
    await DB.markAlertsSeen();
    refreshAlerts(); // update badge after marking seen
  }

  function closeAlerts() {
    document.getElementById('alert-panel').classList.add('hidden');
    if (!document.querySelector('.modal:not(.hidden)')) {
      document.getElementById('overlay').classList.add('hidden');
    }
  }

  function closeDayModal() {
    document.getElementById('day-modal').classList.add('hidden');
    document.getElementById('overlay').classList.add('hidden');
  }

  function openChangePinModal() {
    document.getElementById('chpin-modal')?.classList.remove('hidden');
    document.getElementById('overlay').classList.remove('hidden');
  }

  function closeChangePinModal() {
    document.getElementById('chpin-modal')?.classList.add('hidden');
    const anyOpen = document.querySelector('.modal:not(.hidden)');
    if (!anyOpen) document.getElementById('overlay').classList.add('hidden');
  }

  function closeAll() {
    document.getElementById('alert-panel').classList.add('hidden');
    document.getElementById('day-modal')?.classList.add('hidden');
    document.getElementById('pgr-modal')?.classList.add('hidden');
    document.getElementById('chpin-modal')?.classList.add('hidden');
    document.getElementById('overlay').classList.add('hidden');
  }

  function refreshAlerts() {
    const alerts = DB.getAlerts();
    const count  = DB.unseenAlertCount();
    const badge  = document.getElementById('alert-badge');

    if (count > 0) {
      badge.textContent = count > 99 ? '99+' : count;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }

    const typeIcon = { error:'🔴', warn:'🟡', info:'🔵' };
    const listEl   = document.getElementById('alert-list');
    if (!listEl) return;

    if (!alerts.length) {
      listEl.innerHTML = '<p class="muted" style="padding:1rem">No alerts.</p>';
      return;
    }

    listEl.innerHTML = alerts.slice(0, 100).map(a => `
      <div class="alert-item ${a.seen ? '' : 'unseen'} alert-${a.type}">
        <span class="alert-icon">${typeIcon[a.type] || '⚪'}</span>
        <div class="alert-content">
          <div class="alert-msg">${a.message}</div>
          <div class="alert-date">${new Date(a.date).toLocaleString()}</div>
        </div>
      </div>
    `).join('');
  }

  function setUserChip(user) {
    document.getElementById('user-chip').innerHTML =
      `<span class="role-badge role-${user.role}">${user.role.replace(/_/g,' ')}</span>
       <span>${user.name}</span>
       <button class="btn btn-xs btn-ghost" style="margin-left:.4rem" onclick="UI.openChangePinModal()">🔒 PIN</button>`;
  }

  return {
    buildNav, navigate, refreshAlerts,
    openAlerts, closeAlerts,
    openChangePinModal, closeChangePinModal,
    closeDayModal, closeAll,
    setUserChip,
  };
})();
