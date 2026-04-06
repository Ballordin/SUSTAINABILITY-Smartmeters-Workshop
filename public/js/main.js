// ─── Global Socket ────────────────────────────────────────────────────────────
const socket = io();

// ─── Global State ─────────────────────────────────────────────────────────────
let myRole          = 'consumer';
let myGroup         = 1;
let currentScenario = 1;
let isPowered       = true;

// ─── Shared DOM refs ──────────────────────────────────────────────────────────
const loadingScreen  = document.getElementById('loading-screen');
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
const carbonHeader   = document.getElementById('carbon-header-badge');
const carbonIntHdr   = document.getElementById('carbon-intensity-header');
const renewableBanner    = document.getElementById('renewable-event-banner');
const renewableBannerTxt = document.getElementById('renewable-event-text');

// ─── Toast ────────────────────────────────────────────────────────────────────
const toastEl = document.getElementById('toast');
let toastTimer = null;

function showToast(msg, type = 'info') {
    const styles = {
        info:    'bg-gray-800 border-gray-600 text-white',
        success: 'bg-green-900 border-green-600 text-green-200',
        warning: 'bg-yellow-900 border-yellow-600 text-yellow-200',
        error:   'bg-red-900 border-red-600 text-red-200',
    };
    toastEl.className = `fixed bottom-6 right-6 z-50 max-w-xs rounded-xl px-5 py-3 shadow-2xl text-sm font-bold border slide-right ${styles[type] || styles.info}`;
    toastEl.textContent = msg;
    toastEl.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.add('hidden'), 3500);
}

// Expose globally for other files
window.showToast = showToast;

// ─── Scenario panel toggle ────────────────────────────────────────────────────
function applyScenarioPanels(id) {
    if (myRole === 'consumer') {
        s1Consumer.classList.toggle('hidden', id !== 1);
        s2Consumer.classList.toggle('hidden', id !== 2);
        if (carbonHeader) carbonHeader.classList.toggle('hidden', id !== 2);
    } else if (myRole === 'manager') {
        s1Manager.classList.toggle('hidden', id !== 1);
        s2Manager.classList.toggle('hidden', id !== 2);
        if (mgrScenBadge) mgrScenBadge.textContent = `Scenario ${id}`;
    }
}

// ─── Role assigned ────────────────────────────────────────────────────────────
socket.on('role_assigned', (data) => {
    myRole = data.role; myGroup = data.group; currentScenario = data.scenario;
    isPowered = true;

    if (loadingScreen) loadingScreen.classList.add('hidden');

    if (myRole === 'consumer') {
        consumerView.classList.remove('hidden');
        managerView.classList.add('hidden');
        if (myGroupSpan) myGroupSpan.textContent = myGroup;
        // Also update P2P node label
        const p2pNode = document.getElementById('p2p-my-node');
        if (p2pNode) p2pNode.textContent = myGroup;
    } else {
        consumerView.classList.add('hidden');
        managerView.classList.remove('hidden');
        const inbox = document.getElementById('inbox-list');
        const s2Inbox = document.getElementById('s2-inbox');
        if (inbox)   inbox.innerHTML = '';
        if (s2Inbox) s2Inbox.innerHTML = '';
    }

    applyScenarioPanels(currentScenario);
    resultsView.classList.add('hidden');
    showToast(`You are a ${myRole === 'manager' ? '🎛️ Manager' : '🏠 Consumer'} — Node ${myGroup}`, 'info');
});

// ─── Scenario change ──────────────────────────────────────────────────────────
socket.on('scenario_changed', (id) => {
    currentScenario = id;
    const titles = { 1: 'Legacy Grid', 2: 'Smart Grid' };
    const color   = id === 1 ? 'text-blue-400' : 'text-green-400';
    if (scenarioTitle)
        scenarioTitle.innerHTML = `Scenario ${id}: <span class="${color}">${titles[id]}</span>`;
    applyScenarioPanels(id);
    resultsView.classList.add('hidden');
    if (myRole === 'consumer') consumerView.classList.remove('hidden');
    if (myRole === 'manager')  managerView.classList.remove('hidden');
    showToast(`Switched to Scenario ${id}: ${titles[id]}`, 'info');
    // Forward as global event for consumer/manager files
    window.dispatchEvent(new CustomEvent('scenario_switched', { detail: id }));
});

// ─── Clock ────────────────────────────────────────────────────────────────────
socket.on('time_update', (t) => {
    if (timerDisplay) timerDisplay.textContent = t;
});

// ─── Role swap ────────────────────────────────────────────────────────────────
socket.on('role_swap_alert', (data) => showToast(data.message, 'warning'));

// ─── Price update ─────────────────────────────────────────────────────────────
socket.on('price_update', (pricing) => {
    window.__currentPrice = pricing;
    window.dispatchEvent(new CustomEvent('price_changed', { detail: pricing }));
});

// ─── Grid-wide event (surge, etc.) ───────────────────────────────────────────
socket.on('grid_event', (data) => showToast(data.message, 'warning'));

// ─── Carbon update → header badge ─────────────────────────────────────────────
socket.on('carbon_update', (data) => {
    window.__carbonData = data;
    if (carbonIntHdr) {
        const { intensity } = data;
        const color = intensity > 300 ? 'text-red-400' : intensity > 150 ? 'text-yellow-400' : 'text-green-400';
        carbonIntHdr.className = `mono text-sm font-bold ${color}`;
        carbonIntHdr.textContent = `${intensity} g/kWh`;
    }
    // Forward to consumer.js
    window.dispatchEvent(new CustomEvent('carbon_received', { detail: data }));
});

// ─── Renewable variability events ─────────────────────────────────────────────
socket.on('renewable_event', (data) => {
    if (!renewableBanner || !renewableBannerTxt) return;

    if (data.type === 'clear' || data.type === 'wind_restored') {
        renewableBanner.classList.add('hidden');
        showToast(data.message, 'success');
    } else {
        renewableBannerTxt.textContent = data.message;
        renewableBanner.classList.remove('hidden');
        showToast(data.message, 'warning');
        // Notify consumer view about solar modifier
        window.dispatchEvent(new CustomEvent('renewable_changed', { detail: data }));
    }
});

// ─── Grid map SVG updates ─────────────────────────────────────────────────────
function updateGridMap(state) {
    for (let i = 1; i <= 4; i++) {
        const g = state.groups[i];
        if (!g) continue;
        const pct = g.capacity > 0 ? Math.round((g.currentLoad / g.capacity) * 100) : 0;

        const circle = document.getElementById(`map-node-${i}`);
        const pctEl  = document.getElementById(`map-pct-${i}`);
        const line   = document.getElementById(`line-ps-${i}`);

        if (pctEl) pctEl.textContent = `${pct}%`;

        if (circle) {
            if (g.shed) {
                circle.setAttribute('stroke', '#a855f7');
                circle.setAttribute('fill',   '#2d1b4e');
            } else if (pct > 95) {
                circle.setAttribute('stroke', '#ef4444');
                circle.setAttribute('fill',   '#2d0d0d');
            } else if (pct > 75) {
                circle.setAttribute('stroke', '#f59e0b');
                circle.setAttribute('fill',   '#2d1e05');
            } else {
                circle.setAttribute('stroke', '#22c55e');
                circle.setAttribute('fill',   '#1a2e1a');
            }
        }

        if (line) {
            const color = pct > 95 ? '#ef4444' : pct > 75 ? '#f59e0b' : '#3b82f6';
            const width = Math.max(2, Math.min(7, pct / 15));
            const opacity = Math.max(0.25, Math.min(1, pct / 80));
            line.setAttribute('stroke', color);
            line.setAttribute('stroke-width', width);
            line.setAttribute('opacity', opacity);
        }
    }

    // Carbon text on map
    const mapCarbon = document.getElementById('map-carbon-text');
    if (mapCarbon && state.carbonIntensity !== undefined) {
        mapCarbon.textContent = `${state.carbonIntensity} gCO₂/kWh`;
        const ci = state.carbonIntensity;
        mapCarbon.setAttribute('fill', ci > 300 ? '#f87171' : ci > 150 ? '#fbbf24' : '#6b7280');
    }
}

socket.on('state_update', (state) => {
    if (myRole === 'manager') updateGridMap(state);
});

// ─── Quiz modal ───────────────────────────────────────────────────────────────
const quizModal        = document.getElementById('quiz-modal');
const quizQuestionText = document.getElementById('quiz-question-text');
const quizOptions      = document.getElementById('quiz-options-container');
const quizAnsweredMsg  = document.getElementById('quiz-answered-msg');
const quizResultsPane  = document.getElementById('quiz-results-pane');
const quizResultsBars  = document.getElementById('quiz-results-bars');
const quizExplanation  = document.getElementById('quiz-explanation-text');
const quizCloseBtn     = document.getElementById('quiz-close-btn');

let myQuizAnswer = null;

socket.on('quiz_question', (data) => {
    if (!quizModal) return;
    myQuizAnswer = null;
    quizQuestionText.textContent = data.question;
    quizOptions.innerHTML = '';
    quizAnsweredMsg.classList.add('hidden');
    quizResultsPane.classList.add('hidden');

    data.options.forEach((opt, i) => {
        const btn = document.createElement('button');
        btn.className = 'w-full bg-gray-800 hover:bg-violet-900 border border-gray-700 hover:border-violet-700 p-3 rounded-xl text-sm font-semibold text-left transition-colors text-white';
        btn.textContent = `${['A','B','C','D'][i]}. ${opt}`;
        btn.addEventListener('click', () => {
            if (myQuizAnswer !== null) return;
            myQuizAnswer = i;
            socket.emit('quiz_answer', { answer: i });
            // Highlight selected
            quizOptions.querySelectorAll('button').forEach((b, bi) => {
                b.disabled = true;
                b.className = bi === i
                    ? 'w-full bg-violet-800 border border-violet-500 p-3 rounded-xl text-sm font-bold text-left text-white'
                    : 'w-full bg-gray-900 border border-gray-800 p-3 rounded-xl text-sm font-semibold text-left text-gray-600';
            });
            quizAnsweredMsg.classList.remove('hidden');
        });
        quizOptions.appendChild(btn);
    });

    quizModal.classList.remove('hidden');
});

socket.on('quiz_live_votes', (data) => {
    // Live vote count shown to admin — forwarded from main.js
    window.dispatchEvent(new CustomEvent('quiz_live_update', { detail: data }));
});

socket.on('quiz_results', (data) => {
    if (!quizModal) return;
    quizResultsPane.classList.remove('hidden');
    quizAnsweredMsg.classList.add('hidden');
    quizResultsBars.innerHTML = '';
    if (quizExplanation) quizExplanation.textContent = data.explanation;

    const max = Math.max(1, ...Object.values(data.counts));

    data.options.forEach((opt, i) => {
        const votes = data.counts[i] || 0;
        const pct   = Math.round((votes / Math.max(1, data.total)) * 100);
        const isCorrect = i === data.correct;
        const isMyAnswer = i === myQuizAnswer;

        const div = document.createElement('div');
        div.className = 'flex items-center gap-2';
        div.innerHTML = `
            <span class="text-xs font-bold w-4 ${isCorrect ? 'text-green-400' : 'text-gray-500'}">${['A','B','C','D'][i]}</span>
            <div class="flex-1 bg-gray-800 rounded-full h-6 overflow-hidden border ${isCorrect ? 'border-green-700' : 'border-gray-700'}">
                <div class="h-6 rounded-full flex items-center pl-2 transition-all duration-700 ${isCorrect ? 'bg-green-700' : 'bg-gray-700'}" style="width:${Math.max(4, (votes / max) * 100)}%">
                    <span class="text-xs font-bold text-white truncate">${opt}</span>
                </div>
            </div>
            <span class="mono text-xs text-gray-400 w-10 text-right">${votes} (${pct}%)</span>
            ${isMyAnswer ? '<span class="text-xs">👈</span>' : ''}
            ${isCorrect  ? '<span class="text-xs">✅</span>' : ''}
        `;
        quizResultsBars.appendChild(div);
    });
});

if (quizCloseBtn) {
    quizCloseBtn.addEventListener('click', () => {
        if (quizModal) quizModal.classList.add('hidden');
        myQuizAnswer = null;
    });
}

// ─── DR vote update → forward to consumer.js ─────────────────────────────────
socket.on('dr_vote_update', (data) => {
    window.dispatchEvent(new CustomEvent('dr_vote_received', { detail: data }));
});

socket.on('dr_resolved', (data) => {
    window.dispatchEvent(new CustomEvent('dr_resolved', { detail: data }));
    const msg = data.success
        ? `✅ Node ${data.node} DR succeeded! ${data.yes}/${data.total} accepted.`
        : `❌ Node ${data.node} DR failed. Only ${data.yes}/${data.total} accepted.`;
    showToast(msg, data.success ? 'success' : 'warning');
});

// ─── P2P market update → forward to consumer.js ──────────────────────────────
socket.on('p2p_market_update', (offers) => {
    window.__p2pMarket = offers;
    window.dispatchEvent(new CustomEvent('p2p_market_received', { detail: offers }));
});

// ─── Schedule triggered toast ─────────────────────────────────────────────────
socket.on('schedule_triggered', (data) => {
    showToast(`🗓 Auto-rule: ${data.appliance} turned ${data.action} (${data.condition})`, 'info');
});
