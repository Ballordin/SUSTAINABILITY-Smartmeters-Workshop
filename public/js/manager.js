// ─── Manager DOM refs ─────────────────────────────────────────────────────────
const inboxList     = document.getElementById('inbox-list');
const inboxEmpty    = document.getElementById('inbox-empty');
const inboxCount    = document.getElementById('inbox-count');
const s2Inbox       = document.getElementById('s2-inbox');
const s2InboxEmpty  = document.getElementById('s2-inbox-empty');
const routingPanel  = document.getElementById('routing-suggestions');
const statOutages   = document.getElementById('stat-outages');
const statCalls     = document.getElementById('stat-calls');
const statResolved  = document.getElementById('stat-resolved');
const drCountLabel  = document.getElementById('dr-count');

// Chat modal (manager side)
const chatModal       = document.getElementById('chat-modal');
const chatUserId      = document.getElementById('chat-user-id');
const chatHistory     = document.getElementById('chat-history');
const closeChatBtn    = document.getElementById('close-chat-btn');
const diagButtons     = document.querySelectorAll('.diag-btn');
const resolutionBar   = document.getElementById('resolution-bar');
const diagStepsLabel  = document.getElementById('diag-steps-label');
const restorePowerBtn = document.getElementById('restore-power-btn');

// ─── Manager local state ──────────────────────────────────────────────────────
let activeTargetId  = null;   // consumer currently being diagnosed
let diagSteps       = 0;
let inboxItems      = {};     // { userId: domElement }
let ticketCounts    = { 1: 0, 2: 0, 3: 0, 4: 0 };
let drAccepted      = 0;

// ─── Live load chart (Scenario 2) ────────────────────────────────────────────
let loadChart = null;
const loadHistory = { 1: [], 2: [], 3: [], 4: [] };
const MAX_HISTORY = 30; // 30 seconds of history

function initLoadChart() {
    const canvas = document.getElementById('load-chart-canvas');
    if (!canvas) return;
    if (loadChart) loadChart.destroy();

    const labels = Array.from({ length: MAX_HISTORY }, (_, i) => `${MAX_HISTORY - i}s`).reverse();

    loadChart = new Chart(canvas, {
        type: 'line',
        data: {
            labels,
            datasets: [
                { label: 'Node 1', data: Array(MAX_HISTORY).fill(0), borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.06)', tension: 0.4, pointRadius: 0, fill: true },
                { label: 'Node 2', data: Array(MAX_HISTORY).fill(0), borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.06)', tension: 0.4, pointRadius: 0, fill: true },
                { label: 'Node 3', data: Array(MAX_HISTORY).fill(0), borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.06)', tension: 0.4, pointRadius: 0, fill: true },
                { label: 'Node 4', data: Array(MAX_HISTORY).fill(0), borderColor: '#a855f7', backgroundColor: 'rgba(168,85,247,0.06)', tension: 0.4, pointRadius: 0, fill: true },
            ],
        },
        options: {
            responsive: true,
            animation: { duration: 250 },
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { labels: { color: '#9ca3af', font: { family: 'JetBrains Mono', size: 11 } } },
                tooltip: { backgroundColor: '#111827', borderColor: '#374151', borderWidth: 1, titleColor: '#9ca3af', bodyColor: '#f9fafb' },
            },
            scales: {
                y: { min: 0, max: 100, grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#4b5563', callback: v => `${v}%` } },
                x: { grid: { display: false }, ticks: { color: '#374151', maxTicksLimit: 6, font: { family: 'JetBrains Mono', size: 9 } } },
            },
        },
    });
}

// ─── Node card helpers ────────────────────────────────────────────────────────
function getLoadColour(pct) {
    if (pct > 95) return 'bg-red-600';
    if (pct > 75) return 'bg-yellow-500';
    if (pct > 50) return 'bg-blue-500';
    return 'bg-green-500';
}

function getNodeStatus(pct, shed) {
    if (shed)    return { label: 'Shedding', classes: 'bg-purple-900 border-purple-700 text-purple-300' };
    if (pct > 95) return { label: '🔴 Critical', classes: 'bg-red-900 border-red-700 text-red-300' };
    if (pct > 75) return { label: '🟡 Warning',  classes: 'bg-yellow-900 border-yellow-700 text-yellow-300' };
    return { label: '🟢 Normal', classes: 'bg-green-900 border-green-800 text-green-300' };
}

function updateNodeCard(nodeId, pct, shed) {
    const bar    = document.getElementById(`load-bar-${nodeId}`);
    const pctEl  = document.getElementById(`load-pct-${nodeId}`);
    const badge  = document.querySelector(`#node-card-${nodeId} .node-badge`);
    const card   = document.getElementById(`node-card-${nodeId}`);
    const tkBadge = document.getElementById(`ticket-badge-${nodeId}`);
    const shedBtn  = document.querySelector(`.shed-btn[data-group="${nodeId}"]`);
    const rerouteBtn = document.querySelector(`.reroute-btn[data-group="${nodeId}"]`);

    if (bar)   { bar.style.width = `${Math.min(100, pct)}%`; bar.className = `load-bar h-2.5 rounded-full ${getLoadColour(pct)}`; }
    if (pctEl) pctEl.textContent = `${Math.round(pct)}%`;

    const status = getNodeStatus(pct, shed);
    if (badge) {
        badge.textContent = status.label;
        badge.className   = `node-badge text-xs font-bold px-2 py-1 rounded-lg border ${status.classes}`;
    }

    if (card) {
        card.classList.remove('warn', 'crit', 'shed');
        if (shed)     card.classList.add('shed');
        else if (pct > 95) card.classList.add('crit');
        else if (pct > 75) card.classList.add('warn');
    }

    const count = ticketCounts[nodeId] || 0;
    if (tkBadge) {
        if (count > 0) { tkBadge.classList.remove('hidden'); tkBadge.textContent = `🎫 ${count}`; }
        else             tkBadge.classList.add('hidden');
    }

    // Show/hide action buttons based on scenario
    if (shedBtn)    shedBtn.classList.toggle('hidden',    currentScenario !== 1);
    if (rerouteBtn) rerouteBtn.classList.toggle('hidden', currentScenario !== 2);
}

// ─── State updates from server ────────────────────────────────────────────────
socket.on('state_update', (state) => {
    if (myRole !== 'manager') return;

    // Metrics bar (Scenario 1 only)
    if (state.metrics) {
        if (statOutages)  statOutages.textContent  = state.metrics.outages;
        if (statCalls)    statCalls.textContent     = state.metrics.callsMade;
        if (statResolved) statResolved.textContent  = state.metrics.issuesResolved;
    }

    // Node cards
    for (let i = 1; i <= 4; i++) {
        const g = state.groups[i];
        if (!g) continue;
        const pct = g.capacity > 0 ? (g.currentLoad / g.capacity) * 100 : 0;

        updateNodeCard(i, pct, g.shed);

        // Push to chart history
        if (currentScenario === 2 && loadChart) {
            loadHistory[i].push(Math.round(pct));
            if (loadHistory[i].length > MAX_HISTORY) loadHistory[i].shift();
            loadChart.data.datasets[i - 1].data = [...loadHistory[i]];
        }
    }

    if (currentScenario === 2 && loadChart) loadChart.update();
});

// ─── Alert inbox (Scenario 1) ─────────────────────────────────────────────────
socket.on('new_ticket', (data) => {
    if (myRole !== 'manager') return;

    const { group, userId } = data;
    ticketCounts[group] = (ticketCounts[group] || 0) + 1;
    updateNodeCard(group, 0, false); // re-render badge; real pct comes from state_update

    // Build inbox card
    if (!inboxItems[userId]) {
        const div = document.createElement('div');
        div.className = 'slide-down bg-gray-800 border border-gray-700 rounded-xl p-3 flex items-center justify-between gap-3';
        div.innerHTML = `
            <div class="flex-1 min-w-0">
                <p class="text-sm font-bold text-white">Node ${group} <span class="text-red-400">— Outage</span></p>
                <p class="text-xs text-gray-500 mono truncate">${userId.slice(0, 8)}…</p>
            </div>
            <div class="flex gap-2 shrink-0">
                <button class="chat-btn bg-blue-900 hover:bg-blue-800 border border-blue-700 text-blue-300 text-xs px-2.5 py-1.5 rounded-lg font-bold transition-colors" data-id="${userId}">💬 Chat</button>
                <button class="fix-btn bg-green-900 hover:bg-green-800 border border-green-700 text-green-300 text-xs px-2.5 py-1.5 rounded-lg font-bold transition-colors" data-id="${userId}">⚡ Restore</button>
            </div>
        `;
        div.querySelector('.chat-btn').addEventListener('click', () => openChat(userId));
        div.querySelector('.fix-btn').addEventListener('click', () => {
            socket.emit('resolve_issue', { targetId: userId });
            removeTicket(userId, group);
        });

        inboxItems[userId] = { el: div, group };
        if (inboxList) inboxList.prepend(div);
        if (inboxEmpty) inboxEmpty.classList.add('hidden');

        // Same card in S2 inbox
        const s2Div = div.cloneNode(true);
        s2Div.querySelector('.chat-btn').addEventListener('click', () => openChat(userId));
        s2Div.querySelector('.fix-btn').addEventListener('click', () => {
            socket.emit('resolve_issue', { targetId: userId });
            removeTicket(userId, group);
        });
        if (s2Inbox) { s2Inbox.prepend(s2Div); if (s2InboxEmpty) s2InboxEmpty.classList.add('hidden'); }
    }

    // Update inbox count badge
    const total = Object.values(ticketCounts).reduce((a, b) => a + b, 0);
    if (inboxCount) inboxCount.textContent = total;
});

function removeTicket(userId, group) {
    const entry = inboxItems[userId];
    if (entry) { entry.el.remove(); delete inboxItems[userId]; }
    ticketCounts[group] = Math.max(0, (ticketCounts[group] || 1) - 1);
    const total = Object.values(ticketCounts).reduce((a, b) => a + b, 0);
    if (inboxCount) inboxCount.textContent = total;
    if (total === 0 && inboxEmpty)  inboxEmpty.classList.remove('hidden');
    showToast('✅ Power restored for consumer.', 'success');
}

// ─── Scenario 1: emergency shed buttons (node card + panel) ───────────────────
document.querySelectorAll('.shed-btn, .shed-btn-panel').forEach(btn => {
    btn.addEventListener('click', () => {
        const g = btn.dataset.group;
        if (confirm(`Cut power to Node ${g} for 15 seconds? This affects ALL consumers on that node.`)) {
            socket.emit('manager_load_shed', { group: parseInt(g) });
            showToast(`⚡ Node ${g} load-shed initiated (auto-restore in 15 s)`, 'warning');
        }
    });
});

// ─── Scenario 2: Auto-balance ─────────────────────────────────────────────────
const autoBalanceBtn = document.getElementById('auto-balance-btn');
const autoBalanceMsg = document.getElementById('auto-balance-msg');

if (autoBalanceBtn) {
    autoBalanceBtn.addEventListener('click', () => {
        socket.emit('manager_auto_balance');
        autoBalanceBtn.disabled = true;
        autoBalanceBtn.textContent = '⏳ Balancing…';
        setTimeout(() => {
            autoBalanceBtn.disabled = false;
            autoBalanceBtn.textContent = '⚡ Auto-Balance Grid';
        }, 3000);
    });
}

socket.on('auto_balance_result', (data) => {
    if (!autoBalanceMsg) return;
    if (data.from) {
        autoBalanceMsg.textContent = `✅ Rerouted 100 kW from Node ${data.from} → Node ${data.to}`;
        autoBalanceMsg.classList.remove('hidden', 'text-red-400');
        autoBalanceMsg.classList.add('text-green-400');
        showToast(`Grid balanced: Node ${data.from} → Node ${data.to}`, 'success');
    } else {
        autoBalanceMsg.textContent = 'ℹ️ Grid is balanced — no action needed.';
        autoBalanceMsg.classList.remove('hidden', 'text-green-400');
        autoBalanceMsg.classList.add('text-gray-400');
    }
    setTimeout(() => autoBalanceMsg.classList.add('hidden'), 5000);
});

// ─── Scenario 2: Demand response broadcast ────────────────────────────────────
const broadcastDrBtn = document.getElementById('broadcast-dr-btn');
const drTargetGroup  = document.getElementById('dr-target-group');

if (broadcastDrBtn) {
    broadcastDrBtn.addEventListener('click', () => {
        const group = drTargetGroup?.value ? parseInt(drTargetGroup.value) : null;
        socket.emit('manager_demand_response', { group });
        const target = group ? `Node ${group}` : 'all consumers';
        showToast(`📡 Demand response sent to ${target}`, 'info');
        broadcastDrBtn.disabled = true;
        setTimeout(() => { broadcastDrBtn.disabled = false; }, 5000);
    });
}

socket.on('state_update', (state) => {
    if (myRole !== 'manager' || currentScenario !== 2) return;
    if (drCountLabel && state.metrics) {
        drCountLabel.textContent = `${state.metrics.drAccepted || 0} consumers accepted`;
    }
});

// ─── Scenario 2: Predictive alert ────────────────────────────────────────────
socket.on('predictive_alert', (data) => {
    if (myRole !== 'manager') return;
    if (!routingPanel) return;

    const p = document.createElement('p');
    p.className = 'slide-down text-sm text-yellow-300 bg-yellow-950 border border-yellow-800 rounded-lg px-3 py-2 flex items-center justify-between gap-2';
    p.innerHTML = `
        <span>⚠️ Node ${data.overloadedGroup} nearing limit → reroute to Node ${data.safeGroup}</span>
        <button class="reroute-confirm bg-yellow-700 hover:bg-yellow-600 border border-yellow-500 px-2.5 py-1 rounded-lg text-xs font-black transition-colors text-white">Reroute</button>
    `;
    p.querySelector('.reroute-confirm').addEventListener('click', () => {
        socket.emit('reroute_power', { from: data.overloadedGroup, to: data.safeGroup });
        showToast(`↔ Rerouted load: Node ${data.overloadedGroup} → Node ${data.safeGroup}`, 'success');
        p.remove();
    });

    // Clear placeholder text
    const placeholder = routingPanel.querySelector('p:only-child');
    if (placeholder) placeholder.remove();

    routingPanel.prepend(p);

    // Auto-remove alert after 20 s
    setTimeout(() => { if (p.parentElement) p.remove(); }, 20000);
    showToast(`⚠️ Node ${data.overloadedGroup} approaching capacity!`, 'warning');
});

// ─── Leaderboard (Scenario 2) ─────────────────────────────────────────────────
socket.on('leaderboard_update', (entries) => {
    if (myRole !== 'manager' || currentScenario !== 2) return;
    const list = document.getElementById('leaderboard-list');
    if (!list) return;
    if (entries.length === 0) {
        list.innerHTML = '<p class="text-gray-600 text-sm text-center py-4">Waiting for consumer data...</p>';
        return;
    }
    list.innerHTML = entries.slice(0, 8).map((e, i) => {
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`;
        const havocColor = e.havoc > 30 ? 'text-red-400' : 'text-gray-500';
        return `
            <div class="flex items-center justify-between bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                <span class="font-bold w-8 text-center">${medal}</span>
                <span class="flex-1 text-gray-300 mono text-xs">${e.id.slice(0, 8)}… <span class="text-blue-500">N${e.group}</span></span>
                <span class="text-green-400 font-black mr-3">✅ ${e.compliance}</span>
                <span class="${havocColor} font-bold mono text-xs">🔥 ${e.havoc}</span>
            </div>
        `;
    }).join('');
});

// ─── Node card reroute buttons (Scenario 2) ───────────────────────────────────
document.querySelectorAll('.reroute-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const from = parseInt(btn.dataset.group);
        const candidates = [1, 2, 3, 4].filter(n => n !== from);
        const to = candidates[Math.floor(Math.random() * candidates.length)];
        socket.emit('reroute_power', { from, to });
        showToast(`↔ Load shifted: Node ${from} → Node ${to}`, 'success');
    });
});

// ─── Diagnostic chat modal ────────────────────────────────────────────────────
function openChat(userId) {
    activeTargetId = userId;
    diagSteps = 0;
    if (chatUserId)      chatUserId.textContent = userId.slice(0, 8) + '…';
    if (chatHistory)     chatHistory.innerHTML  = '<p class="text-gray-600 text-xs italic text-center">Connection established...</p>';
    if (resolutionBar)   resolutionBar.style.width = '0%';
    if (diagStepsLabel)  diagStepsLabel.textContent = '0 / 4 steps';
    if (restorePowerBtn) {
        restorePowerBtn.disabled = true;
        restorePowerBtn.textContent = 'DIAGNOSTICS INCOMPLETE';
    }
    diagButtons.forEach(b => { b.disabled = false; b.classList.remove('opacity-40'); });
    if (chatModal) chatModal.classList.remove('hidden');
}

if (closeChatBtn) closeChatBtn.addEventListener('click', () => chatModal?.classList.add('hidden'));

diagButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        if (!activeTargetId) return;
        socket.emit('manager_ask_question', {
            targetId: activeTargetId,
            question: btn.dataset.q,
            answer: btn.dataset.a,
        });
        btn.disabled = true;
        btn.classList.add('opacity-40');
        appendChatMsg(`You: ${btn.dataset.q}`, 'text-blue-400');
        diagSteps++;
        const pct = (diagSteps / 4) * 100;
        if (resolutionBar) resolutionBar.style.width = `${pct}%`;
        if (diagStepsLabel) diagStepsLabel.textContent = `${diagSteps} / 4 steps`;
        if (diagSteps >= 4 && restorePowerBtn) {
            restorePowerBtn.disabled = false;
            restorePowerBtn.textContent = '✅ RESTORE POWER';
        }
    });
});

socket.on('incoming_reply', (data) => {
    appendChatMsg(`Consumer: ${data.answer}`, 'text-gray-300');
});

function appendChatMsg(text, colorClass) {
    if (!chatHistory) return;
    const p = document.createElement('p');
    p.className = `${colorClass} text-sm`;
    p.textContent = text;
    chatHistory.appendChild(p);
    chatHistory.scrollTop = chatHistory.scrollHeight;
}

if (restorePowerBtn) {
    restorePowerBtn.addEventListener('click', () => {
        if (!activeTargetId) return;
        socket.emit('resolve_issue', { targetId: activeTargetId });
        removeTicket(activeTargetId, myGroup);
        chatModal?.classList.add('hidden');
        activeTargetId = null;
    });
}

// ─── Init chart when switching to Scenario 2 ─────────────────────────────────
socket.on('scenario_changed', (id) => {
    if (myRole !== 'manager') return;
    ticketCounts = { 1: 0, 2: 0, 3: 0, 4: 0 };
    inboxItems   = {};
    if (id === 2) setTimeout(initLoadChart, 100);
});

socket.on('role_assigned', (data) => {
    if (data.role !== 'manager') return;
    ticketCounts = { 1: 0, 2: 0, 3: 0, 4: 0 };
    inboxItems   = {};
    if (data.scenario === 2) setTimeout(initLoadChart, 100);
});
