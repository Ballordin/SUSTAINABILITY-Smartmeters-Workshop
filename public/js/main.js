// ─── Socket global ────────────────────────────────────────────────────────────
const socket = io();

// ─── Estado global ────────────────────────────────────────────────────────────
let myRole          = 'consumer';
let myGroup         = 1;
let myName          = '';
let currentScenario = 1;
let isPowered       = true;

// Quiz state client-side
let myQuizAnswer       = null;
let quizCountdown      = null;   // setInterval ref for countdown
let quizSecondsLeft    = 30;
let quizSubmitted      = false;

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const loadingScreen  = document.getElementById('loading-screen');
const consumerView   = document.getElementById('consumer-view');
const managerView    = document.getElementById('manager-view');
const adminStatusView= document.getElementById('admin-status-view');
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
    const styles = { info: 'bg-gray-800 border-gray-600 text-white', success: 'bg-green-900 border-green-600 text-green-200', warning: 'bg-yellow-900 border-yellow-600 text-yellow-200', error: 'bg-red-900 border-red-600 text-red-200' };
    toastEl.className = `fixed bottom-6 right-6 z-50 max-w-xs rounded-xl px-5 py-3 shadow-2xl text-sm font-bold border slide-right ${styles[type] || styles.info}`;
    toastEl.textContent = msg;
    toastEl.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.add('hidden'), 3500);
}
window.showToast = showToast;

// ─── Nickname modal ───────────────────────────────────────────────────────────
const isAdminView    = new URLSearchParams(window.location.search).get('admin') === 'true';
const nicknameModal  = document.getElementById('nickname-modal');
const nicknameInput  = document.getElementById('nickname-input');
const nicknameBtn    = document.getElementById('nickname-submit-btn');
const nicknameError  = document.getElementById('nickname-error');

if (isAdminView) {
    // Instrutor: salta nickname modal, entra na vista de controlo exclusiva
    if (nicknameModal) nicknameModal.classList.add('hidden');
    if (loadingScreen) loadingScreen.classList.add('hidden');
    myRole = 'manager';
    if (consumerView)   consumerView.classList.add('hidden');
    if (managerView)    managerView.classList.add('hidden');
    if (adminStatusView) adminStatusView.classList.remove('hidden');
} else {
    // Alunos: mostrar modal de nome
    if (nicknameModal) nicknameModal.classList.remove('hidden');
    if (loadingScreen) loadingScreen.classList.add('hidden');
}

function submitNickname() {
    const name = (nicknameInput?.value || '').trim();
    if (name.length < 2) {
        if (nicknameError) { nicknameError.textContent = 'O nome deve ter pelo menos 2 caracteres.'; nicknameError.classList.remove('hidden'); }
        return;
    }
    myName = name;
    if (nicknameModal) nicknameModal.classList.add('hidden');
    if (loadingScreen) { loadingScreen.classList.remove('hidden'); loadingScreen.innerHTML = `<div class="text-center"><div class="text-5xl mb-4 animate-pulse">⚡</div><p class="text-white font-black text-xl mb-1">Olá, ${name}!</p><p class="text-gray-500 mb-4">A ligar à simulação…</p><div class="flex gap-2 justify-center"><span class="w-2 h-2 rounded-full bg-blue-500 animate-bounce" style="animation-delay:0s"></span><span class="w-2 h-2 rounded-full bg-blue-500 animate-bounce" style="animation-delay:.15s"></span><span class="w-2 h-2 rounded-full bg-blue-500 animate-bounce" style="animation-delay:.3s"></span></div></div>`; }
    socket.emit('register_user', { isAdmin: false, name });
}

if (nicknameBtn) nicknameBtn.addEventListener('click', submitNickname);
if (nicknameInput) nicknameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitNickname(); });

// ─── Painéis por cenário ──────────────────────────────────────────────────────
function applyScenarioPanels(id) {
    if (myRole === 'consumer') {
        s1Consumer?.classList.toggle('hidden', id !== 1);
        s2Consumer?.classList.toggle('hidden', id !== 2);
        if (carbonHeader) carbonHeader.classList.toggle('hidden', id !== 2);
    } else if (myRole === 'manager') {
        s1Manager?.classList.toggle('hidden', id !== 1);
        s2Manager?.classList.toggle('hidden', id !== 2);
        if (mgrScenBadge) mgrScenBadge.textContent = id === 1 ? 'Rede Tradicional' : 'Rede Inteligente';
    }
}

// ─── Admin init (espectador/gestor persistente) ───────────────────────────────
socket.on('admin_init', (data) => {
    currentScenario = data.scenario;
    myRole = 'manager';
    if (consumerView)    consumerView.classList.add('hidden');
    if (managerView)     managerView.classList.add('hidden');
    if (adminStatusView) adminStatusView.classList.remove('hidden');
    if (loadingScreen)   loadingScreen.classList.add('hidden');
    const cor = data.scenario === 1 ? 'text-blue-400' : 'text-green-400';
    if (scenarioTitle) scenarioTitle.innerHTML = `Cenário ${data.scenario}: <span class="${cor}">${data.scenarioName}</span>`;
});

// ─── Papel atribuído ──────────────────────────────────────────────────────────
socket.on('role_assigned', (data) => {
    myRole = data.role; myGroup = data.group; currentScenario = data.scenario;
    if (data.name) myName = data.name;
    isPowered = true;

    if (loadingScreen) loadingScreen.classList.add('hidden');

    if (myRole === 'consumer') {
        consumerView?.classList.remove('hidden');
        managerView?.classList.add('hidden');
        if (myGroupSpan) myGroupSpan.textContent = myGroup;
        const p2pNode = document.getElementById('p2p-my-node');
        if (p2pNode) p2pNode.textContent = myGroup;
        const nameDisplay = document.getElementById('my-name-display');
        if (nameDisplay) nameDisplay.textContent = myName;
    } else {
        consumerView?.classList.add('hidden');
        managerView?.classList.remove('hidden');
        document.getElementById('inbox-list')  && (document.getElementById('inbox-list').innerHTML = '');
        document.getElementById('s2-inbox')    && (document.getElementById('s2-inbox').innerHTML = '');
    }

    applyScenarioPanels(currentScenario);
    resultsView?.classList.add('hidden');
    showToast(`És ${myRole === 'manager' ? '🎛️ Gestor' : '🏠 Consumidor'} — Nó ${myGroup}`, 'info');
});

// ─── Mudança de cenário ───────────────────────────────────────────────────────
socket.on('scenario_changed', (data) => {
    const id = data.id || data;
    const name = data.name || (id === 1 ? 'Rede Elétrica Tradicional' : 'Rede Elétrica Inteligente');
    currentScenario = id;
    const cor = id === 1 ? 'text-blue-400' : 'text-green-400';
    if (scenarioTitle) scenarioTitle.innerHTML = `Cenário ${id}: <span class="${cor}">${name}</span>`;

    if (isAdminView) {
        // Instrutor mantém sempre a vista de controlo — nunca muda para consumidor/gestor
        myRole = 'manager';
        if (consumerView)    consumerView.classList.add('hidden');
        if (managerView)     managerView.classList.add('hidden');
        if (adminStatusView) adminStatusView.classList.remove('hidden');
        const cor = id === 1 ? 'text-blue-400' : 'text-green-400';
        if (scenarioTitle) scenarioTitle.innerHTML = `Cenário ${id}: <span class="${cor}">${name}</span>`;
        showToast(`Cenário ${id}: ${name}`, 'info');
        window.dispatchEvent(new CustomEvent('scenario_switched', { detail: id }));
        return;
    }

    applyScenarioPanels(id);
    resultsView?.classList.add('hidden');
    if (myRole === 'consumer') consumerView?.classList.remove('hidden');
    if (myRole === 'manager')  managerView?.classList.remove('hidden');
    showToast(`Mudou para Cenário ${id}: ${name}`, 'info');
    window.dispatchEvent(new CustomEvent('scenario_switched', { detail: id }));
});

// ─── Relógio ──────────────────────────────────────────────────────────────────
socket.on('time_update', (t) => { if (timerDisplay) timerDisplay.textContent = t; });

// ─── Reset total (wipe de todos os dados) ─────────────────────────────────────
socket.on('full_reset', () => {
    consumerView?.classList.add('hidden');
    managerView?.classList.add('hidden');
    resultsView?.classList.add('hidden');

    if (isAdminView) {
        // Instrutor permanece na sua vista de controlo
        if (adminStatusView) adminStatusView.classList.remove('hidden');
        if (loadingScreen)   loadingScreen.classList.add('hidden');
        socket.emit('register_user', { isAdmin: true, name: 'Instrutor' });
        return;
    }

    if (loadingScreen) {
        loadingScreen.classList.remove('hidden');
        loadingScreen.innerHTML = `
            <div class="text-center">
                <div class="text-5xl mb-4 animate-pulse">🔄</div>
                <p class="text-white font-black text-xl mb-1">Sessão Reiniciada</p>
                <p class="text-gray-500 mb-6">Aguarda que o instrutor inicie uma nova sessão…</p>
                <div class="flex gap-2 justify-center">
                    <span class="w-2 h-2 rounded-full bg-purple-500 animate-bounce" style="animation-delay:0s"></span>
                    <span class="w-2 h-2 rounded-full bg-purple-500 animate-bounce" style="animation-delay:.15s"></span>
                    <span class="w-2 h-2 rounded-full bg-purple-500 animate-bounce" style="animation-delay:.3s"></span>
                </div>
            </div>`;
    }

    if (myName) {
        socket.emit('register_user', { isAdmin: false, name: myName });
    } else {
        if (loadingScreen) loadingScreen.classList.add('hidden');
        if (nicknameModal) nicknameModal.classList.remove('hidden');
    }
});

// ─── Sessão iniciada ──────────────────────────────────────────────────────────
socket.on('session_started', (data) => {
    if (!isAdminView) {
        showToast(`▶ A sessão começou! Cenário ${data.scenario} — Boa sorte!`, 'success');
    }
});

// ─── Troca de papéis ──────────────────────────────────────────────────────────
socket.on('role_swap_alert', (data) => showToast(data.message, 'warning'));

// ─── Eventos de rede ─────────────────────────────────────────────────────────
socket.on('grid_event', (data) => showToast(data.message, 'warning'));

// ─── Preço ────────────────────────────────────────────────────────────────────
socket.on('price_update', (pricing) => {
    window.__currentPrice = pricing;
    window.dispatchEvent(new CustomEvent('price_changed', { detail: pricing }));
});

// ─── Carbono ──────────────────────────────────────────────────────────────────
socket.on('carbon_update', (data) => {
    window.__carbonData = data;
    if (carbonIntHdr) {
        const cor = data.intensity > 300 ? 'text-red-400' : data.intensity > 150 ? 'text-yellow-400' : 'text-green-400';
        carbonIntHdr.className = `mono text-sm font-bold ${cor}`;
        carbonIntHdr.textContent = `${data.intensity} g/kWh`;
    }
    window.dispatchEvent(new CustomEvent('carbon_received', { detail: data }));
});

// ─── Estabilidade ─────────────────────────────────────────────────────────────
socket.on('stability_update', (score) => {
    window.__stabilityScore = score;
    window.dispatchEvent(new CustomEvent('stability_received', { detail: score }));
    // Update stability badge in manager view
    const badge = document.getElementById('stability-badge');
    if (badge) {
        badge.textContent = `${score}%`;
        badge.className = `mono font-black text-lg ${score > 70 ? 'text-green-400' : score > 40 ? 'text-yellow-400' : 'text-red-400'}`;
    }
});

// ─── Renováveis ───────────────────────────────────────────────────────────────
socket.on('renewable_event', (data) => {
    if (!renewableBanner || !renewableBannerTxt) return;
    if (data.type === 'clear' || data.type === 'wind_restored') {
        renewableBanner.classList.add('hidden');
        showToast(data.message, 'success');
    } else {
        renewableBannerTxt.textContent = data.message;
        renewableBanner.classList.remove('hidden');
        showToast(data.message, 'warning');
        window.dispatchEvent(new CustomEvent('renewable_changed', { detail: data }));
    }
});

// ─── Mapa SVG ─────────────────────────────────────────────────────────────────
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
            if (g.shed)       { circle.setAttribute('stroke','#a855f7'); circle.setAttribute('fill','#2d1b4e'); }
            else if (pct > 95){ circle.setAttribute('stroke','#ef4444'); circle.setAttribute('fill','#2d0d0d'); }
            else if (pct > 75){ circle.setAttribute('stroke','#f59e0b'); circle.setAttribute('fill','#2d1e05'); }
            else              { circle.setAttribute('stroke','#22c55e'); circle.setAttribute('fill','#1a2e1a'); }
        }
        if (line) {
            line.setAttribute('stroke', pct > 95 ? '#ef4444' : pct > 75 ? '#f59e0b' : '#3b82f6');
            line.setAttribute('stroke-width', Math.max(2, Math.min(7, pct / 15)));
            line.setAttribute('opacity', Math.max(0.25, Math.min(1, pct / 80)));
        }
    }
    const mapCarbon = document.getElementById('map-carbon-text');
    if (mapCarbon && state.carbonIntensity !== undefined) {
        mapCarbon.textContent = `${state.carbonIntensity} gCO₂/kWh`;
        mapCarbon.setAttribute('fill', state.carbonIntensity > 300 ? '#f87171' : state.carbonIntensity > 150 ? '#fbbf24' : '#6b7280');
    }
    // Update CO2 and stability session metrics
    if (state.metrics) {
        const co2El = document.getElementById('session-co2-value');
        const stabEl = document.getElementById('session-stability-value');
        if (co2El) {
            co2El.textContent = state.metrics.totalCO2 >= 1000
                ? `${(state.metrics.totalCO2 / 1000).toFixed(2)} kg`
                : `${state.metrics.totalCO2} g`;
        }
        if (stabEl) {
            stabEl.textContent = `${state.metrics.stabilityScore}%`;
            stabEl.className = `mono font-black text-xl ${state.metrics.stabilityScore > 70 ? 'text-green-400' : state.metrics.stabilityScore > 40 ? 'text-yellow-400' : 'text-red-400'}`;
        }
    }
}

socket.on('state_update', (state) => {
    if (myRole === 'manager') updateGridMap(state);
});

// ─── P2P → consumer.js ────────────────────────────────────────────────────────
socket.on('p2p_market_update', (offers) => {
    window.__p2pMarket = offers;
    window.dispatchEvent(new CustomEvent('p2p_market_received', { detail: offers }));
});

// ─── DR vote → consumer.js ────────────────────────────────────────────────────
socket.on('dr_vote_update', (data) => window.dispatchEvent(new CustomEvent('dr_vote_received', { detail: data })));

socket.on('dr_resolved', (data) => {
    window.dispatchEvent(new CustomEvent('dr_resolved', { detail: data }));
    const msg = data.success
        ? `✅ Nó ${data.node}: RP bem-sucedida! ${data.yes}/${data.total} aceitaram.`
        : `❌ Nó ${data.node}: RP falhou. Só ${data.yes}/${data.total} aceitaram.`;
    showToast(msg, data.success ? 'success' : 'warning');
});

// ─── Schedule triggered ───────────────────────────────────────────────────────
socket.on('schedule_triggered', (data) => {
    const acao = data.action === 'on' ? 'ligado' : 'desligado';
    showToast(`🗓 Regra automática: ${data.appliance} ${acao} (${data.condition})`, 'info');
});

// ─── Quiz reset (on new game) ─────────────────────────────────────────────────
socket.on('quiz_reset', () => {
    resetQuizState();
    const quizModal = document.getElementById('quiz-modal');
    if (quizModal) quizModal.classList.add('hidden');
});

// ─── QUIZ LOGIC ───────────────────────────────────────────────────────────────
const quizModal        = document.getElementById('quiz-modal');
const quizQuestionText = document.getElementById('quiz-question-text');
const quizOptions      = document.getElementById('quiz-options-container');
const quizAnsweredMsg  = document.getElementById('quiz-answered-msg');
const quizResultsPane  = document.getElementById('quiz-results-pane');
const quizResultsBars  = document.getElementById('quiz-results-bars');
const quizExplanation  = document.getElementById('quiz-explanation-text');
const quizCloseBtn     = document.getElementById('quiz-close-btn');
const quizTimerBar     = document.getElementById('quiz-timer-bar');
const quizTimerLabel   = document.getElementById('quiz-timer-label');
const quizAnswerFeedback = document.getElementById('quiz-answer-feedback');
const quizProgressLabel  = document.getElementById('quiz-progress-label');

function resetQuizState() {
    myQuizAnswer = null;
    quizSubmitted = false;
    quizSecondsLeft = 30;
    if (quizCountdown) { clearInterval(quizCountdown); quizCountdown = null; }
}

function startQuizCountdown(deadline) {
    if (quizCountdown) clearInterval(quizCountdown);
    function tick() {
        const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
        quizSecondsLeft = remaining;
        if (quizTimerBar) quizTimerBar.style.width = `${(remaining / 30) * 100}%`;
        if (quizTimerBar) quizTimerBar.className = `h-full rounded-full transition-all duration-1000 ${remaining <= 5 ? 'bg-red-500' : remaining <= 10 ? 'bg-yellow-500' : 'bg-blue-500'}`;
        if (quizTimerLabel) quizTimerLabel.textContent = `${remaining}s`;
        if (remaining <= 0) { clearInterval(quizCountdown); quizCountdown = null; lockQuizOptions(); }
    }
    tick();
    quizCountdown = setInterval(tick, 1000);
}

function lockQuizOptions() {
    if (!quizOptions) return;
    quizOptions.querySelectorAll('button').forEach(b => {
        b.disabled = true;
        b.className = b.className.replace('hover:bg-violet-900 hover:border-violet-700', '');
        b.classList.add('opacity-50');
    });
    if (!quizSubmitted && quizAnsweredMsg) {
        quizAnsweredMsg.textContent = '⏱ Tempo esgotado! Sem pontos.';
        quizAnsweredMsg.classList.remove('hidden', 'text-green-400');
        quizAnsweredMsg.classList.add('text-yellow-400');
    }
}

// ── New question arrives ──────────────────────────────────────────────────────
socket.on('quiz_question', (data) => {
    // BUG FIX: always reset state before showing new question
    if (isAdminView) return;
    
    resetQuizState();
    if (!quizModal) return;
    if (quizQuestionText) quizQuestionText.textContent = data.question;
    if (quizProgressLabel) quizProgressLabel.textContent = `P${data.index + 1} / ${data.total || 10}`;
    if (quizAnsweredMsg) { quizAnsweredMsg.classList.add('hidden'); quizAnsweredMsg.textContent = '✅ Resposta enviada — a aguardar resultados…'; quizAnsweredMsg.classList.remove('text-yellow-400'); quizAnsweredMsg.classList.add('text-green-400'); }
    if (quizResultsPane) quizResultsPane.classList.add('hidden');
    if (quizAnswerFeedback) quizAnswerFeedback.classList.add('hidden');

    // Build options
    if (quizOptions) {
        quizOptions.innerHTML = '';
        data.options.forEach((opt, i) => {
            const btn = document.createElement('button');
            btn.className = 'w-full bg-gray-800 hover:bg-violet-900 border border-gray-700 hover:border-violet-700 p-3 rounded-xl text-sm font-semibold text-left transition-colors text-white';
            btn.textContent = `${['A','B','C','D'][i]}. ${opt}`;
            btn.addEventListener('click', () => {
                if (myQuizAnswer !== null || quizSubmitted) return;
                myQuizAnswer = i; quizSubmitted = true;
                socket.emit('quiz_answer', { answer: i });
                // Visual: highlight selected
                quizOptions.querySelectorAll('button').forEach((b, bi) => {
                    b.disabled = true;
                    b.className = bi === i
                        ? 'w-full bg-violet-800 border border-violet-500 p-3 rounded-xl text-sm font-bold text-left text-white'
                        : 'w-full bg-gray-900 border border-gray-800 p-3 rounded-xl text-sm font-semibold text-left text-gray-600';
                });
                if (quizAnsweredMsg) quizAnsweredMsg.classList.remove('hidden');
                // NOTA: o cronómetro continua — o utilizador mantém noção do tempo restante do grupo
            });
            quizOptions.appendChild(btn);
        });
    }

    // Start countdown
    startQuizCountdown(data.deadline || Date.now() + 30000);
    quizModal.classList.remove('hidden');
});

// ── Answer result (immediate feedback) ───────────────────────────────────────
socket.on('quiz_answer_result', (data) => {
    if (!quizAnswerFeedback) return;
    quizAnswerFeedback.textContent = data.correct
        ? `✅ Correto! +10 pontos (total: ${data.newScore} pts)`
        : `❌ Errado. +0 pontos (total: ${data.newScore} pts)`;
    quizAnswerFeedback.className = `text-sm font-bold text-center mt-2 ${data.correct ? 'text-green-400' : 'text-red-400'}`;
    quizAnswerFeedback.classList.remove('hidden');
});

// ── Timeout: lock UI ──────────────────────────────────────────────────────────
socket.on('quiz_timeout', () => {
    if (quizCountdown) { clearInterval(quizCountdown); quizCountdown = null; }
    lockQuizOptions();
});

// ── Fim antecipado: todos responderam ────────────────────────────────────────
socket.on('quiz_early_end', () => {
    if (quizCountdown) { clearInterval(quizCountdown); quizCountdown = null; }
    if (quizTimerLabel) quizTimerLabel.textContent = '✓';
    if (quizTimerBar)   { quizTimerBar.style.width = '100%'; quizTimerBar.className = 'h-full rounded-full bg-green-500 transition-all duration-300'; }
    lockQuizOptions();
    // Mostrar brevemente mensagem de todos responderam (se ainda não foi respondida pelo utilizador)
    if (!quizSubmitted && quizAnsweredMsg) {
        quizAnsweredMsg.textContent = '⚡ Todos responderam — a revelar resultados…';
        quizAnsweredMsg.classList.remove('hidden', 'text-green-400');
        quizAnsweredMsg.classList.add('text-blue-400');
    }
});

// ── Results ───────────────────────────────────────────────────────────────────
socket.on('quiz_results', (data) => {
    if (!quizModal) return;
    if (quizResultsPane) quizResultsPane.classList.remove('hidden');
    if (quizAnsweredMsg) quizAnsweredMsg.classList.add('hidden');
    if (quizResultsBars) quizResultsBars.innerHTML = '';
    if (quizExplanation) quizExplanation.textContent = data.explanation;
    // Stop countdown
    if (quizCountdown) { clearInterval(quizCountdown); quizCountdown = null; }
    if (quizTimerLabel) quizTimerLabel.textContent = '–';
    if (quizTimerBar)   quizTimerBar.style.width = '0%';

    const max = Math.max(1, ...Object.values(data.counts));
    data.options.forEach((opt, i) => {
        const votos = data.counts[i] || 0;
        const pct   = Math.round((votos / Math.max(1, data.total)) * 100);
        const certa = i === data.correct;
        const minha = i === myQuizAnswer;
        const div = document.createElement('div');
        div.className = 'flex items-center gap-2';
        div.innerHTML = `
            <span class="text-xs font-bold w-4 ${certa ? 'text-green-400' : 'text-gray-500'}">${['A','B','C','D'][i]}</span>
            <div class="flex-1 bg-gray-800 rounded-full h-6 overflow-hidden border ${certa ? 'border-green-700' : 'border-gray-700'}">
                <div class="h-6 rounded-full flex items-center pl-2 ${certa ? 'bg-green-700' : 'bg-gray-700'}" style="width:${Math.max(4,(votos/max)*100)}%;transition:width 0.7s">
                    <span class="text-xs font-bold text-white truncate">${opt}</span>
                </div>
            </div>
            <span class="mono text-xs text-gray-400 w-14 text-right">${votos} (${pct}%)</span>
            ${minha ? '<span class="text-xs">👈</span>' : ''}${certa ? '<span class="text-xs">✅</span>' : ''}
        `;
        if (quizResultsBars) quizResultsBars.appendChild(div);
    });
    // Update admin leaderboard forwarding
    window.dispatchEvent(new CustomEvent('quiz_live_update', { detail: { counts: data.counts, total: data.total } }));
});

// Live votes (admin mini-bars)
socket.on('quiz_live_votes', (data) => window.dispatchEvent(new CustomEvent('quiz_live_update', { detail: data })));

if (quizCloseBtn) quizCloseBtn.addEventListener('click', () => {
    quizModal?.classList.add('hidden');
    resetQuizState();
});

// ─── Leaderboard popup (after 5 questions or end of game) ─────────────────────
const leaderboardPopup     = document.getElementById('leaderboard-popup-modal');
const leaderboardPopupBody = document.getElementById('leaderboard-popup-body');
const leaderboardPopupClose= document.getElementById('leaderboard-popup-close');

socket.on('show_leaderboard_popup', (entries) => {
    if (!leaderboardPopup || !leaderboardPopupBody) return;
    leaderboardPopupBody.innerHTML = entries.length === 0
        ? '<p class="text-gray-600 text-sm text-center py-4">Sem participantes ainda.</p>'
        : entries.map((e, i) => {
            const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i+1}`;
            return `
                <div class="flex items-center gap-3 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm ${e.id === socket.id ? 'border-yellow-500' : ''}">
                    <span class="w-6 text-center font-black">${medal}</span>
                    <span class="flex-1 font-bold ${e.id === socket.id ? 'text-yellow-300' : 'text-white'} truncate">${e.name}</span>
                    <span class="text-blue-400 mono font-black shrink-0">📝 ${e.quizScore} pts</span>
                    <span class="text-green-400 mono text-xs shrink-0">✅ ${e.compliance}</span>
                </div>`;
        }).join('');
    leaderboardPopup.classList.remove('hidden');
});

if (leaderboardPopupClose) leaderboardPopupClose.addEventListener('click', () => leaderboardPopup?.classList.add('hidden'));

// ─── Vista do Instrutor — atualização de dados ────────────────────────────────
if (isAdminView) {

    // Espelho do relógio
    socket.on('time_update', (t) => {
        const el = document.getElementById('admin-timer-mirror');
        if (el) el.textContent = t;
    });

    // Estado da sessão (INICIAR SESSÃO / A DECORRER)
    socket.on('session_started', () => {
        const el = document.getElementById('admin-session-state');
        if (el) { el.textContent = '▶ A Decorrer'; el.className = 'font-black text-lg text-green-400'; }
    });
    socket.on('full_reset', () => {
        const el = document.getElementById('admin-session-state');
        if (el) { el.textContent = '⏸ Pausa'; el.className = 'font-black text-lg text-yellow-400'; }
    });
    socket.on('scenario_changed', () => {
        const el = document.getElementById('admin-session-state');
        if (el) { el.textContent = '⏸ Pausa'; el.className = 'font-black text-lg text-yellow-400'; }
    });

    // Métricas em tempo real via state_update
    socket.on('state_update', (state) => {
        const m = state.metrics || {};
        const set = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };

        set('adm-outages',  m.outages   || 0);
        set('adm-calls',    m.callsMade || 0);
        set('adm-resolved', m.issuesResolved || 0);
        set('adm-dr',       m.drAccepted || 0);
        set('adm-co2',      (m.totalCO2 || 0) >= 1000
            ? `${((m.totalCO2 || 0) / 1000).toFixed(1)} kg`
            : `${Math.round(m.totalCO2 || 0)} g`);
        set('adm-power',    (m.totalPower || 0) >= 1000
            ? `${((m.totalPower || 0) / 1000).toFixed(1)} kW`
            : `${Math.round(m.totalPower || 0)} W`);

        const stabEl = document.getElementById('admin-stability-mirror');
        if (stabEl) {
            const sc = Math.round(m.stabilityScore || 100);
            stabEl.textContent = `${sc}%`;
            stabEl.className = `mono font-black text-2xl ${sc > 70 ? 'text-green-400' : sc > 40 ? 'text-yellow-400' : 'text-red-400'}`;
        }

        // Nós da rede
        const grid = document.getElementById('admin-nodes-grid');
        if (grid && state.groups) {
            grid.innerHTML = Object.entries(state.groups).map(([id, g]) => {
                const pct = g.capacity > 0 ? Math.round((g.currentLoad / g.capacity) * 100) : 0;
                const col = g.shed ? 'border-purple-700 bg-purple-950/40' : pct > 95 ? 'border-red-700 bg-red-950/40' : pct > 75 ? 'border-yellow-700 bg-yellow-950/30' : 'border-gray-700 bg-gray-950/40';
                const barCol = g.shed ? 'bg-purple-500' : pct > 95 ? 'bg-red-500' : pct > 75 ? 'bg-yellow-500' : 'bg-green-500';
                const label = g.shed ? '✂️ Corte' : `${pct}%`;
                return `<div class="border ${col} rounded-xl p-3 text-center">
                    <p class="text-gray-500 text-xs uppercase tracking-wider mb-1">Nó ${id}</p>
                    <p class="mono font-black text-xl ${g.shed ? 'text-purple-400' : pct > 95 ? 'text-red-400' : pct > 75 ? 'text-yellow-400' : 'text-green-400'}">${label}</p>
                    <div class="mt-2 bg-gray-800 rounded-full h-1.5 overflow-hidden">
                        <div class="${barCol} h-1.5 rounded-full transition-all duration-500" style="width:${Math.min(100, pct)}%"></div>
                    </div>
                    <p class="text-gray-700 text-xs mt-1 mono">${Math.round(g.currentLoad)}/${g.capacity}</p>
                </div>`;
            }).join('');
        }
    });

    // Classificação expandida com coluna de papel
    socket.on('admin_leaderboard_update', (entries) => {
        const tbody = document.getElementById('admin-status-leaderboard');
        const countEl = document.getElementById('admin-participant-count');
        if (countEl) countEl.textContent = entries.length;
        if (!tbody) return;
        if (entries.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="text-center text-gray-600 py-6">Sem participantes ainda</td></tr>';
            return;
        }
        tbody.innerHTML = entries.map((e, i) => `
            <tr class="border-b border-gray-800 hover:bg-gray-800/50 transition-colors">
                <td class="px-3 py-2 text-center font-black text-gray-400">${i + 1}</td>
                <td class="px-3 py-2 font-bold text-white truncate max-w-[120px]">${e.name}</td>
                <td class="px-3 py-2 text-center text-blue-400 mono">N${e.group}</td>
                <td class="px-3 py-2 text-center text-xs ${e.role === 'manager' ? 'text-orange-400' : 'text-gray-400'}">${e.role === 'manager' ? '🎛️ Gestor' : '🏠 Cons.'}</td>
                <td class="px-3 py-2 text-center font-black ${e.quizScore > 0 ? 'text-violet-400' : 'text-gray-600'} mono">📝 ${e.quizScore}</td>
                <td class="px-3 py-2 text-center text-green-400 mono">✅ ${e.compliance}</td>
                <td class="px-3 py-2 text-center ${e.havoc > 30 ? 'text-red-400' : 'text-gray-500'} mono">🔥 ${e.havoc}</td>
            </tr>
        `).join('');
    });
}
