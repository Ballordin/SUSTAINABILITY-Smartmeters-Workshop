// ─── Global Socket ────────────────────────────────────────────────────────────
const socket = io();

// ─── Global State ─────────────────────────────────────────────────────────────
let myRole       = 'consumer';
let myGroup      = 1;
let currentScenario = 1;
let isPowered    = true;

// ─── Shared DOM refs ──────────────────────────────────────────────────────────
const consumerView   = document.getElementById('consumer-view');
const managerView    = document.getElementById('manager-view');
const resultsView    = document.getElementById('results-view');
const scenarioTitle  = document.getElementById('scenario-title');
const timerDisplay   = document.getElementById('timer');
const myGroupSpan    = document.getElementById('my-group');
const s1Consumer     = document.getElementById('s1-consumer');
const s2Consumer     = document.getElementById('s2-consumer');
const s1Manager      = document.getElementById('s1-manager');
const s2Manager      = document.getElementById('s2-manager');
const mgrScenBadge   = document.getElementById('mgr-scenario-badge');

// ─── Toast helper ─────────────────────────────────────────────────────────────
const toast = document.getElementById('toast');
let toastTimer = null;

function showToast(msg, type = 'info') {
    const styles = {
        info:    'bg-gray-800 border-gray-600 text-white',
        success: 'bg-green-900 border-green-600 text-green-200',
        warning: 'bg-yellow-900 border-yellow-600 text-yellow-200',
        error:   'bg-red-900 border-red-600 text-red-200',
    };
    toast.className = `fixed bottom-6 right-6 z-50 max-w-xs rounded-xl px-5 py-3 shadow-2xl text-sm font-bold border slide-right ${styles[type] || styles.info}`;
    toast.textContent = msg;
    toast.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.add('hidden'), 3500);
}

// ─── Switch which scenario panels are shown ───────────────────────────────────
function applyScenarioPanels(scenarioId) {
    if (myRole === 'consumer') {
        s1Consumer.classList.toggle('hidden', scenarioId !== 1);
        s2Consumer.classList.toggle('hidden', scenarioId !== 2);
    } else if (myRole === 'manager') {
        s1Manager.classList.toggle('hidden', scenarioId !== 1);
        s2Manager.classList.toggle('hidden', scenarioId !== 2);
        if (mgrScenBadge) mgrScenBadge.textContent = `Scenario ${scenarioId}`;
    }
}

// ─── Role assignment ──────────────────────────────────────────────────────────
socket.on('role_assigned', (data) => {
    myRole        = data.role;
    myGroup       = data.group;
    currentScenario = data.scenario;
    isPowered     = true;

    if (myRole === 'consumer') {
        consumerView.classList.remove('hidden');
        managerView.classList.add('hidden');
        if (myGroupSpan) myGroupSpan.textContent = myGroup;
    } else {
        consumerView.classList.add('hidden');
        managerView.classList.remove('hidden');
        const inbox = document.getElementById('inbox-list');
        const s2Inbox = document.getElementById('s2-inbox');
        if (inbox)   inbox.innerHTML   = '';
        if (s2Inbox) s2Inbox.innerHTML = '';
    }

    applyScenarioPanels(currentScenario);
    resultsView.classList.add('hidden');
    showToast(`You are now a ${myRole === 'manager' ? '🎛️ Manager' : '🏠 Consumer'} on Node ${myGroup}`, 'info');
});

// ─── Scenario change ──────────────────────────────────────────────────────────
socket.on('scenario_changed', (newId) => {
    currentScenario = newId;

    const titles = { 1: 'Legacy Grid', 2: 'Smart Grid' };
    if (scenarioTitle) {
        scenarioTitle.innerHTML = `Scenario ${newId}: <span class="${newId === 1 ? 'text-blue-400' : 'text-green-400'}">${titles[newId]}</span>`;
    }

    applyScenarioPanels(newId);
    resultsView.classList.add('hidden');
    if (myRole === 'consumer') consumerView.classList.remove('hidden');
    if (myRole === 'manager')  managerView.classList.remove('hidden');

    showToast(`Switched to Scenario ${newId}: ${titles[newId]}`, 'info');
});

// ─── Shared: clock ────────────────────────────────────────────────────────────
socket.on('time_update', (t) => {
    if (timerDisplay) timerDisplay.textContent = t;
});

// ─── Shared: role-swap alert ──────────────────────────────────────────────────
socket.on('role_swap_alert', (data) => {
    showToast(data.message, 'warning');
});

// ─── Shared: grid event (admin-injected) ──────────────────────────────────────
socket.on('grid_event', (data) => {
    showToast(data.message, 'warning');
});

// ─── Shared: price update (drives both consumer panels) ───────────────────────
socket.on('price_update', (pricing) => {
    // Let consumer.js handle the UI details — expose globally
    window.__currentPrice = pricing;
    // Dispatch a custom event so consumer.js can hook in
    window.dispatchEvent(new CustomEvent('price_changed', { detail: pricing }));
});
