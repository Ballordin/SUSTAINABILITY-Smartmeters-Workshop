// ─── DOM refs ─────────────────────────────────────────────────────────────────
const powerStatus   = document.getElementById('power-status');
const powerLabel    = document.getElementById('power-label');
const powerDot      = document.getElementById('power-dot');
const callHelpBtn   = document.getElementById('call-help-btn');
const havocSpan     = document.getElementById('havoc-score');
const complianceSpan= document.getElementById('compliance-score');
const usageBar      = document.getElementById('usage-bar');
const totalWatts    = document.getElementById('total-watts');
const s1CostSpan    = document.getElementById('s1-cost');
const s2CostSpan    = document.getElementById('s2-cost');

// Task UI
const taskBox       = document.getElementById('consumer-task-box');
const taskNameEl    = document.getElementById('task-name');
const taskTargetEl  = document.getElementById('task-target');
const taskProgressBar = document.getElementById('task-progress');

// Scenario 2 UI
const produceSlider = document.getElementById('produce-slider');
const solarPct      = document.getElementById('solar-pct');
const solarWatts    = document.getElementById('solar-watts');
const batteryPct    = document.getElementById('battery-pct');
const batteryBar    = document.getElementById('battery-bar');
const netLabel      = document.getElementById('net-label');
const importBar     = document.getElementById('import-bar');
const exportBar     = document.getElementById('export-bar');
const priceBadge    = document.getElementById('price-tier-badge');
const priceValue    = document.getElementById('price-value');
const drBanner      = document.getElementById('dr-banner');
const drAcceptBtn   = document.getElementById('dr-accept-btn');
const drIgnoreBtn   = document.getElementById('dr-ignore-btn');

// Chat (consumer side)
const consumerChatModal = document.getElementById('consumer-chat-modal');
const consumerQuestion  = document.getElementById('consumer-incoming-question');
const consumerReplyBtn  = document.getElementById('consumer-reply-btn');
const consumerReplyText = document.getElementById('consumer-reply-text');

// ─── Appliance definitions (mirrors server) ───────────────────────────────────
const APPLIANCES = {
    lights: { name: 'Lights',     icon: '💡', watts: 100,  loadValue: 5  },
    tv:     { name: 'TV',         icon: '📺', watts: 150,  loadValue: 8  },
    ac:     { name: 'AC',         icon: '❄️',  watts: 800,  loadValue: 22 },
    oven:   { name: 'Oven',       icon: '🍳', watts: 700,  loadValue: 19 },
    washer: { name: 'Washer',     icon: '🫧', watts: 500,  loadValue: 14 },
    ev:     { name: 'EV Charger', icon: '🚗', watts: 1200, loadValue: 32 },
};

// ─── Local state ──────────────────────────────────────────────────────────────
let applianceState  = {};   // { lights: true, ac: false, … }
let currentPrice    = 0.15; // €/kWh – updated by server
let currentBatMode  = 'idle';
let solarOutput     = 0;    // 0-100
let currentConsumption = 0; // 0-100
let drActive        = false;
let currentManagerId = null;

// Total watts from all active appliances
function calcTotalWatts() {
    return Object.entries(applianceState)
        .filter(([, on]) => on)
        .reduce((sum, [key]) => sum + (APPLIANCES[key]?.watts || 0), 0);
}

// Consumption pct (0-100 scale, mirrors server logic)
function calcConsumptionPct() {
    return Object.entries(applianceState)
        .filter(([, on]) => on)
        .reduce((sum, [key]) => sum + (APPLIANCES[key]?.loadValue || 0), 0);
}

// ─── Build appliance card grid ────────────────────────────────────────────────
function buildApplianceGrid(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';

    Object.entries(APPLIANCES).forEach(([key, app]) => {
        const isOn = !!applianceState[key];
        const card = document.createElement('button');
        card.id = `app-btn-${containerId}-${key}`;
        card.dataset.key = key;
        card.className = `appliance-btn flex flex-col items-center justify-center gap-1.5 p-3 rounded-xl border-2 transition-all
            ${isOn
                ? 'bg-yellow-900 border-yellow-500 text-yellow-200 shadow-lg shadow-yellow-900/40 on'
                : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500'}`;
        card.innerHTML = `
            <span class="text-2xl">${app.icon}</span>
            <span class="text-xs font-bold leading-tight text-center">${app.name}</span>
            <span class="mono text-xs ${isOn ? 'text-yellow-400' : 'text-gray-600'}">${app.watts}W</span>
            <div class="w-2 h-2 rounded-full ${isOn ? 'bg-yellow-400 shadow shadow-yellow-400' : 'bg-gray-700'}"></div>
        `;
        card.addEventListener('click', () => {
            if (!isPowered) {
                showToast('⚡ No power! Wait for restoration.', 'error');
                return;
            }
            socket.emit('toggle_appliance', { appliance: key });
        });
        container.appendChild(card);
    });
}

// ─── Sync card visuals from server state ─────────────────────────────────────
function refreshApplianceCards() {
    ['appliance-grid', 's2-appliance-grid'].forEach(containerId => {
        Object.entries(APPLIANCES).forEach(([key]) => {
            const btn = document.getElementById(`app-btn-${containerId}-${key}`);
            if (!btn) return;
            const isOn = !!applianceState[key];
            btn.className = `appliance-btn flex flex-col items-center justify-center gap-1.5 p-3 rounded-xl border-2 transition-all
                ${isOn
                    ? 'bg-yellow-900 border-yellow-500 text-yellow-200 shadow-lg shadow-yellow-900/40 on'
                    : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500'}`;
            const dot  = btn.querySelector('.rounded-full');
            const watt = btn.querySelector('.mono');
            if (dot)  dot.className  = `w-2 h-2 rounded-full ${isOn ? 'bg-yellow-400 shadow shadow-yellow-400' : 'bg-gray-700'}`;
            if (watt) watt.className = `mono text-xs ${isOn ? 'text-yellow-400' : 'text-gray-600'}`;
        });
    });
}

// ─── Update usage bar & cost ───────────────────────────────────────────────────
function updateUsageDisplay() {
    const w   = calcTotalWatts();
    const pct = Math.min(100, (w / 3450) * 100); // 3450 W = all appliances on

    if (usageBar) {
        usageBar.style.width = `${pct}%`;
        usageBar.className = `load-bar h-4 rounded-full ${pct > 80 ? 'bg-red-500' : pct > 55 ? 'bg-yellow-500' : 'bg-green-500'}`;
    }
    if (totalWatts) totalWatts.textContent = `${w} W`;

    // Hourly cost = kW × €/kWh
    const hourly = (w / 1000) * currentPrice;
    if (s1CostSpan) s1CostSpan.textContent = `€${hourly.toFixed(3)}/h`;

    // Scenario 2 net cost accounting for solar & battery
    if (currentScenario === 2) {
        const netKw = Math.max(0, (currentConsumption - solarOutput - (currentBatMode === 'discharge' ? 15 : 0) + (currentBatMode === 'charge' ? 10 : 0)) / 100 * 3.45);
        const s2Hourly = netKw * currentPrice;
        if (s2CostSpan) s2CostSpan.textContent = `€${s2Hourly.toFixed(3)}/h`;

        // Import/export bars
        const netPct = Math.min(100, Math.abs(netKw / 3.45) * 100);
        const isExporting = currentConsumption < solarOutput;
        if (importBar) importBar.style.width = isExporting ? '0%' : `${netPct}%`;
        if (exportBar) exportBar.style.width = isExporting ? `${netPct}%` : '0%';
        if (netLabel) netLabel.textContent = `Net: ${isExporting ? '−' : '+'}${Math.round(netKw * 1000)} W`;
    }
}

// ─── Initialise grids once role is assigned ───────────────────────────────────
socket.on('role_assigned', (data) => {
    if (data.role !== 'consumer') return;
    applianceState = {};
    buildApplianceGrid('appliance-grid');
    buildApplianceGrid('s2-appliance-grid');
    updateUsageDisplay();
    updatePowerUI(true);
});

socket.on('scenario_changed', (id) => {
    if (myRole !== 'consumer') return;
    buildApplianceGrid('appliance-grid');
    buildApplianceGrid('s2-appliance-grid');
});

// ─── Server → client: appliance state ────────────────────────────────────────
socket.on('appliance_state', (state) => {
    applianceState = state || {};
    refreshApplianceCards();
    currentConsumption = calcConsumptionPct();
    updateUsageDisplay();
});

// ─── Server → client: consumption confirmed ───────────────────────────────────
socket.on('consumption_update', (val) => {
    currentConsumption = val;
    updateUsageDisplay();
});

// ─── Power status helpers ─────────────────────────────────────────────────────
function updatePowerUI(on) {
    isPowered = on;
    if (!powerStatus) return;

    if (on) {
        powerStatus.className = 'glow-green flex items-center justify-center gap-3 w-full py-4 bg-green-900 border border-green-700 rounded-xl mb-5 text-xl font-black shadow-lg';
        if (powerLabel) powerLabel.textContent = 'POWER ON';
        if (powerDot)   powerDot.className = 'w-3 h-3 rounded-full bg-green-400 shadow shadow-green-400';
    } else {
        powerStatus.className = 'blackout-anim flex items-center justify-center gap-3 w-full py-4 border border-red-700 rounded-xl mb-5 text-xl font-black shadow-lg';
        if (powerLabel) powerLabel.textContent = '⚠ BLACKOUT';
        if (powerDot)   powerDot.className = 'w-3 h-3 rounded-full bg-red-400 animate-ping';
    }
}

// ─── Outage ───────────────────────────────────────────────────────────────────
socket.on('outage_event', (data) => {
    if (myRole !== 'consumer') return;
    updatePowerUI(false);
    applianceState = {};
    refreshApplianceCards();
    updateUsageDisplay();

    const reason = data?.reason === 'load_shed'
        ? '🔌 Emergency load shedding — power will restore shortly.'
        : data?.reason === 'overload'
        ? '🔥 Substation overloaded! Your line was cut.'
        : '⚡ Personal fuse blown — too much erratic load!';

    showToast(reason, 'error');

    if (currentScenario === 1 && callHelpBtn) {
        callHelpBtn.classList.remove('hidden');
        callHelpBtn.textContent = '📞 CALL GRID MANAGER';
        callHelpBtn.disabled = false;
        callHelpBtn.className = callHelpBtn.className.replace('bg-yellow-600', 'bg-red-700');
    }
});

// ─── Power restored ───────────────────────────────────────────────────────────
socket.on('power_restored', () => {
    if (myRole !== 'consumer') return;
    updatePowerUI(true);
    if (callHelpBtn) callHelpBtn.classList.add('hidden');
    showToast('✅ Power restored!', 'success');
});

// ─── Call help ────────────────────────────────────────────────────────────────
if (callHelpBtn) {
    callHelpBtn.addEventListener('click', () => {
        socket.emit('call_for_help', { group: myGroup });
        callHelpBtn.textContent = '📞 Calling…';
        callHelpBtn.disabled = true;
        callHelpBtn.className = callHelpBtn.className.replace('bg-red-700', 'bg-yellow-600');
        showToast('Help call sent to grid manager.', 'info');
    });
}

// ─── Scores ───────────────────────────────────────────────────────────────────
socket.on('update_havoc', (score) => {
    if (havocSpan) {
        havocSpan.textContent = score;
        // Flash animation
        havocSpan.parentElement.classList.add('scale-110');
        setTimeout(() => havocSpan.parentElement.classList.remove('scale-110'), 300);
    }
});

socket.on('task_completed', (newScore) => {
    if (myRole !== 'consumer') return;
    if (complianceSpan) complianceSpan.textContent = newScore || 0;
    if (taskBox) taskBox.classList.add('hidden');
    showToast('🎉 Task complete! +10 compliance pts', 'success');
});

socket.on('dr_accepted_confirm', (newScore) => {
    if (complianceSpan) complianceSpan.textContent = newScore || 0;
    showToast('✅ Demand response accepted! +20 pts', 'success');
});

// ─── Task UI ──────────────────────────────────────────────────────────────────
socket.on('new_task', (task) => {
    if (myRole !== 'consumer') return;
    if (!taskBox) return;
    taskBox.classList.remove('hidden');
    if (taskNameEl)   taskNameEl.textContent   = task.name;
    if (taskTargetEl) taskTargetEl.textContent = `${task.min}% – ${task.max}%`;
    if (taskProgressBar) taskProgressBar.style.width = '0%';
    showToast(`🎯 New challenge: ${task.name}`, 'info');
});

socket.on('task_progress', (pct) => {
    if (myRole !== 'consumer' || !taskProgressBar) return;
    taskProgressBar.style.width = `${pct}%`;
    taskProgressBar.className = `h-2.5 rounded-full transition-all duration-300 ${pct > 60 ? 'bg-green-400' : 'bg-blue-400'}`;
});

// ─── Scenario 2: Solar slider ─────────────────────────────────────────────────
if (produceSlider) {
    produceSlider.addEventListener('input', (e) => {
        solarOutput = parseInt(e.target.value);
        const w = Math.round((solarOutput / 100) * 1200); // max ~1.2 kW panel
        if (solarPct)   solarPct.textContent   = solarOutput;
        if (solarWatts) solarWatts.textContent = w;
        socket.emit('update_slider', { type: 'produce', value: solarOutput });
        updateUsageDisplay();
    });
}

// ─── Scenario 2: Battery mode buttons ────────────────────────────────────────
document.querySelectorAll('.bat-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const mode = btn.dataset.mode;
        socket.emit('toggle_battery', { mode });
        document.querySelectorAll('.bat-btn').forEach(b => {
            b.className = b.className
                .replace('border-blue-700 bg-blue-950', 'border-gray-700 bg-gray-800')
                .replace('border-green-700 bg-green-950', 'border-gray-700 bg-gray-800')
                .replace('border-yellow-700 bg-yellow-950', 'border-gray-700 bg-gray-800');
        });
        const activeStyle = {
            idle:      'border-blue-700 bg-blue-950',
            charge:    'border-green-700 bg-green-950',
            discharge: 'border-yellow-700 bg-yellow-950',
        }[mode] || 'border-gray-700 bg-gray-800';
        btn.className = btn.className.replace('border-gray-700 bg-gray-800', activeStyle);
    });
});

socket.on('battery_mode_update', (mode) => {
    currentBatMode = mode;
    document.querySelectorAll('.bat-btn').forEach(b => {
        const isActive = b.dataset.mode === mode;
        const styles = {
            idle:      'border-blue-700 bg-blue-950',
            charge:    'border-green-700 bg-green-950',
            discharge: 'border-yellow-700 bg-yellow-950',
        };
        // strip all active styles first
        b.className = b.className
            .replace('border-blue-700 bg-blue-950',    'border-gray-700 bg-gray-800')
            .replace('border-green-700 bg-green-950',  'border-gray-700 bg-gray-800')
            .replace('border-yellow-700 bg-yellow-950','border-gray-700 bg-gray-800');
        if (isActive) {
            b.className = b.className.replace('border-gray-700 bg-gray-800', styles[mode] || 'border-gray-700 bg-gray-800');
        }
    });
    updateUsageDisplay();
});

socket.on('battery_update', (pct) => {
    if (batteryPct) batteryPct.textContent = `${pct}%`;
    if (batteryBar) {
        batteryBar.style.width = `${pct}%`;
        batteryBar.className = `load-bar h-3 rounded-full ${pct < 20 ? 'bg-red-500' : pct < 50 ? 'bg-yellow-500' : 'bg-blue-500'}`;
    }
});

// ─── Price changes ────────────────────────────────────────────────────────────
window.addEventListener('price_changed', (e) => {
    const p = e.detail;
    currentPrice = p.price;

    if (priceBadge) {
        const colors = {
            green:  'bg-green-500 text-black',
            yellow: 'bg-yellow-500 text-black',
            red:    'bg-red-600 text-white',
        };
        priceBadge.className = `price-badge px-3 py-1 rounded-full text-sm font-black ${colors[p.color] || colors.yellow}`;
        priceBadge.textContent = p.label;
    }
    if (priceValue) priceValue.textContent = `€${p.price.toFixed(2)}`;

    const type = p.tier === 'peak' ? 'error' : p.tier === 'off-peak' ? 'success' : 'info';
    showToast(`💰 Price changed: ${p.label} (€${p.price}/kWh)`, type);
    updateUsageDisplay();
});

// ─── Demand Response banner ───────────────────────────────────────────────────
socket.on('demand_response_event', (data) => {
    if (myRole !== 'consumer') return;
    drActive = true;
    if (drBanner) {
        drBanner.classList.remove('hidden');
    }
    showToast('📡 Demand response request received!', 'warning');
});

if (drAcceptBtn) {
    drAcceptBtn.addEventListener('click', () => {
        socket.emit('accept_demand_response');
        // Proactively switch off heavy appliances as a suggestion
        ['ev', 'oven', 'ac'].forEach(key => {
            if (applianceState[key]) socket.emit('toggle_appliance', { appliance: key });
        });
        if (drBanner) drBanner.classList.add('hidden');
        drActive = false;
    });
}

if (drIgnoreBtn) {
    drIgnoreBtn.addEventListener('click', () => {
        if (drBanner) drBanner.classList.add('hidden');
        drActive = false;
        showToast('⚠️ Demand response ignored — grid may become unstable.', 'warning');
    });
}

// ─── Diagnostic chat (consumer side) ─────────────────────────────────────────
socket.on('incoming_question', (data) => {
    if (myRole !== 'consumer') return;
    currentManagerId = data.managerId;
    if (consumerQuestion)  consumerQuestion.textContent = `"${data.question}"`;
    if (consumerReplyText) consumerReplyText.textContent = data.answerExpected;
    if (consumerChatModal) consumerChatModal.classList.remove('hidden');
});

if (consumerReplyBtn) {
    consumerReplyBtn.addEventListener('click', () => {
        socket.emit('consumer_send_reply', {
            managerId: currentManagerId,
            answer: consumerReplyText?.textContent || '',
        });
        if (consumerChatModal) consumerChatModal.classList.add('hidden');
    });
}
