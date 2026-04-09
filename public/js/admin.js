// ─── Autenticação do instrutor ────────────────────────────────────────────────
const urlParams  = new URLSearchParams(window.location.search);
const isAdmin    = urlParams.get('admin') === 'true';
const adminPanel = document.getElementById('admin-panel');

if (isAdmin && adminPanel) adminPanel.classList.remove('hidden');

// Register admin immediately (no nickname needed)
if (isAdmin) {
    socket.emit('register_user', { isAdmin: true, name: 'Instrutor' });
}
// Non-admin registration is handled in main.js after nickname entry

// ─── Botões de cenário ────────────────────────────────────────────────────────
const btnScen1 = document.getElementById('btn-start-scen1');
const btnScen2 = document.getElementById('btn-start-scen2');
const btnReset = document.getElementById('btn-reset');
const adminCurrentScenario = document.getElementById('admin-current-scenario');

btnScen1?.addEventListener('click', () => socket.emit('admin_change_scenario', 1));
btnScen2?.addEventListener('click', () => socket.emit('admin_change_scenario', 2));

btnReset?.addEventListener('click', () => {
    if (confirm('Reiniciar todas as métricas e recomeçar o temporizador?')) socket.emit('admin_reset_game');
});

// ─── Controlo de botões por cenário (S2-only = renováveis) ────────────────────
let activeScenarioId = 1;

function applyScenarioButtons(id) {
    activeScenarioId = id;
    // Renewable buttons only shown in Scenario 2
    document.querySelectorAll('[data-s2-only]').forEach(el => {
        el.classList.toggle('hidden', id !== 2);
        el.disabled = id !== 2;
    });
    if (adminCurrentScenario) {
        adminCurrentScenario.textContent = id === 1
            ? 'Cenário 1 — Rede Elétrica Tradicional'
            : 'Cenário 2 — Rede Elétrica Inteligente';
    }
    // Highlight active scenario button
    btnScen1?.classList.toggle('ring-2', id === 1);
    btnScen1?.classList.toggle('ring-white', id === 1);
    btnScen2?.classList.toggle('ring-2', id === 2);
    btnScen2?.classList.toggle('ring-blue-400', id === 2);
}

socket.on('scenario_changed', (data) => {
    const id = data.id || data;
    applyScenarioButtons(id);
});

// Apply on load (default S1)
applyScenarioButtons(1);

// ─── Injeção de eventos ───────────────────────────────────────────────────────
function selectedGroup() {
    const v = document.getElementById('admin-group-select')?.value;
    return v ? parseInt(v) : null;
}

document.getElementById('btn-inject-surge')?.addEventListener('click', () => {
    const g = selectedGroup();
    socket.emit('admin_inject_event', { type: 'surge', group: g });
    showToast(`⚡ Pico de tensão${g ? ` no Nó ${g}` : ' (nó aleatório)'}`, 'warning');
});

document.getElementById('btn-inject-dr')?.addEventListener('click', () => {
    const g = selectedGroup();
    socket.emit('admin_inject_event', { type: 'demand_response', group: g });
    showToast(`📡 Resposta à Procura enviada${g ? ` ao Nó ${g}` : ' (todos)'}`, 'info');
});

document.getElementById('btn-inject-price')?.addEventListener('click', () => {
    socket.emit('admin_inject_event', { type: 'price_spike' });
    showToast('💰 Subida de preço ativada — 30 s', 'warning');
});

document.getElementById('btn-inject-cloud')?.addEventListener('click', () => {
    socket.emit('admin_inject_event', { type: 'cloud' });
    showToast('☁️ Cobertura de nuvens — 30 s (apenas em S2)', 'info');
});

document.getElementById('btn-inject-wind')?.addEventListener('click', () => {
    socket.emit('admin_inject_event', { type: 'wind_drop' });
    const msg = activeScenarioId === 1
        ? '🌬️ Sem turbinas (S1) — geradores fósseis ativados!'
        : '🌬️ Queda de vento — capacidade reduzida (S2)';
    showToast(msg, 'warning');
});

// ─── Controlos do Quiz ────────────────────────────────────────────────────────
const btnStartQuiz  = document.getElementById('btn-start-quiz');
const btnEndQuiz    = document.getElementById('btn-end-quiz');
const quizSelect    = document.getElementById('quiz-question-select');
const quizLiveCount = document.getElementById('quiz-live-count');
const quizVoteBars  = document.getElementById('quiz-vote-bars');

let quizActive = false;

btnStartQuiz?.addEventListener('click', () => {
    const idx = parseInt(quizSelect?.value || '0');
    socket.emit('admin_start_quiz', { questionIndex: idx });
    quizActive = true;
    btnStartQuiz.classList.add('hidden');
    btnEndQuiz?.classList.remove('hidden');
    if (quizLiveCount) { quizLiveCount.classList.remove('hidden'); quizLiveCount.textContent = '0 responderam'; }
    if (quizVoteBars)  quizVoteBars.classList.remove('hidden');
    showToast('📝 Quiz iniciado! Os alunos têm 30 segundos.', 'info');
});

btnEndQuiz?.addEventListener('click', () => {
    socket.emit('admin_end_quiz');
    quizActive = false;
    btnEndQuiz.classList.add('hidden');
    btnStartQuiz?.classList.remove('hidden');
    if (quizLiveCount) quizLiveCount.classList.add('hidden');
    if (quizVoteBars)  quizVoteBars.classList.add('hidden');
    showToast('📊 Resultados do quiz revelados!', 'success');
});

// Live vote mini-bars (admin only)
window.addEventListener('quiz_live_update', (e) => {
    if (!quizActive || !quizVoteBars) return;
    const { counts, total } = e.detail;
    if (quizLiveCount) quizLiveCount.textContent = `${total} responderam`;
    const maxVotos = Math.max(1, ...Object.values(counts));
    quizVoteBars.innerHTML = '';
    Object.entries(counts).forEach(([idx, count]) => {
        const bar = document.createElement('div');
        bar.className = 'bg-violet-600 rounded-sm w-5 transition-all duration-300';
        bar.style.height = `${Math.max(4, Math.round((count / maxVotos) * 28))}px`;
        bar.title = `Opção ${String.fromCharCode(65 + parseInt(idx))}: ${count}`;
        quizVoteBars.appendChild(bar);
    });
});

// (Auto-quiz desativado — perguntas lançadas manualmente pelo instrutor)

// ─── Classificação em tempo real (painel admin) ────────────────────────────────
const adminLeaderboardTable = document.getElementById('admin-leaderboard-table');
const adminLeaderboardToggle = document.getElementById('admin-leaderboard-toggle');
const adminLeaderboardBody   = document.getElementById('admin-leaderboard-body');

adminLeaderboardToggle?.addEventListener('click', () => {
    adminLeaderboardTable?.classList.toggle('hidden');
    adminLeaderboardToggle.textContent = adminLeaderboardTable?.classList.contains('hidden')
        ? '📊 Ver Classificação'
        : '📊 Esconder Classificação';
});

socket.on('admin_leaderboard_update', (entries) => {
    if (!adminLeaderboardBody) return;
    if (entries.length === 0) {
        adminLeaderboardBody.innerHTML = '<tr><td colspan="6" class="text-center text-gray-600 py-3 text-xs">Sem participantes ainda</td></tr>';
        return;
    }
    adminLeaderboardBody.innerHTML = entries.map((e, i) => `
        <tr class="border-b border-gray-800 hover:bg-gray-800 transition-colors">
            <td class="px-3 py-2 text-center font-black text-gray-400">${i + 1}</td>
            <td class="px-3 py-2 font-bold text-white truncate max-w-[120px]">${e.name}</td>
            <td class="px-3 py-2 text-center text-blue-400 mono">N${e.group}</td>
            <td class="px-3 py-2 text-center font-black ${e.quizScore > 0 ? 'text-violet-400' : 'text-gray-600'} mono">📝 ${e.quizScore}</td>
            <td class="px-3 py-2 text-center text-green-400 mono">✅ ${e.compliance}</td>
            <td class="px-3 py-2 text-center ${e.havoc > 30 ? 'text-red-400' : 'text-gray-500'} mono">🔥 ${e.havoc}</td>
        </tr>
    `).join('');
});

// ─── Gráfico de resultados finais ─────────────────────────────────────────────
socket.on('simulation_ended', (payload) => {
    const { metrics, scenario, timeline, snapshots } = payload;

    consumerView?.classList.add('hidden');
    managerView?.classList.add('hidden');
    resultsView?.classList.remove('hidden');

    const el = document.getElementById('results-scenario');
    if (el) el.textContent = scenario === 1 ? 'Rede Elétrica Tradicional' : 'Rede Elétrica Inteligente';

    const ctx = document.getElementById('resultsChart');
    if (ctx) {
        if (window.__resultsChart) window.__resultsChart.destroy();
        window.__resultsChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: ['Apagões', 'Chamadas', 'Resolvidos', 'RP Aceites', 'CO₂ Total (kg)', 'Carga (MW)'],
                datasets: [{
                    label: scenario === 1 ? 'Rede Tradicional' : 'Rede Inteligente',
                    data: [
                        metrics.outages, metrics.callsMade, metrics.issuesResolved,
                        metrics.drAccepted || 0,
                        Math.round((metrics.totalCO2 || 0) / 1000),
                        Math.round(metrics.totalPower / 1000),
                    ],
                    backgroundColor: ['rgba(239,68,68,0.75)','rgba(245,158,11,0.75)','rgba(34,197,94,0.75)','rgba(59,130,246,0.75)','rgba(16,185,129,0.75)','rgba(168,85,247,0.75)'],
                    borderColor: ['#ef4444','#f59e0b','#22c55e','#3b82f6','#10b981','#a855f7'],
                    borderWidth: 1, borderRadius: 6,
                }],
            },
            options: {
                responsive: true,
                plugins: { legend: { display: false }, tooltip: { backgroundColor: '#111827', borderColor: '#374151', borderWidth: 1, titleColor: '#9ca3af', bodyColor: '#f9fafb' } },
                scales: { y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#6b7280' } }, x: { grid: { display: false }, ticks: { color: '#9ca3af', font: { weight: 'bold' } } } },
            },
        });
    }

    // Comparação de cenários
    const compSection = document.getElementById('scenario-comparison');
    const s1Snap = document.getElementById('s1-snapshot');
    const s2Snap = document.getElementById('s2-snapshot');
    if (snapshots && compSection) {
        const hasS1 = !!snapshots[1], hasS2 = !!snapshots[2];
        if (hasS1 || hasS2) {
            compSection.classList.remove('hidden');
            function renderSnap(el, snap) {
                if (!el || !snap) { el && (el.innerHTML = '<p class="text-gray-600 text-xs">Cenário não jogado</p>'); return; }
                const m = snap.metrics;
                el.innerHTML = `
                    <p class="text-red-400">Apagões: <span class="font-black">${m.outages || 0}</span></p>
                    <p class="text-yellow-400">Chamadas: <span class="font-black">${m.callsMade || 0}</span></p>
                    <p class="text-green-400">Resolvidos: <span class="font-black">${m.issuesResolved || 0}</span></p>
                    <p class="text-blue-400">RP Aceites: <span class="font-black">${m.drAccepted || 0}</span></p>
                    <p class="text-emerald-400">CO₂: <span class="font-black">${Math.round((m.totalCO2 || 0) / 1000)} kg</span></p>
                    <p class="text-cyan-400">Estabilidade: <span class="font-black">${m.stabilityScore || 0}%</span></p>
                `;
            }
            renderSnap(s1Snap, snapshots[1]);
            renderSnap(s2Snap, snapshots[2]);

            // Efficiency comparison callout
            if (hasS1 && hasS2) {
                const co2Reduction = Math.round(100 * (1 - (snapshots[2].metrics.totalCO2 || 1) / Math.max(1, snapshots[1].metrics.totalCO2)));
                const outageReduction = Math.max(0, (snapshots[1].metrics.outages || 0) - (snapshots[2].metrics.outages || 0));
                const compCallout = document.getElementById('comparison-callout');
                if (compCallout) {
                    compCallout.innerHTML = `
                        <p class="text-white font-black text-lg mb-1">🌿 A Rede Inteligente reduziu CO₂ em <span class="text-green-400">${co2Reduction}%</span></p>
                        <p class="text-gray-300 text-sm">e evitou <span class="text-blue-400 font-black">${outageReduction}</span> apagão(ões) adicionais comparado com a rede tradicional.</p>
                    `;
                    compCallout.classList.remove('hidden');
                }
            }
        }
    }

    // Cronologia de eventos
    const timelineList = document.getElementById('timeline-list');
    if (timelineList && timeline?.length > 0) {
        const tipoConfig = { outage: {icon:'⚡',color:'text-red-400'}, surge: {icon:'🌩',color:'text-yellow-400'}, dr: {icon:'📡',color:'text-orange-400'}, shed: {icon:'✂️',color:'text-purple-400'}, restore: {icon:'✅',color:'text-green-400'}, balance: {icon:'⚖️',color:'text-blue-400'}, reroute: {icon:'↔',color:'text-blue-300'}, price: {icon:'💰',color:'text-yellow-300'}, renewable: {icon:'🌿',color:'text-sky-400'}, p2p: {icon:'🤝',color:'text-purple-300'}, call: {icon:'📞',color:'text-gray-400'}, quiz: {icon:'📝',color:'text-violet-400'} };
        timelineList.innerHTML = timeline.map(ev => {
            const cfg = tipoConfig[ev.type] || { icon: '•', color: 'text-gray-400' };
            const m = Math.floor(ev.time / 60), s = ev.time % 60;
            return `<div class="flex items-center gap-3 text-sm"><span class="mono text-gray-600 text-xs w-10 shrink-0">${m}:${s < 10 ? '0' : ''}${s}</span><span class="${cfg.color} text-base">${cfg.icon}</span><span class="text-gray-300">${ev.message}</span></div>`;
        }).join('');
    } else if (timelineList) {
        timelineList.innerHTML = '<p class="text-gray-600 text-sm text-center py-4">Sem eventos registados nesta sessão.</p>';
    }
});
