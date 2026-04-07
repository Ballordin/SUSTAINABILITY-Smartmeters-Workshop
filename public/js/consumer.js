// ─── Referências DOM ──────────────────────────────────────────────────────────
const powerStatus    = document.getElementById('power-status');
const powerLabel     = document.getElementById('power-label');
const powerDot       = document.getElementById('power-dot');
const callHelpBtn    = document.getElementById('call-help-btn');
const havocSpan      = document.getElementById('havoc-score');
const complianceSpan = document.getElementById('compliance-score');

// Desafio
const taskBox         = document.getElementById('consumer-task-box');
const taskNameEl      = document.getElementById('task-name');
const taskTargetEl    = document.getElementById('task-target');
const taskProgressBar = document.getElementById('task-progress');

// Consumo S1
const usageBar    = document.getElementById('usage-bar');
const totalWatts  = document.getElementById('total-watts');
const s1CostSpan  = document.getElementById('s1-cost');

// Consumo S2
const s2UsageBar  = document.getElementById('s2-usage-bar');
const s2TotalWatts= document.getElementById('s2-total-watts');
const s2CostSpan  = document.getElementById('s2-cost');
const priceBadge  = document.getElementById('price-tier-badge');
const priceValue  = document.getElementById('price-value');

// Solar
const produceSlider      = document.getElementById('produce-slider');
const solarPctEl         = document.getElementById('solar-pct');
const solarWattsEl       = document.getElementById('solar-watts');
const solarModifierBadge = document.getElementById('solar-modifier-indicator');

// Bateria
const batteryPctEl = document.getElementById('battery-pct');
const batteryBarEl = document.getElementById('battery-bar');

// Fluxo líquido
const netLabelEl  = document.getElementById('net-label');
const importBarEl = document.getElementById('import-bar');
const exportBarEl = document.getElementById('export-bar');

// Carbono
const carbonIntBadge = document.getElementById('carbon-intensity-badge');
const carbonRateEl   = document.getElementById('carbon-rate');
const carbonFootEl   = document.getElementById('carbon-footprint');
const carbonBarEl    = document.getElementById('carbon-bar');

// Votação da Resposta à Procura
const drBanner    = document.getElementById('dr-banner');
const drVoteCount = document.getElementById('dr-vote-count');
const drVoteBar   = document.getElementById('dr-vote-bar');
const drVotedMsg  = document.getElementById('dr-voted-msg');
const drVoteBtns  = document.getElementById('dr-vote-btns');
const drAcceptBtn = document.getElementById('dr-accept-btn');
const drIgnoreBtn = document.getElementById('dr-ignore-btn');

// P2P
const p2pOffersList  = document.getElementById('p2p-offers-list');
const openP2pBtn     = document.getElementById('open-p2p-offer-btn');
const p2pModal       = document.getElementById('p2p-offer-modal');
const closeP2pModal  = document.getElementById('close-p2p-modal');
const p2pAmountInput = document.getElementById('p2p-amount-input');
const p2pPriceInput  = document.getElementById('p2p-price-input');
const p2pCreateBtn   = document.getElementById('p2p-create-btn');
const p2pCancelBtn   = document.getElementById('p2p-cancel-my-btn');

// Programação automática
const openScheduleBtn    = document.getElementById('open-schedule-btn');
const scheduleModal      = document.getElementById('schedule-modal');
const closeScheduleModal = document.getElementById('close-schedule-modal');
const schedAppliance     = document.getElementById('sched-appliance');
const schedCondition     = document.getElementById('sched-condition');
const schedThreshold     = document.getElementById('sched-threshold');
const schedAction        = document.getElementById('sched-action');
const schedSaveBtn       = document.getElementById('sched-save-btn');
const schedClearBtn      = document.getElementById('sched-clear-btn');
const activeSchedulesEl  = document.getElementById('active-schedules');

// Chamada recebida do gestor
const consumerChatModal = document.getElementById('consumer-chat-modal');
const consumerQuestion  = document.getElementById('consumer-incoming-question');
const consumerReplyBtn  = document.getElementById('consumer-reply-btn');
const consumerReplyText = document.getElementById('consumer-reply-text');

// ─── Definição dos eletrodomésticos (espelho do servidor) ─────────────────────
const APPLIANCES = {
    lights: { name: 'Luzes',           icon: '💡', watts: 100,  loadValue: 5  },
    tv:     { name: 'Televisão',        icon: '📺', watts: 150,  loadValue: 8  },
    ac:     { name: 'Ar Condicionado',  icon: '❄️',  watts: 800,  loadValue: 22 },
    oven:   { name: 'Forno',            icon: '🍳', watts: 700,  loadValue: 19 },
    washer: { name: 'Máq. de Lavar',    icon: '🫧', watts: 500,  loadValue: 14 },
    ev:     { name: 'Carregador VE',    icon: '🚗', watts: 1200, loadValue: 32 },
};

// ─── Estado local do consumidor ───────────────────────────────────────────────
let applianceState     = {};
let currentPrice       = 0.15;
let currentBatMode     = 'idle';
let solarOutput        = 0;
let solarModifier      = 1.0;
let currentConsumption = 0;
let currentManagerId   = null;
let mySchedules        = [];
let drVoted            = false;

// ─── Construtor dos cartões de eletrodomésticos ───────────────────────────────
function buildApplianceGrid(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';
    Object.entries(APPLIANCES).forEach(([key, app]) => {
        const isOn = !!applianceState[key];
        const btn  = document.createElement('button');
        btn.id     = `app-btn-${containerId}-${key}`;
        btn.dataset.key = key;
        btn.className = applianceClass(isOn);
        btn.innerHTML = `
            <span class="text-2xl">${app.icon}</span>
            <span class="text-xs font-bold leading-tight text-center">${app.name}</span>
            <span class="mono text-xs ${isOn ? 'text-yellow-400' : 'text-gray-600'}">${app.watts}W</span>
            <div class="w-2 h-2 rounded-full ${isOn ? 'bg-yellow-400 shadow shadow-yellow-400' : 'bg-gray-700'}"></div>
        `;
        btn.addEventListener('click', () => {
            if (!isPowered) {
                showToast('⚡ Sem energia — aguarda o restabelecimento.', 'error');
                return;
            }
            socket.emit('toggle_appliance', { appliance: key });
        });
        container.appendChild(btn);
    });
}

function applianceClass(isOn) {
    return `appliance-btn flex flex-col items-center justify-center gap-1.5 p-3 rounded-xl border-2 transition-all
        ${isOn
            ? 'bg-yellow-900 border-yellow-500 text-yellow-200 shadow-lg shadow-yellow-900/40 on'
            : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500'}`;
}

function refreshApplianceCards() {
    ['appliance-grid', 's2-appliance-grid'].forEach(cid => {
        Object.keys(APPLIANCES).forEach(key => {
            const btn = document.getElementById(`app-btn-${cid}-${key}`);
            if (!btn) return;
            const isOn = !!applianceState[key];
            btn.className = applianceClass(isOn);
            const dot  = btn.querySelector('.rounded-full');
            const watt = btn.querySelector('.mono');
            if (dot)  dot.className  = `w-2 h-2 rounded-full ${isOn ? 'bg-yellow-400 shadow shadow-yellow-400' : 'bg-gray-700'}`;
            if (watt) watt.className = `mono text-xs ${isOn ? 'text-yellow-400' : 'text-gray-600'}`;
        });
    });
}

// ─── Cálculo total de watts ───────────────────────────────────────────────────
function calcTotalWatts() {
    return Object.entries(applianceState)
        .filter(([, on]) => on)
        .reduce((sum, [key]) => sum + (APPLIANCES[key]?.watts || 0), 0);
}

// ─── Barra de consumo e custo ─────────────────────────────────────────────────
function updateUsageDisplay() {
    const w   = calcTotalWatts();
    const pct = Math.min(100, (w / 3450) * 100);
    const corBarra = pct > 80 ? 'bg-red-500' : pct > 55 ? 'bg-yellow-500' : 'bg-green-500';

    // Cenário 1
    if (usageBar)   { usageBar.style.width = `${pct}%`; usageBar.className = `load-bar h-4 rounded-full ${corBarra}`; }
    if (totalWatts) totalWatts.textContent = `${w} W`;
    if (s1CostSpan) s1CostSpan.textContent = `€${((w / 1000) * currentPrice).toFixed(3)}/h`;

    // Cenário 2
    if (s2UsageBar)    { s2UsageBar.style.width = `${pct}%`; s2UsageBar.className = `load-bar h-4 rounded-full ${corBarra}`; }
    if (s2TotalWatts)  s2TotalWatts.textContent = `${w} W`;

    if (currentScenario === 2) {
        const efectivoSolar = solarOutput * solarModifier;
        const batOffset = currentBatMode === 'discharge' ? -15 : currentBatMode === 'charge' ? 10 : 0;
        const net = currentConsumption - efectivoSolar + batOffset;
        const netW = Math.round((Math.abs(net) / 100) * 3450);
        const estaAExportar = net < 0;
        const netPct = Math.min(100, (netW / 3450) * 100);

        if (importBarEl) importBarEl.style.width = estaAExportar ? '0%' : `${netPct}%`;
        if (exportBarEl) exportBarEl.style.width = estaAExportar ? `${netPct}%` : '0%';
        if (netLabelEl)  netLabelEl.textContent  = `Líquido: ${estaAExportar ? '−' : '+'}${netW} W`;

        const netKw = Math.max(0, net / 100 * 3.45);
        if (s2CostSpan) s2CostSpan.textContent = `€${(netKw * currentPrice).toFixed(3)}/h`;
    }
}

// ─── Estado visual da energia ─────────────────────────────────────────────────
function updatePowerUI(on) {
    isPowered = on;
    if (!powerStatus) return;
    if (on) {
        powerStatus.className = 'glow-green flex items-center justify-center gap-3 w-full py-4 bg-green-900 border border-green-700 rounded-xl mb-5 text-xl font-black shadow-lg';
        if (powerLabel) powerLabel.textContent = 'COM ENERGIA';
        if (powerDot)   powerDot.className = 'w-3 h-3 rounded-full bg-green-400 shadow shadow-green-400';
    } else {
        powerStatus.className = 'blackout-anim flex items-center justify-center gap-3 w-full py-4 border border-red-700 rounded-xl mb-5 text-xl font-black shadow-lg';
        if (powerLabel) powerLabel.textContent = '⚠ APAGÃO';
        if (powerDot)   powerDot.className = 'w-3 h-3 rounded-full bg-red-400 animate-ping';
    }
}

// ─── Inicialização ao atribuir papel ─────────────────────────────────────────
socket.on('role_assigned', (data) => {
    if (data.role !== 'consumer') return;
    applianceState = {};
    drVoted = false;
    buildApplianceGrid('appliance-grid');
    buildApplianceGrid('s2-appliance-grid');
    updateUsageDisplay();
    updatePowerUI(true);
});

window.addEventListener('scenario_switched', () => {
    if (myRole !== 'consumer') return;
    buildApplianceGrid('appliance-grid');
    buildApplianceGrid('s2-appliance-grid');
    drVoted = false;
    if (drBanner) drBanner.classList.add('hidden');
});

// ─── Estado dos eletrodomésticos vindo do servidor ────────────────────────────
socket.on('appliance_state', (state) => {
    applianceState = state || {};
    refreshApplianceCards();
    currentConsumption = Object.entries(applianceState)
        .filter(([, on]) => on)
        .reduce((s, [k]) => s + (APPLIANCES[k]?.loadValue || 0), 0);
    updateUsageDisplay();
});

socket.on('consumption_update', (val) => {
    currentConsumption = val;
    updateUsageDisplay();
});

// ─── Apagão ───────────────────────────────────────────────────────────────────
socket.on('outage_event', (data) => {
    if (myRole !== 'consumer') return;
    updatePowerUI(false);
    applianceState = {};
    refreshApplianceCards();
    updateUsageDisplay();

    const mensagens = {
        load_shed: '🔌 Corte de emergência — a energia volta em 15 s.',
        overload:  '🔥 Subestação sobrecarregada! A tua linha foi cortada.',
        fuse:      '⚡ Fusível fundido — consumo demasiado instável!',
    };
    showToast(mensagens[data?.reason] || '⚡ Energia perdida!', 'error');

    if (currentScenario === 1 && callHelpBtn) {
        callHelpBtn.classList.remove('hidden');
        callHelpBtn.textContent = '📞 LIGAR AO GESTOR DA REDE';
        callHelpBtn.disabled = false;
        callHelpBtn.className = callHelpBtn.className.replace('bg-yellow-600', 'bg-red-700');
    }
});

// ─── Energia reposta ──────────────────────────────────────────────────────────
socket.on('power_restored', () => {
    if (myRole !== 'consumer') return;
    updatePowerUI(true);
    if (callHelpBtn) callHelpBtn.classList.add('hidden');
    showToast('✅ Energia reposta!', 'success');
});

// ─── Ligar para pedir ajuda (Cenário 1) ──────────────────────────────────────
if (callHelpBtn) {
    callHelpBtn.addEventListener('click', () => {
        socket.emit('call_for_help', { group: myGroup });
        callHelpBtn.textContent = '📞 A ligar…';
        callHelpBtn.disabled = true;
        callHelpBtn.className = callHelpBtn.className.replace('bg-red-700', 'bg-yellow-600');
        showToast('Pedido de ajuda enviado ao gestor.', 'info');
    });
}

// ─── Pontuações ───────────────────────────────────────────────────────────────
socket.on('update_havoc', (score) => {
    if (havocSpan) havocSpan.textContent = score;
});

socket.on('task_completed', (newScore) => {
    if (myRole !== 'consumer') return;
    if (complianceSpan) complianceSpan.textContent = newScore || 0;
    if (taskBox) taskBox.classList.add('hidden');
    showToast('🎉 Desafio completo! +10 pontos de cumprimento', 'success');
});

socket.on('dr_accepted_confirm', (newScore) => {
    if (complianceSpan) complianceSpan.textContent = newScore || 0;
});

// ─── Interface do desafio ─────────────────────────────────────────────────────
socket.on('new_task', (task) => {
    if (myRole !== 'consumer' || !taskBox) return;
    taskBox.classList.remove('hidden');
    if (taskNameEl)    taskNameEl.textContent   = task.name;
    if (taskTargetEl)  taskTargetEl.textContent = `${task.min}% – ${task.max}%`;
    if (taskProgressBar) taskProgressBar.style.width = '0%';
    showToast(`🎯 Novo desafio: ${task.name}`, 'info');
});

socket.on('task_progress', (pct) => {
    if (myRole !== 'consumer' || !taskProgressBar) return;
    taskProgressBar.style.width = `${pct}%`;
    taskProgressBar.className = `h-2.5 rounded-full transition-all duration-300 ${pct > 60 ? 'bg-green-400' : 'bg-blue-400'}`;
});

// ─── Slider solar ─────────────────────────────────────────────────────────────
if (produceSlider) {
    produceSlider.addEventListener('input', (e) => {
        solarOutput = parseInt(e.target.value);
        const eficazW = Math.round((solarOutput * solarModifier / 100) * 1200);
        if (solarPctEl)   solarPctEl.textContent   = solarOutput;
        if (solarWattsEl) solarWattsEl.textContent = eficazW;
        socket.emit('update_slider', { type: 'produce', value: solarOutput });
        updateUsageDisplay();
    });
}

// ─── Eventos de renováveis (nuvens / vento) ───────────────────────────────────
window.addEventListener('renewable_changed', (e) => {
    const { type } = e.detail;
    if (type === 'cloud') {
        solarModifier = 0.35;
        if (solarModifierBadge) solarModifierBadge.classList.remove('hidden');
    } else if (type === 'clear') {
        solarModifier = 1.0;
        if (solarModifierBadge) solarModifierBadge.classList.add('hidden');
    }
    if (solarWattsEl) solarWattsEl.textContent = Math.round((solarOutput * solarModifier / 100) * 1200);
    updateUsageDisplay();
});

// ─── Botões da bateria ────────────────────────────────────────────────────────
const estilosBateria = {
    charge:    'border-green-700 bg-green-950',
    idle:      'border-blue-700 bg-blue-950',
    discharge: 'border-yellow-700 bg-yellow-950',
};

function refreshBatButtons(mode) {
    document.querySelectorAll('.bat-btn').forEach(b => {
        const ativo = b.dataset.mode === mode;
        b.className = b.className
            .replace('border-green-700 bg-green-950',   'border-gray-700 bg-gray-800')
            .replace('border-blue-700 bg-blue-950',     'border-gray-700 bg-gray-800')
            .replace('border-yellow-700 bg-yellow-950', 'border-gray-700 bg-gray-800');
        if (ativo) b.className = b.className.replace('border-gray-700 bg-gray-800', estilosBateria[mode] || estilosBateria.idle);
    });
}

document.querySelectorAll('.bat-btn').forEach(btn => {
    btn.addEventListener('click', () => socket.emit('toggle_battery', { mode: btn.dataset.mode }));
});

socket.on('battery_mode_update', (mode) => {
    currentBatMode = mode;
    refreshBatButtons(mode);
    updateUsageDisplay();
});

socket.on('battery_update', (pct) => {
    if (batteryPctEl) batteryPctEl.textContent = `${pct}%`;
    if (batteryBarEl) {
        batteryBarEl.style.width = `${pct}%`;
        batteryBarEl.className = `load-bar h-3 rounded-full ${pct < 20 ? 'bg-red-500' : pct < 50 ? 'bg-yellow-500' : 'bg-blue-500'}`;
    }
});

// ─── Atualização de preço ─────────────────────────────────────────────────────
window.addEventListener('price_changed', (e) => {
    const p = e.detail;
    currentPrice = p.price;

    const coresBadge = { green: 'bg-green-500 text-black', yellow: 'bg-yellow-500 text-black', red: 'bg-red-600 text-white' };
    if (priceBadge) {
        priceBadge.className = `px-3 py-1 rounded-full text-sm font-black ${coresBadge[p.color] || coresBadge.yellow}`;
        priceBadge.textContent = p.label;
    }
    if (priceValue) priceValue.textContent = `€${p.price.toFixed(2)}`;

    const tipo = p.tier === 'peak' ? 'error' : p.tier === 'off-peak' ? 'success' : 'info';
    showToast(`💰 Preço: ${p.label} — €${p.price}/kWh`, tipo);
    updateUsageDisplay();
});

// ─── Rastreador de carbono ────────────────────────────────────────────────────
window.addEventListener('carbon_received', (e) => {
    if (myRole !== 'consumer') return;
    const { intensity, footprint, hourlyRate } = e.detail;

    const corIntensidade = intensity > 300 ? 'bg-red-900 text-red-300' : intensity > 150 ? 'bg-yellow-900 text-yellow-300' : 'bg-green-800 text-green-300';
    if (carbonIntBadge) {
        carbonIntBadge.className = `px-2 py-0.5 rounded-full text-xs font-black ${corIntensidade}`;
        carbonIntBadge.textContent = `${intensity} g/kWh`;
    }
    if (carbonRateEl)  carbonRateEl.textContent  = `${hourlyRate.toLocaleString()} g/h`;
    if (carbonFootEl) {
        carbonFootEl.textContent = `${footprint} g CO₂`;
        carbonFootEl.className = `mono text-lg font-bold ${intensity > 300 ? 'text-red-400' : intensity > 150 ? 'text-yellow-400' : 'text-green-400'}`;
    }
    if (carbonBarEl) {
        const pct = Math.min(100, (footprint / 500) * 100);
        carbonBarEl.style.width = `${pct}%`;
        carbonBarEl.className = `load-bar h-1.5 rounded-full ${intensity > 300 ? 'bg-red-500' : intensity > 150 ? 'bg-yellow-500' : 'bg-green-500'}`;
    }
});

// ─── Votação da Resposta à Procura ────────────────────────────────────────────
socket.on('demand_response_event', () => {
    if (myRole !== 'consumer') return;
    drVoted = false;
    if (drBanner)    drBanner.classList.remove('hidden');
    if (drVotedMsg)  drVotedMsg.classList.add('hidden');
    if (drVoteBtns)  drVoteBtns.classList.remove('hidden');
    if (drVoteCount) drVoteCount.textContent = '0/0';
    if (drVoteBar)   drVoteBar.style.width = '0%';
    showToast('📡 Votação de Resposta à Procura iniciada!', 'warning');
});

window.addEventListener('dr_vote_received', (e) => {
    const { node, yes, total, thresholdMet } = e.detail;
    if (node !== myGroup) return;
    if (drVoteCount) drVoteCount.textContent = `${yes}/${total}`;
    if (drVoteBar) {
        const pct = total > 0 ? Math.round((yes / total) * 100) : 0;
        drVoteBar.style.width = `${pct}%`;
        drVoteBar.className = `load-bar h-2 rounded-full ${thresholdMet ? 'bg-green-500' : 'bg-orange-500'}`;
    }
});

window.addEventListener('dr_resolved', (e) => {
    const { node, success } = e.detail;
    if (node !== myGroup) return;
    setTimeout(() => { if (drBanner) drBanner.classList.add('hidden'); drVoted = false; }, 3000);
    if (drVoteBar) drVoteBar.className = `load-bar h-2 rounded-full ${success ? 'bg-green-500' : 'bg-red-500'}`;
});

if (drAcceptBtn) {
    drAcceptBtn.addEventListener('click', () => {
        if (drVoted) return;
        drVoted = true;
        socket.emit('vote_dr', { vote: 'yes' });
        // Sugere desligar os eletrodomésticos mais pesados
        ['ev', 'oven', 'ac'].forEach(key => {
            if (applianceState[key]) socket.emit('toggle_appliance', { appliance: key });
        });
        if (drVoteBtns) drVoteBtns.classList.add('hidden');
        if (drVotedMsg) drVotedMsg.classList.remove('hidden');
    });
}

if (drIgnoreBtn) {
    drIgnoreBtn.addEventListener('click', () => {
        if (drVoted) return;
        drVoted = true;
        socket.emit('vote_dr', { vote: 'no' });
        if (drVoteBtns) drVoteBtns.classList.add('hidden');
        if (drVotedMsg) {
            drVotedMsg.textContent = '👎 Ignoraste — a aguardar os vizinhos…';
            drVotedMsg.classList.remove('hidden', 'text-green-400');
            drVotedMsg.classList.add('text-gray-400');
        }
        showToast('⚠️ Resposta à Procura ignorada.', 'warning');
    });
}

// ─── Mercado P2P ──────────────────────────────────────────────────────────────
window.addEventListener('p2p_market_received', (e) => {
    if (myRole !== 'consumer') return;
    renderP2pOffers(e.detail);
});

function renderP2pOffers(offers) {
    if (!p2pOffersList) return;
    const ofertasDoMeuNo = offers.filter(o => o.sellerGroup === myGroup);
    if (ofertasDoMeuNo.length === 0) {
        p2pOffersList.innerHTML = '<p class="text-gray-700 text-xs text-center py-3">Sem ofertas ativas no teu nó</p>';
        return;
    }
    p2pOffersList.innerHTML = ofertasDoMeuNo.map(offer => {
        const eMinha = offer.sellerId === socket.id;
        return `
            <div class="flex items-center justify-between bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs gap-2">
                <div>
                    <span class="font-bold text-purple-300">${offer.amount} unid.</span>
                    <span class="text-gray-500 ml-1">@ €${offer.pricePerUnit.toFixed(2)}/unid.</span>
                    ${eMinha ? '<span class="ml-1 text-xs text-gray-600 italic">(tua)</span>' : ''}
                </div>
                <div class="text-right">
                    <span class="text-gray-500">Total: €${(offer.amount * offer.pricePerUnit).toFixed(2)}</span>
                </div>
                ${!eMinha ? `<button class="p2p-buy-btn bg-purple-800 hover:bg-purple-700 border border-purple-600 text-purple-200 px-2.5 py-1 rounded-lg font-bold transition-colors" data-id="${offer.id}">Comprar</button>` : ''}
            </div>
        `;
    }).join('');

    p2pOffersList.querySelectorAll('.p2p-buy-btn').forEach(btn => {
        btn.addEventListener('click', () => socket.emit('p2p_buy', { offerId: btn.dataset.id }));
    });
}

if (openP2pBtn)    openP2pBtn.addEventListener('click',   () => p2pModal?.classList.remove('hidden'));
if (closeP2pModal) closeP2pModal.addEventListener('click', () => p2pModal?.classList.add('hidden'));

if (p2pCreateBtn) {
    p2pCreateBtn.addEventListener('click', () => {
        const amount = parseFloat(p2pAmountInput?.value) || 10;
        const price  = parseFloat(p2pPriceInput?.value)  || 0.10;
        socket.emit('p2p_offer', { amount, price });
        p2pModal?.classList.add('hidden');
        showToast(`⚡ Oferta criada: ${amount} unid. @ €${price}/unid.`, 'success');
    });
}

if (p2pCancelBtn) {
    p2pCancelBtn.addEventListener('click', () => {
        socket.emit('p2p_cancel');
        p2pModal?.classList.add('hidden');
        showToast('Oferta cancelada.', 'info');
    });
}

socket.on('p2p_trade_confirmed', (data) => {
    if (data.type === 'bought') showToast(`⚡ Compraste ${data.amount} unid. por €${data.cost.toFixed(2)}! +5 pts`, 'success');
    if (data.type === 'sold')   showToast(`💰 Vendeste ${data.amount} unid., ganhaste €${data.earned.toFixed(2)}! +5 pts`, 'success');
});

// ─── Programação automática ───────────────────────────────────────────────────
if (openScheduleBtn)    openScheduleBtn.addEventListener('click',   () => scheduleModal?.classList.remove('hidden'));
if (closeScheduleModal) closeScheduleModal.addEventListener('click', () => scheduleModal?.classList.add('hidden'));

function renderSchedules() {
    if (!activeSchedulesEl) return;
    if (mySchedules.length === 0) {
        activeSchedulesEl.innerHTML = '<p class="text-gray-600 text-xs text-center py-1">Sem regras ativas</p>';
        return;
    }

    const condicaoTraduzida = { price_above: 'preço acima de', price_below: 'preço abaixo de', solar_above: 'solar acima de' };
    const acaoTraduzida     = { on: 'ligar', off: 'desligar' };

    activeSchedulesEl.innerHTML = mySchedules.map((s, i) => `
        <div class="flex items-center justify-between bg-indigo-950 border border-indigo-800 rounded-lg px-3 py-1.5 text-xs">
            <span class="text-indigo-300 font-semibold">
                ${APPLIANCES[s.appliance]?.icon} ${APPLIANCES[s.appliance]?.name} →
                <span class="font-black">${acaoTraduzida[s.action] || s.action}</span>
                quando ${condicaoTraduzida[s.condition] || s.condition} ${s.threshold}
            </span>
            <button class="del-sched text-gray-600 hover:text-red-400 font-black transition-colors" data-index="${i}">×</button>
        </div>
    `).join('');

    activeSchedulesEl.querySelectorAll('.del-sched').forEach(btn => {
        btn.addEventListener('click', () => {
            const s = mySchedules[parseInt(btn.dataset.index)];
            if (s) socket.emit('schedule_appliance', { appliance: s.appliance, action: 'none', condition: s.condition, threshold: s.threshold });
        });
    });
}

if (schedSaveBtn) {
    schedSaveBtn.addEventListener('click', () => {
        const rule = {
            appliance:  schedAppliance?.value  || 'lights',
            condition:  schedCondition?.value  || 'price_above',
            threshold:  parseFloat(schedThreshold?.value) || 0.20,
            action:     schedAction?.value     || 'off',
        };
        socket.emit('schedule_appliance', rule);
        const acaoTrad = rule.action === 'on' ? 'ligar' : 'desligar';
        showToast(`🗓 Regra guardada: ${rule.appliance} → ${acaoTrad}`, 'success');
    });
}

if (schedClearBtn) {
    schedClearBtn.addEventListener('click', () => {
        mySchedules.forEach(s => socket.emit('schedule_appliance', { appliance: s.appliance, action: 'none', condition: s.condition, threshold: s.threshold }));
        showToast('Todas as regras apagadas.', 'info');
    });
}

socket.on('schedules_update', (schedules) => {
    mySchedules = schedules || [];
    renderSchedules();
    if (openScheduleBtn) {
        openScheduleBtn.textContent = mySchedules.length > 0
            ? `🗓 Regras Automáticas (${mySchedules.length} ativa${mySchedules.length !== 1 ? 's' : ''})`
            : '🗓 Regras Automáticas (definir condições)';
    }
});

// ─── Chamada de diagnóstico recebida ──────────────────────────────────────────
socket.on('incoming_question', (data) => {
    if (myRole !== 'consumer') return;
    currentManagerId = data.managerId;
    if (consumerQuestion)  consumerQuestion.textContent  = `"${data.question}"`;
    if (consumerReplyText) consumerReplyText.textContent = data.answerExpected;
    if (consumerChatModal) consumerChatModal.classList.remove('hidden');
});

if (consumerReplyBtn) {
    consumerReplyBtn.addEventListener('click', () => {
        socket.emit('consumer_send_reply', { managerId: currentManagerId, answer: consumerReplyText?.textContent || '' });
        if (consumerChatModal) consumerChatModal.classList.add('hidden');
    });
}
