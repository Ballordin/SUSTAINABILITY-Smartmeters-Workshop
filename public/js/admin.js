// ─── Autenticação do instrutor ────────────────────────────────────────────────
const urlParams  = new URLSearchParams(window.location.search);
const isAdmin    = urlParams.get('admin') === 'true';
const adminPanel = document.getElementById('admin-panel');

if (isAdmin && adminPanel) adminPanel.classList.remove('hidden');

socket.emit('register_user', { isAdmin });

// ─── Botões de cenário ────────────────────────────────────────────────────────
document.getElementById('btn-start-scen1').addEventListener('click', () => socket.emit('admin_change_scenario', 1));
document.getElementById('btn-start-scen2').addEventListener('click', () => socket.emit('admin_change_scenario', 2));

document.getElementById('btn-reset').addEventListener('click', () => {
    if (confirm('Reiniciar todas as métricas e recomeçar o temporizador?')) {
        socket.emit('admin_reset_game');
    }
});

socket.on('scenario_changed', (id) => {
    const el = document.getElementById('admin-current-scenario');
    if (el) el.textContent = id === 1
        ? 'Cenário 1 — Rede Clássica'
        : 'Cenário 2 — Rede Inteligente';
});

// ─── Injeção de eventos ───────────────────────────────────────────────────────
function selectedGroup() {
    const v = document.getElementById('admin-group-select')?.value;
    return v ? parseInt(v) : null;
}

document.getElementById('btn-inject-surge').addEventListener('click', () => {
    const g = selectedGroup();
    socket.emit('admin_inject_event', { type: 'surge', group: g });
    showToast(`⚡ Pico de tensão injetado${g ? ` no Nó ${g}` : ' (nó aleatório)'}`, 'warning');
});

document.getElementById('btn-inject-dr').addEventListener('click', () => {
    const g = selectedGroup();
    socket.emit('admin_inject_event', { type: 'demand_response', group: g });
    showToast(`📡 Resposta à Procura enviada${g ? ` ao Nó ${g}` : ' (todos)'}`, 'info');
});

document.getElementById('btn-inject-price').addEventListener('click', () => {
    socket.emit('admin_inject_event', { type: 'price_spike' });
    showToast('💰 Subida de preço ativada — 30 s', 'warning');
});

document.getElementById('btn-inject-cloud').addEventListener('click', () => {
    socket.emit('admin_inject_event', { type: 'cloud' });
    showToast('☁️ Evento de nuvens iniciado — 30 s', 'info');
});

document.getElementById('btn-inject-wind').addEventListener('click', () => {
    socket.emit('admin_inject_event', { type: 'wind_drop' });
    showToast('🌬️ Evento de queda de vento iniciado — 25 s', 'info');
});

// ─── Controlos do Quiz ────────────────────────────────────────────────────────
const btnStartQuiz  = document.getElementById('btn-start-quiz');
const btnEndQuiz    = document.getElementById('btn-end-quiz');
const quizSelect    = document.getElementById('quiz-question-select');
const quizLiveCount = document.getElementById('quiz-live-count');
const quizVoteBars  = document.getElementById('quiz-vote-bars');

let quizActive = false;

btnStartQuiz.addEventListener('click', () => {
    const idx = parseInt(quizSelect?.value || '0');
    socket.emit('admin_start_quiz', { questionIndex: idx });
    quizActive = true;
    btnStartQuiz.classList.add('hidden');
    btnEndQuiz.classList.remove('hidden');
    quizLiveCount.classList.remove('hidden');
    quizVoteBars.classList.remove('hidden');
    quizLiveCount.textContent = '0 responderam';
    showToast('📝 Quiz iniciado!', 'info');
});

btnEndQuiz.addEventListener('click', () => {
    socket.emit('admin_end_quiz');
    quizActive = false;
    btnEndQuiz.classList.add('hidden');
    btnStartQuiz.classList.remove('hidden');
    quizLiveCount.classList.add('hidden');
    quizVoteBars.classList.add('hidden');
    showToast('📊 Resultados do quiz revelados!', 'success');
});

// Barras de votos em tempo real (apenas para o instrutor)
window.addEventListener('quiz_live_update', (e) => {
    if (!quizActive || !quizVoteBars) return;
    const { counts, total } = e.detail;
    quizLiveCount.textContent = `${total} responderam`;
    const maxVotos = Math.max(1, ...Object.values(counts));
    quizVoteBars.innerHTML = '';
    Object.entries(counts).forEach(([idx, count]) => {
        const bar = document.createElement('div');
        const h = Math.max(4, Math.round((count / maxVotos) * 28));
        bar.className = 'bg-violet-600 rounded-sm w-5 transition-all duration-300';
        bar.style.height = `${h}px`;
        bar.title = `Opção ${String.fromCharCode(65 + parseInt(idx))}: ${count}`;
        quizVoteBars.appendChild(bar);
    });
});

// ─── Modal QR Code ────────────────────────────────────────────────────────────
const btnShowQr  = document.getElementById('btn-show-qr');
const qrModal    = document.getElementById('qr-modal');
const qrImg      = document.getElementById('qr-code-img');
const qrUrlText  = document.getElementById('qr-url-text');
const closeQrBtn = document.getElementById('close-qr-modal');

btnShowQr.addEventListener('click', () => {
    const baseUrl = window.location.origin + window.location.pathname.replace(/\?.*/, '');
    if (qrUrlText) qrUrlText.textContent = baseUrl;
    if (qrImg) {
        const encoded = encodeURIComponent(baseUrl);
        qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?data=${encoded}&size=200x200&color=000000&bgcolor=ffffff`;
    }
    if (qrModal) qrModal.classList.remove('hidden');
});

if (closeQrBtn) closeQrBtn.addEventListener('click', () => qrModal?.classList.add('hidden'));
qrModal?.addEventListener('click', (e) => { if (e.target === qrModal) qrModal.classList.add('hidden'); });

// ─── Gráfico de resultados finais ─────────────────────────────────────────────
socket.on('simulation_ended', (payload) => {
    const { metrics, scenario, timeline, snapshots } = payload;

    if (consumerView) consumerView.classList.add('hidden');
    if (managerView)  managerView.classList.add('hidden');
    resultsView.classList.remove('hidden');

    const el = document.getElementById('results-scenario');
    if (el) el.textContent = scenario;

    // Gráfico de barras principal
    const ctx = document.getElementById('resultsChart');
    if (ctx) {
        if (window.__resultsChart) window.__resultsChart.destroy();
        window.__resultsChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: ['Apagões', 'Chamadas', 'Resolvidos', 'RP Aceites', 'Carga Total (MW)'],
                datasets: [{
                    label: `Cenário ${scenario}`,
                    data: [
                        metrics.outages,
                        metrics.callsMade,
                        metrics.issuesResolved,
                        metrics.drAccepted || 0,
                        Math.round(metrics.totalPower / 1000),
                    ],
                    backgroundColor: [
                        'rgba(239,68,68,0.75)',
                        'rgba(245,158,11,0.75)',
                        'rgba(34,197,94,0.75)',
                        'rgba(59,130,246,0.75)',
                        'rgba(168,85,247,0.75)',
                    ],
                    borderColor: ['#ef4444','#f59e0b','#22c55e','#3b82f6','#a855f7'],
                    borderWidth: 1,
                    borderRadius: 6,
                }],
            },
            options: {
                responsive: true,
                plugins: {
                    legend: { display: false },
                    tooltip: { backgroundColor: '#111827', borderColor: '#374151', borderWidth: 1, titleColor: '#9ca3af', bodyColor: '#f9fafb' },
                },
                scales: {
                    y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#6b7280' } },
                    x: { grid: { display: false }, ticks: { color: '#9ca3af', font: { weight: 'bold' } } },
                },
            },
        });
    }

    // Comparação de cenários
    const compSection = document.getElementById('scenario-comparison');
    const s1Snap = document.getElementById('s1-snapshot');
    const s2Snap = document.getElementById('s2-snapshot');

    if (snapshots && (snapshots[1] || snapshots[2]) && compSection) {
        compSection.classList.remove('hidden');
        function renderSnap(el, snap) {
            if (!el || !snap) return;
            el.innerHTML = `
                <p class="text-red-400">Apagões: <span class="font-black">${snap.outages || 0}</span></p>
                <p class="text-yellow-400">Chamadas: <span class="font-black">${snap.callsMade || 0}</span></p>
                <p class="text-green-400">Resolvidos: <span class="font-black">${snap.issuesResolved || 0}</span></p>
                <p class="text-blue-400">RP Aceites: <span class="font-black">${snap.drAccepted || 0}</span></p>
            `;
        }
        renderSnap(s1Snap, snapshots[1]);
        renderSnap(s2Snap, snapshots[2]);
    }

    // Cronologia de eventos
    const timelineList = document.getElementById('timeline-list');
    if (timelineList && timeline && timeline.length > 0) {
        const tipoConfig = {
            outage:    { icon: '⚡', color: 'text-red-400'    },
            surge:     { icon: '🌩', color: 'text-yellow-400' },
            dr:        { icon: '📡', color: 'text-orange-400' },
            shed:      { icon: '✂️', color: 'text-purple-400' },
            restore:   { icon: '✅', color: 'text-green-400'  },
            balance:   { icon: '⚖️', color: 'text-blue-400'   },
            reroute:   { icon: '↔', color: 'text-blue-300'   },
            price:     { icon: '💰', color: 'text-yellow-300' },
            renewable: { icon: '🌿', color: 'text-sky-400'    },
            p2p:       { icon: '🤝', color: 'text-purple-300' },
            call:      { icon: '📞', color: 'text-gray-400'   },
        };
        timelineList.innerHTML = timeline.map(ev => {
            const cfg = tipoConfig[ev.type] || { icon: '•', color: 'text-gray-400' };
            const m = Math.floor(ev.time / 60), s = ev.time % 60;
            return `
                <div class="flex items-center gap-3 text-sm">
                    <span class="mono text-gray-600 text-xs w-10 shrink-0">${m}:${s < 10 ? '0' : ''}${s}</span>
                    <span class="${cfg.color} text-base">${cfg.icon}</span>
                    <span class="text-gray-300">${ev.message}</span>
                </div>
            `;
        }).join('');
    } else if (timelineList) {
        timelineList.innerHTML = '<p class="text-gray-600 text-sm text-center py-4">Sem eventos registados nesta sessão.</p>';
    }
});
