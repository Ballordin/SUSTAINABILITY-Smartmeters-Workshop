const express = require('express');
const app = express();
const http = require('http').createServer(app);
const path = require('path');
const io = require('socket.io')(http, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ─── Definição dos eletrodomésticos ───────────────────────────────────────────
const APPLIANCES = {
    lights: { name: 'Luzes',            icon: '💡', watts: 100,  loadValue: 5  },
    tv:     { name: 'Televisão',         icon: '📺', watts: 150,  loadValue: 8  },
    ac:     { name: 'Ar Condicionado',   icon: '❄️',  watts: 800,  loadValue: 22 },
    oven:   { name: 'Forno',             icon: '🍳', watts: 700,  loadValue: 19 },
    washer: { name: 'Máquina de Lavar',  icon: '🫧', watts: 500,  loadValue: 14 },
    ev:     { name: 'Carregador VE',     icon: '🚗', watts: 1200, loadValue: 32 },
};

const PRICE_TIERS = [
    { tier: 'off-peak', price: 0.08, label: '🌙 Vazio',   color: 'green'  },
    { tier: 'normal',   price: 0.15, label: '🌤 Normal',   color: 'yellow' },
    { tier: 'peak',     price: 0.30, label: '🔥 PONTA',    color: 'red'    },
];

const CARBON_INTENSITY = { 'off-peak': 80, 'normal': 220, 'peak': 420 };

// ─── Perguntas do Quiz ────────────────────────────────────────────────────────
const QUIZ_QUESTIONS = [
    {
        question: 'Por que razão disparou a subestação no Cenário 1?',
        options: [
            'Demasiados utilizadores ligados',
            'A carga total ultrapassou a capacidade da subestação',
            'O temporizador chegou ao fim',
            'Os painéis solares falharam',
        ],
        correct: 1,
        explanation: 'Quando a carga total ultrapassa a capacidade da subestação (>100%), o disjuntor dispara automaticamente — a rede clássica não tem forma de o evitar com antecedência.',
    },
    {
        question: 'O que consegue a Resposta à Procura?',
        options: [
            'Aumenta a capacidade da rede de forma permanente',
            'Reduz a carga nos picos ao deslocar o consumo',
            'Substitui as centrais elétricas',
            'Aumenta os preços da eletricidade',
        ],
        correct: 1,
        explanation: 'A Resposta à Procura pede aos consumidores que reduzam voluntariamente a carga nas horas de ponta, evitando sobrecargas sem construir novas infraestruturas.',
    },
    {
        question: 'Que tecnologia permite enviar sinais de preço em tempo real para as casas?',
        options: [
            'Contadores de eletricidade analógicos',
            'Contadores inteligentes com comunicação bidirecional',
            'Centrais elétricas maiores',
            'Cabos subterrâneos',
        ],
        correct: 1,
        explanation: 'Os contadores inteligentes comunicam nos dois sentidos — a rede pode enviar sinais de preço e o contador reporta o consumo em tempo real.',
    },
    {
        question: 'Por que razão a intensidade de carbono é mais baixa nas horas de vazio?',
        options: [
            'Há menos pessoas acordadas',
            'As energias renováveis dominam quando a procura é baixa',
            'As centrais a carvão desligam automaticamente',
            'Os painéis solares funcionam melhor de noite',
        ],
        correct: 1,
        explanation: 'Nas horas de vazio, as renováveis estáveis (eólica, hídrica) conseguem cobrir a maior parte da procura sem precisar de apoio de combustíveis fósseis.',
    },
    {
        question: 'Qual é a principal vantagem do comércio de energia entre vizinhos?',
        options: [
            'Elimina a necessidade de uma rede elétrica',
            'Permite aos vizinhos vender o excedente solar localmente',
            'Torna toda a eletricidade gratuita',
            'Aumenta as emissões de carbono da rede',
        ],
        correct: 1,
        explanation: 'O comércio P2P permite aos prosumidores vender o excedente solar diretamente aos vizinhos, reduzindo as perdas de transmissão e baixando a fatura de todos.',
    },
];

// ─── Estado do jogo ───────────────────────────────────────────────────────────
let gameState = {
    scenario: 1,
    users: {},
    managers: [],
    groups: {
        1: { capacity: 1000, currentLoad: 0, shed: false },
        2: { capacity: 1000, currentLoad: 0, shed: false },
        3: { capacity: 1000, currentLoad: 0, shed: false },
        4: { capacity: 1000, currentLoad: 0, shed: false },
    },
    metrics: { outages: 0, callsMade: 0, issuesResolved: 0, totalPower: 0, drAccepted: 0 },
    pricing: { ...PRICE_TIERS[1] },
    solarModifier: 1.0,
    renewableEvent: null,
    p2pMarket: [],
    carbonIntensity: 220,
};

let timerSeconds      = 600;
let isGameRunning     = false;
let pricingTick       = 0;
let eventTimeline     = [];
let scenarioSnapshots = {};
let activeDrRequests  = {};
let activeQuiz        = null;
let quizAnswers       = {};

// ─── Funções auxiliares ───────────────────────────────────────────────────────
function syncClock(socket) {
    const m = Math.floor(timerSeconds / 60), s = timerSeconds % 60;
    socket.emit('time_update', `${m}:${s < 10 ? '0' : ''}${s}`);
}

function logEvent(type, message, group = null) {
    const elapsed = 600 - timerSeconds;
    eventTimeline.push({ time: elapsed, type, message, group });
}

function getCurrentCarbonIntensity() {
    return CARBON_INTENSITY[gameState.pricing.tier] || 220;
}

function assignRoleAndGroup(socket) {
    const group = Math.floor(Math.random() * 4) + 1;
    const role  = gameState.managers.length === 0 ? 'manager' : 'consumer';
    if (role === 'manager') gameState.managers.push(socket.id);

    gameState.users[socket.id] = {
        role, group,
        consumption: 0, production: 0, volatility: 0,
        havoc: 0, compliance: 0, powered: true,
        appliances: {}, batteryCharge: 50, batteryMode: 'idle',
        currentTask: null, taskProgress: 0,
        carbonFootprint: 0, schedules: [],
    };

    socket.emit('role_assigned', { role, group, scenario: gameState.scenario });
    socket.emit('price_update', gameState.pricing);
    socket.emit('battery_mode_update', 'idle');
    socket.emit('carbon_update', { intensity: getCurrentCarbonIntensity(), footprint: 0, hourlyRate: 0 });
    socket.emit('p2p_market_update', gameState.p2pMarket);
    syncClock(socket);
}

function resetGameMetrics() {
    gameState.metrics = { outages: 0, callsMade: 0, issuesResolved: 0, totalPower: 0, drAccepted: 0 };
    for (let i = 1; i <= 4; i++) gameState.groups[i] = { capacity: 1000, currentLoad: 0, shed: false };
    gameState.solarModifier = 1.0;
    gameState.renewableEvent = null;
    gameState.p2pMarket = [];
    activeDrRequests = {};
    eventTimeline = [];

    for (const id in gameState.users) {
        const u = gameState.users[id];
        Object.assign(u, {
            consumption: 0, production: 0, volatility: 0,
            havoc: 0, compliance: 0, powered: true,
            appliances: {}, batteryCharge: 50, batteryMode: 'idle',
            currentTask: null, taskProgress: 0, carbonFootprint: 0, schedules: [],
        });
        io.to(id).emit('appliance_state', {});
        io.to(id).emit('update_havoc', 0);
        io.to(id).emit('battery_mode_update', 'idle');
        io.to(id).emit('battery_update', 50);
        io.to(id).emit('carbon_update', { intensity: getCurrentCarbonIntensity(), footprint: 0, hourlyRate: 0 });
        io.to(id).emit('p2p_market_update', []);
        io.to(id).emit('schedules_update', []);
    }

    timerSeconds = 600; isGameRunning = true; pricingTick = 0;
    gameState.pricing = { ...PRICE_TIERS[1] };
    gameState.carbonIntensity = getCurrentCarbonIntensity();
    io.emit('price_update', gameState.pricing);
    io.emit('p2p_market_update', []);
}

// ─── Ligações Socket ──────────────────────────────────────────────────────────
io.on('connection', (socket) => {
    console.log('Ligado:', socket.id);

    socket.on('register_user', (data) => {
        if (data.isAdmin) syncClock(socket);
        else assignRoleAndGroup(socket);
    });

    socket.on('toggle_appliance', (data) => {
        const user = gameState.users[socket.id];
        if (!user || !user.powered || !APPLIANCES[data.appliance]) return;
        user.appliances[data.appliance] = !user.appliances[data.appliance];
        let total = 0;
        for (const [k, on] of Object.entries(user.appliances))
            if (on && APPLIANCES[k]) total += APPLIANCES[k].loadValue;
        user.consumption = Math.min(100, total);
        socket.emit('appliance_state', user.appliances);
        socket.emit('consumption_update', user.consumption);
    });

    socket.on('update_slider', (data) => {
        const user = gameState.users[socket.id];
        if (!user) return;
        if (data.type === 'produce') user.production = parseInt(data.value);
    });

    socket.on('toggle_battery', (data) => {
        const user = gameState.users[socket.id];
        if (!user) return;
        user.batteryMode = data.mode;
        socket.emit('battery_mode_update', user.batteryMode);
    });

    socket.on('schedule_appliance', (data) => {
        const user = gameState.users[socket.id];
        if (!user) return;
        user.schedules = user.schedules.filter(s => s.appliance !== data.appliance);
        if (data.action !== 'none') user.schedules.push(data);
        socket.emit('schedules_update', user.schedules);
    });

    socket.on('vote_dr', (data) => {
        const user = gameState.users[socket.id];
        if (!user) return;
        const nodeId = user.group;
        if (!activeDrRequests[nodeId]) return;
        if (!activeDrRequests[nodeId].voters) activeDrRequests[nodeId].voters = new Set();
        if (activeDrRequests[nodeId].voters.has(socket.id)) return;
        activeDrRequests[nodeId].voters.add(socket.id);
        if (data.vote === 'yes') {
            activeDrRequests[nodeId].yes++;
            user.compliance = (user.compliance || 0) + 20;
            gameState.metrics.drAccepted++;
            socket.emit('dr_accepted_confirm', user.compliance);
        } else {
            activeDrRequests[nodeId].no++;
        }
        activeDrRequests[nodeId].total++;
        const req = activeDrRequests[nodeId];
        io.emit('dr_vote_update', {
            node: nodeId,
            yes: req.yes,
            total: req.total,
            thresholdMet: req.total > 0 && (req.yes / req.total) >= 0.5,
        });
    });

    socket.on('p2p_offer', (data) => {
        const user = gameState.users[socket.id];
        if (!user || user.role !== 'consumer' || gameState.scenario !== 2) return;
        gameState.p2pMarket = gameState.p2pMarket.filter(o => o.sellerId !== socket.id);
        const offer = {
            id: `${socket.id}-${Date.now()}`,
            sellerId: socket.id,
            sellerGroup: user.group,
            amount: Math.max(1, Math.min(50, parseInt(data.amount) || 10)),
            pricePerUnit: Math.max(0.01, parseFloat(data.price) || 0.10),
            timestamp: Date.now(),
        };
        gameState.p2pMarket.push(offer);
        io.emit('p2p_market_update', gameState.p2pMarket);
        logEvent('p2p', `Oferta P2P no Nó ${user.group}: ${offer.amount} unid. @ €${offer.pricePerUnit}`, user.group);
    });

    socket.on('p2p_buy', (data) => {
        const buyer = gameState.users[socket.id];
        if (!buyer || gameState.scenario !== 2) return;
        const idx = gameState.p2pMarket.findIndex(o => o.id === data.offerId);
        if (idx === -1) return;
        const offer = gameState.p2pMarket[idx];
        if (offer.sellerGroup !== buyer.group || offer.sellerId === socket.id) return;
        const seller = gameState.users[offer.sellerId];
        buyer.compliance = (buyer.compliance || 0) + 5;
        if (seller) seller.compliance = (seller.compliance || 0) + 5;
        gameState.p2pMarket.splice(idx, 1);
        io.emit('p2p_market_update', gameState.p2pMarket);
        socket.emit('p2p_trade_confirmed', { type: 'bought', amount: offer.amount, cost: offer.amount * offer.pricePerUnit });
        if (seller) io.to(offer.sellerId).emit('p2p_trade_confirmed', { type: 'sold', amount: offer.amount, earned: offer.amount * offer.pricePerUnit });
        logEvent('p2p', `Negócio P2P no Nó ${buyer.group}: ${offer.amount} unid.`, buyer.group);
    });

    socket.on('p2p_cancel', () => {
        gameState.p2pMarket = gameState.p2pMarket.filter(o => o.sellerId !== socket.id);
        io.emit('p2p_market_update', gameState.p2pMarket);
    });

    socket.on('call_for_help', (data) => {
        gameState.metrics.callsMade++;
        logEvent('call', `Chamada de ajuda do Nó ${data.group}`, data.group);
        gameState.managers.forEach(mId => io.to(mId).emit('new_ticket', { group: data.group, userId: socket.id }));
    });

    socket.on('resolve_issue', (data) => {
        const user = gameState.users[data.targetId];
        const target = io.sockets.sockets.get(data.targetId);
        if (target && user) {
            user.powered = true;
            target.emit('power_restored');
            gameState.metrics.issuesResolved++;
            logEvent('restore', `Energia reposta no Nó ${user.group}`, user.group);
        }
    });

    socket.on('manager_load_shed', (data) => {
        const g = data.group;
        if (gameState.groups[g].shed) return;
        gameState.groups[g].shed = true;
        gameState.metrics.outages++;
        logEvent('shed', `Corte de carga no Nó ${g}`, g);
        for (const [id, user] of Object.entries(gameState.users)) {
            if (user.group == g && user.role === 'consumer' && user.powered) {
                user.powered = false; user.consumption = 0; user.appliances = {};
                io.to(id).emit('outage_event', { reason: 'load_shed' });
                io.to(id).emit('appliance_state', {});
            }
        }
        setTimeout(() => {
            gameState.groups[g].shed = false;
            for (const [id, user] of Object.entries(gameState.users))
                if (user.group == g && user.role === 'consumer' && !user.powered) {
                    user.powered = true; io.to(id).emit('power_restored');
                }
        }, 15000);
    });

    socket.on('manager_auto_balance', () => {
        const sorted = Object.entries(gameState.groups)
            .map(([id, g]) => ({ id: parseInt(id), pct: g.currentLoad / g.capacity }))
            .sort((a, b) => b.pct - a.pct);
        if (sorted[0].pct > 0.65 && sorted[sorted.length - 1].pct < 0.5) {
            const from = sorted[0].id, to = sorted[sorted.length - 1].id;
            gameState.groups[from].capacity -= 100;
            gameState.groups[to].capacity += 100;
            io.emit('auto_balance_result', { from, to });
            logEvent('balance', `Auto-equilíbrio: Nó ${from} → Nó ${to}`);
        } else {
            io.to(socket.id).emit('auto_balance_result', { from: null, to: null });
        }
    });

    socket.on('manager_demand_response', (data) => {
        const targetNodes = data.group ? [parseInt(data.group)] : [1, 2, 3, 4];
        targetNodes.forEach(n => {
            activeDrRequests[n] = { yes: 0, no: 0, total: 0, voters: new Set(), resolveAt: Date.now() + 30000 };
        });
        for (const [id, user] of Object.entries(gameState.users))
            if (user.role === 'consumer' && (!data.group || user.group == data.group))
                io.to(id).emit('demand_response_event', { duration: 30, reward: 20, group: data.group });
        logEvent('dr', `Resposta à Procura enviada${data.group ? ` ao Nó ${data.group}` : ' (todos)'}`);
    });

    socket.on('reroute_power', (data) => {
        gameState.groups[data.from].capacity = Math.max(200, gameState.groups[data.from].capacity - 200);
        gameState.groups[data.to].capacity += 200;
        logEvent('reroute', `Reencaminhamento: Nó ${data.from} → Nó ${data.to}`);
    });

    socket.on('manager_ask_question', (data) =>
        io.to(data.targetId).emit('incoming_question', { managerId: socket.id, question: data.question, answerExpected: data.answer }));
    socket.on('consumer_send_reply', (data) =>
        io.to(data.managerId).emit('incoming_reply', { answer: data.answer }));

    socket.on('admin_start_quiz', (data) => {
        const q = QUIZ_QUESTIONS[data.questionIndex % QUIZ_QUESTIONS.length];
        activeQuiz = { ...q, index: data.questionIndex };
        quizAnswers = {};
        io.emit('quiz_question', { question: q.question, options: q.options, index: data.questionIndex });
    });

    socket.on('admin_end_quiz', () => {
        if (!activeQuiz) return;
        const counts = {};
        activeQuiz.options.forEach((_, i) => { counts[i] = 0; });
        Object.values(quizAnswers).forEach(a => { counts[a] = (counts[a] || 0) + 1; });
        io.emit('quiz_results', {
            question: activeQuiz.question,
            options: activeQuiz.options,
            counts, correct: activeQuiz.correct,
            explanation: activeQuiz.explanation,
            total: Object.keys(quizAnswers).length,
        });
        activeQuiz = null; quizAnswers = {};
    });

    socket.on('quiz_answer', (data) => {
        if (!activeQuiz) return;
        quizAnswers[socket.id] = data.answer;
        const counts = {};
        activeQuiz.options.forEach((_, i) => { counts[i] = 0; });
        Object.values(quizAnswers).forEach(a => { counts[a] = (counts[a] || 0) + 1; });
        io.emit('quiz_live_votes', { counts, total: Object.keys(quizAnswers).length });
    });

    socket.on('admin_change_scenario', (id) => {
        scenarioSnapshots[gameState.scenario] = { ...gameState.metrics };
        gameState.scenario = id;
        resetGameMetrics();
        io.emit('scenario_changed', id);
    });

    socket.on('admin_reset_game', () => {
        scenarioSnapshots[gameState.scenario] = { ...gameState.metrics };
        resetGameMetrics();
        io.emit('scenario_changed', gameState.scenario);
    });

    socket.on('admin_inject_event', (data) => {
        if (data.type === 'surge') {
            const g = data.group || Math.ceil(Math.random() * 4);
            const orig = gameState.groups[g].capacity;
            gameState.groups[g].capacity = Math.round(orig * 0.55);
            io.emit('grid_event', { type: 'surge', group: g, message: `⚡ Pico de tensão no Nó ${g}! Capacidade −45% durante 20 s.` });
            logEvent('surge', `Pico de tensão no Nó ${g}`, g);
            setTimeout(() => { gameState.groups[g].capacity = orig; }, 20000);
        } else if (data.type === 'demand_response') {
            const targetNodes = data.group ? [parseInt(data.group)] : [1, 2, 3, 4];
            targetNodes.forEach(n => {
                activeDrRequests[n] = { yes: 0, no: 0, total: 0, voters: new Set(), resolveAt: Date.now() + 30000 };
            });
            for (const [id, user] of Object.entries(gameState.users))
                if (user.role === 'consumer' && (!data.group || user.group == data.group))
                    io.to(id).emit('demand_response_event', { duration: 30, reward: 15 });
            logEvent('dr', 'Evento de Resposta à Procura (instrutor)');
        } else if (data.type === 'price_spike') {
            gameState.pricing = { ...PRICE_TIERS[2] };
            gameState.carbonIntensity = getCurrentCarbonIntensity();
            io.emit('price_update', gameState.pricing);
            logEvent('price', 'Pico de preço → PONTA');
            setTimeout(() => {
                gameState.pricing = { ...PRICE_TIERS[1] };
                gameState.carbonIntensity = getCurrentCarbonIntensity();
                io.emit('price_update', gameState.pricing);
            }, 30000);
        } else if (data.type === 'cloud') {
            gameState.solarModifier = 0.35;
            gameState.renewableEvent = 'cloud';
            io.emit('renewable_event', { type: 'cloud', message: '☁️ Cobertura de nuvens! Produção solar reduzida para 35% durante 30 s.', duration: 30 });
            logEvent('renewable', '☁️ Evento de cobertura de nuvens');
            setTimeout(() => {
                gameState.solarModifier = 1.0;
                gameState.renewableEvent = null;
                io.emit('renewable_event', { type: 'clear', message: '☀️ Céu limpo! Produção solar de volta ao máximo.' });
            }, 30000);
        } else if (data.type === 'wind_drop') {
            for (let i = 1; i <= 4; i++) gameState.groups[i].capacity = Math.round(gameState.groups[i].capacity * 0.85);
            io.emit('renewable_event', { type: 'wind_drop', message: '🌬️ Queda de vento! A rede perde 15% da capacidade eólica durante 25 s.', duration: 25 });
            logEvent('renewable', '🌬️ Evento de queda de vento');
            setTimeout(() => {
                for (let i = 1; i <= 4; i++) gameState.groups[i].capacity = Math.round(gameState.groups[i].capacity / 0.85);
                io.emit('renewable_event', { type: 'wind_restored', message: '🌬️ Vento restabelecido! Rede de volta ao normal.' });
            }, 25000);
        }
    });

    socket.on('disconnect', () => {
        gameState.p2pMarket = gameState.p2pMarket.filter(o => o.sellerId !== socket.id);
        io.emit('p2p_market_update', gameState.p2pMarket);
        delete gameState.users[socket.id];
        gameState.managers = gameState.managers.filter(id => id !== socket.id);
    });
});

// ─── Física da rede ───────────────────────────────────────────────────────────
function calculateGridLoad() {
    for (let i = 1; i <= 4; i++) gameState.groups[i].currentLoad = 0;
    for (const [, u] of Object.entries(gameState.users)) {
        if (u.role !== 'consumer' || !u.powered) continue;
        let net = u.consumption;
        if (gameState.scenario === 2) {
            const effProd = u.production * gameState.solarModifier;
            net -= effProd;
            if (u.batteryMode === 'discharge') net -= 15;
            if (u.batteryMode === 'charge')    net += 10;
        }
        net = Math.max(0, net);
        gameState.groups[u.group].currentLoad += net * 5;
        gameState.metrics.totalPower += net * 5;
    }
}

function checkOutages() {
    for (const [id, u] of Object.entries(gameState.users)) {
        if (u.role !== 'consumer' || !u.powered || u.consumption <= 0) continue;
        u.volatility *= 0.8;
        if (u.volatility > 25) triggerOutage(id, u, 'fuse');
    }
    for (let i = 1; i <= 4; i++) {
        const g = gameState.groups[i];
        if (g.shed) continue;
        const pct = g.currentLoad / g.capacity;
        if (gameState.scenario === 2 && pct > 0.85 && pct <= 1.0) {
            const safe = Object.keys(gameState.groups).find(k => !gameState.groups[k].shed && gameState.groups[k].currentLoad / gameState.groups[k].capacity < 0.55);
            if (safe) gameState.managers.forEach(mId => io.to(mId).emit('predictive_alert', { overloadedGroup: i, safeGroup: safe }));
        }
        if (pct > 1.0) {
            const victims = Object.keys(gameState.users)
                .filter(id => gameState.users[id].group == i && gameState.users[id].role === 'consumer' && gameState.users[id].powered)
                .sort((a, b) => gameState.users[b].volatility - gameState.users[a].volatility);
            if (victims.length) triggerOutage(victims[0], gameState.users[victims[0]], 'overload');
        }
    }
}

function triggerOutage(id, user, reason) {
    user.powered = false; user.consumption = 0; user.volatility = 0; user.appliances = {};
    io.to(id).emit('outage_event', { reason });
    io.to(id).emit('appliance_state', {});
    user.havoc += reason === 'overload' ? 50 : 10;
    io.to(id).emit('update_havoc', user.havoc);
    gameState.metrics.outages++;
    logEvent('outage', `Apagão no Nó ${user.group} (${reason})`, user.group);
    gameState.managers.forEach(mId => io.to(mId).emit('new_ticket', { group: user.group, userId: id }));
}

function checkSchedules() {
    for (const [id, user] of Object.entries(gameState.users)) {
        if (!user.schedules || user.schedules.length === 0 || !user.powered) continue;
        let changed = false;
        for (const s of user.schedules) {
            let met = false;
            if (s.condition === 'price_above' && gameState.pricing.price > s.threshold)  met = true;
            if (s.condition === 'price_below' && gameState.pricing.price < s.threshold)  met = true;
            if (s.condition === 'solar_above' && user.production > s.threshold)          met = true;
            const current = !!user.appliances[s.appliance];
            const desired = s.action === 'on';
            if (met && current !== desired) {
                user.appliances[s.appliance] = desired;
                changed = true;
                io.to(id).emit('schedule_triggered', { appliance: s.appliance, action: s.action, condition: s.condition });
            }
        }
        if (changed) {
            let total = 0;
            for (const [k, on] of Object.entries(user.appliances))
                if (on && APPLIANCES[k]) total += APPLIANCES[k].loadValue;
            user.consumption = Math.min(100, total);
            io.to(id).emit('appliance_state', user.appliances);
            io.to(id).emit('consumption_update', user.consumption);
        }
    }
}

function assignTasks() {
    const tasks = [
        { name: '🍳 Cozinhar o Jantar',        min: 60, max: 80  },
        { name: '📺 Ver Televisão',              min: 10, max: 30  },
        { name: '🫧 Lavar Roupa',                min: 60, max: 80  },
        { name: '🚗 Carregar Carro Elétrico',    min: 70, max: 100 },
        { name: '💡 Ler (Só as Luzes)',          min: 5,  max: 15  },
        { name: '❄️ Usar Ar Condicionado',       min: 20, max: 45  },
    ];
    for (const [id, u] of Object.entries(gameState.users))
        if (u.role === 'consumer' && !u.currentTask && u.powered && Math.random() < 0.25) {
            u.currentTask = tasks[Math.floor(Math.random() * tasks.length)];
            u.taskProgress = 0;
            io.to(id).emit('new_task', u.currentTask);
        }
}

function checkTasks() {
    for (const [id, u] of Object.entries(gameState.users)) {
        if (!u.currentTask || !u.powered || u.role !== 'consumer') continue;
        if (u.consumption >= u.currentTask.min && u.consumption <= u.currentTask.max) {
            u.taskProgress = (u.taskProgress || 0) + 10;
            io.to(id).emit('task_progress', u.taskProgress);
            if (u.taskProgress >= 100) {
                u.compliance = (u.compliance || 0) + 10;
                u.currentTask = null;
                io.to(id).emit('task_completed', u.compliance);
            }
        } else if (u.taskProgress > 0) {
            u.taskProgress = 0; io.to(id).emit('task_progress', 0);
        }
    }
}

function updatePricing() {
    if (gameState.scenario !== 2) return;
    if (++pricingTick % 45 === 0) {
        const r = Math.random();
        const newTier = PRICE_TIERS[r < 0.3 ? 0 : r < 0.7 ? 1 : 2];
        const oldTier = gameState.pricing.tier;
        gameState.pricing = { ...newTier };
        gameState.carbonIntensity = getCurrentCarbonIntensity();
        io.emit('price_update', gameState.pricing);
        if (oldTier !== newTier.tier)
            logEvent('price', `Preço → ${newTier.label} (${newTier.price} €/kWh)`);
    }
}

function updateBatteries() {
    if (gameState.scenario !== 2) return;
    for (const [id, u] of Object.entries(gameState.users)) {
        if (u.role !== 'consumer') continue;
        if (u.batteryMode === 'charge')    u.batteryCharge = Math.min(100, u.batteryCharge + 2);
        if (u.batteryMode === 'discharge') {
            u.batteryCharge = Math.max(0, u.batteryCharge - 1.5);
            if (u.batteryCharge <= 0) { u.batteryMode = 'idle'; io.to(id).emit('battery_mode_update', 'idle'); }
        }
        io.to(id).emit('battery_update', Math.round(u.batteryCharge));
    }
}

function updateCarbonTracking() {
    const ci = getCurrentCarbonIntensity();
    gameState.carbonIntensity = ci;
    for (const [id, u] of Object.entries(gameState.users)) {
        if (u.role !== 'consumer') continue;
        const kw = (u.consumption / 100) * 3.45;
        const hourlyGrams = kw * ci;
        u.carbonFootprint = (u.carbonFootprint || 0) + hourlyGrams / 3600;
        io.to(id).emit('carbon_update', {
            intensity: ci,
            footprint: Math.round(u.carbonFootprint),
            hourlyRate: Math.round(hourlyGrams),
        });
    }
}

function resolveDrVotes() {
    const now = Date.now();
    for (const [nodeId, req] of Object.entries(activeDrRequests)) {
        if (now >= req.resolveAt) {
            const success = req.total > 0 && (req.yes / req.total) >= 0.5;
            io.emit('dr_resolved', { node: parseInt(nodeId), success, yes: req.yes, total: req.total });
            logEvent('dr', `Resposta à Procura no Nó ${nodeId}: ${req.yes}/${req.total} (${success ? 'SUCESSO' : 'FALHOU'})`);
            delete activeDrRequests[nodeId];
        }
    }
}

function buildLeaderboard() {
    const entries = Object.entries(gameState.users)
        .filter(([, u]) => u.role === 'consumer')
        .map(([id, u]) => ({ id, group: u.group, compliance: u.compliance || 0, havoc: u.havoc || 0, carbon: Math.round(u.carbonFootprint || 0) }))
        .sort((a, b) => b.compliance - a.compliance || a.havoc - b.havoc);
    io.emit('leaderboard_update', entries);
}

function rotateManagers() {
    if (Object.keys(gameState.users).length < 2) return;
    const oldId = gameState.managers.shift();
    const consumers = Object.keys(gameState.users).filter(id => gameState.users[id].role === 'consumer');
    if (consumers.length > 0) {
        const newId = consumers[Math.floor(Math.random() * consumers.length)];
        if (gameState.users[oldId]) {
            gameState.users[oldId].role = 'consumer';
            io.to(oldId).emit('role_assigned', { role: 'consumer', group: gameState.users[oldId].group, scenario: gameState.scenario });
        }
        gameState.users[newId].role = 'manager';
        gameState.managers.push(newId);
        io.to(newId).emit('role_assigned', { role: 'manager', group: gameState.users[newId].group, scenario: gameState.scenario });
    } else if (oldId) gameState.managers.push(oldId);
}

// ─── Ciclo principal (1 segundo) ──────────────────────────────────────────────
setInterval(() => {
    if (!isGameRunning) return;
    calculateGridLoad(); checkOutages(); checkSchedules();
    assignTasks(); checkTasks(); updatePricing();
    updateBatteries(); updateCarbonTracking();
    resolveDrVotes(); buildLeaderboard();
    io.emit('state_update', gameState);
    timerSeconds--;
    const m = Math.floor(timerSeconds / 60), s = timerSeconds % 60;
    io.emit('time_update', `${m}:${s < 10 ? '0' : ''}${s}`);
    if (timerSeconds <= 0) {
        isGameRunning = false;
        scenarioSnapshots[gameState.scenario] = { ...gameState.metrics };
        io.emit('simulation_ended', { metrics: gameState.metrics, scenario: gameState.scenario, timeline: eventTimeline, snapshots: scenarioSnapshots });
    }
}, 1000);

// ─── Rotação de papéis (120 segundos) ────────────────────────────────────────
setInterval(() => {
    if (!isGameRunning) return;
    io.emit('role_swap_alert', { message: '🔄 Troca de papéis em 5 segundos!' });
    setTimeout(rotateManagers, 5000);
}, 120000);

http.listen(process.env.PORT || 3000, () => console.log('✅ Workshop da Rede Inteligente a correr na porta 3000'));
