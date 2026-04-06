const express = require('express');
const app = express();
const http = require('http').createServer(app);
const path = require('path');
const io = require('socket.io')(http, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ─── Appliance definitions ────────────────────────────────────────────────────
const APPLIANCES = {
    lights: { name: 'Lights',     icon: '💡', watts: 100,  loadValue: 5  },
    tv:     { name: 'TV',         icon: '📺', watts: 150,  loadValue: 8  },
    ac:     { name: 'AC',         icon: '❄️',  watts: 800,  loadValue: 22 },
    oven:   { name: 'Oven',       icon: '🍳', watts: 700,  loadValue: 19 },
    washer: { name: 'Washer',     icon: '🫧', watts: 500,  loadValue: 14 },
    ev:     { name: 'EV Charger', icon: '🚗', watts: 1200, loadValue: 32 },
};

const PRICE_TIERS = [
    { tier: 'off-peak', price: 0.08, label: '🌙 Off-Peak', color: 'green'  },
    { tier: 'normal',   price: 0.15, label: '🌤 Normal',   color: 'yellow' },
    { tier: 'peak',     price: 0.30, label: '🔥 PEAK',     color: 'red'    },
];

// Carbon intensity (gCO2/kWh) per price tier
const CARBON_INTENSITY = { 'off-peak': 80, 'normal': 220, 'peak': 420 };

// ─── Quiz questions ───────────────────────────────────────────────────────────
const QUIZ_QUESTIONS = [
    {
        question: 'Why did the substation trip in Scenario 1?',
        options: ['Too many users connected', 'Total load exceeded substation capacity', 'The timer ran out', 'Solar panels failed'],
        correct: 1,
        explanation: 'When total load exceeds substation capacity (>100%), the breaker trips automatically — the grid has no way to prevent it in advance.'
    },
    {
        question: 'What does Demand Response achieve?',
        options: ['Increases grid capacity permanently', 'Reduces peak load by shifting consumption', 'Replaces power plants', 'Increases electricity prices'],
        correct: 1,
        explanation: 'DR asks consumers to voluntarily reduce load at peak times, avoiding grid overload without building new infrastructure.'
    },
    {
        question: 'Which technology enables real-time pricing signals to homes?',
        options: ['Analogue electricity meters', 'Smart meters with two-way communication', 'Larger power stations', 'Underground cables'],
        correct: 1,
        explanation: 'Smart meters communicate bidirectionally — the grid can send price signals and the meter reports consumption in real time.'
    },
    {
        question: 'Why does carbon intensity drop during off-peak hours?',
        options: ['Fewer people are awake', 'Renewables dominate when demand is low', 'Coal plants switch off automatically', 'Solar panels work better at night'],
        correct: 1,
        explanation: 'During off-peak hours, steady renewables (wind, hydro) can cover most demand without needing fossil fuel backup generation.'
    },
    {
        question: 'What is the main advantage of peer-to-peer energy trading?',
        options: ['Eliminates the need for a grid', 'Lets neighbours sell surplus solar locally', 'Makes all electricity free', 'Increases grid carbon emissions'],
        correct: 1,
        explanation: 'P2P trading allows prosumers to sell excess solar directly to neighbours, reducing transmission losses and lowering everyone\'s bills.'
    },
];

// ─── Game State ───────────────────────────────────────────────────────────────
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
    p2pMarket: [],       // { id, sellerId, sellerGroup, amount, pricePerUnit }
    carbonIntensity: 220,
};

let timerSeconds   = 600;
let isGameRunning  = false;
let pricingTick    = 0;
let eventTimeline  = [];      // { time, type, message, group }
let scenarioSnapshots = {};   // { 1: metrics, 2: metrics }

// ─── DR voting state ──────────────────────────────────────────────────────────
let activeDrRequests = {};    // { nodeId: { yes, no, total, resolveAt } }

// ─── Quiz state ───────────────────────────────────────────────────────────────
let activeQuiz    = null;     // { ...QUIZ_QUESTIONS[n], index }
let quizAnswers   = {};       // { socketId: answerIndex }

// ─── Helpers ──────────────────────────────────────────────────────────────────
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
        carbonFootprint: 0,
        schedules: [],
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

// ─── Socket handlers ──────────────────────────────────────────────────────────
io.on('connection', (socket) => {
    console.log('Connected:', socket.id);

    socket.on('register_user', (data) => {
        if (data.isAdmin) syncClock(socket);
        else assignRoleAndGroup(socket);
    });

    // ── Appliance toggle ──────────────────────────────────────────────────────
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

    // ── Solar slider ──────────────────────────────────────────────────────────
    socket.on('update_slider', (data) => {
        const user = gameState.users[socket.id];
        if (!user) return;
        if (data.type === 'produce') user.production = parseInt(data.value);
    });

    // ── Battery mode ──────────────────────────────────────────────────────────
    socket.on('toggle_battery', (data) => {
        const user = gameState.users[socket.id];
        if (!user) return;
        user.batteryMode = data.mode;
        socket.emit('battery_mode_update', user.batteryMode);
    });

    // ── Appliance scheduling ──────────────────────────────────────────────────
    socket.on('schedule_appliance', (data) => {
        const user = gameState.users[socket.id];
        if (!user) return;
        user.schedules = user.schedules.filter(s => s.appliance !== data.appliance);
        if (data.action !== 'none') user.schedules.push(data);
        socket.emit('schedules_update', user.schedules);
    });

    // ── DR voting (collective) ────────────────────────────────────────────────
    socket.on('vote_dr', (data) => {
        const user = gameState.users[socket.id];
        if (!user) return;
        const nodeId = user.group;
        if (!activeDrRequests[nodeId]) return; // No active DR for this node

        // Prevent double voting
        if (activeDrRequests[nodeId].voters && activeDrRequests[nodeId].voters.has(socket.id)) return;
        if (!activeDrRequests[nodeId].voters) activeDrRequests[nodeId].voters = new Set();
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

    // ── P2P energy trading ────────────────────────────────────────────────────
    socket.on('p2p_offer', (data) => {
        const user = gameState.users[socket.id];
        if (!user || user.role !== 'consumer' || gameState.scenario !== 2) return;
        // Remove any existing offer from this seller
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
        logEvent('p2p', `P2P offer on Node ${user.group}: ${offer.amount} units @ €${offer.pricePerUnit}`, user.group);
    });

    socket.on('p2p_buy', (data) => {
        const buyer = gameState.users[socket.id];
        if (!buyer || gameState.scenario !== 2) return;
        const idx = gameState.p2pMarket.findIndex(o => o.id === data.offerId);
        if (idx === -1) return;
        const offer = gameState.p2pMarket[idx];
        if (offer.sellerGroup !== buyer.group) return; // Same node only
        if (offer.sellerId === socket.id) return; // Can't buy own offer

        const seller = gameState.users[offer.sellerId];
        buyer.compliance = (buyer.compliance || 0) + 5;
        if (seller) seller.compliance = (seller.compliance || 0) + 5;

        gameState.p2pMarket.splice(idx, 1);
        io.emit('p2p_market_update', gameState.p2pMarket);
        socket.emit('p2p_trade_confirmed', { type: 'bought', amount: offer.amount, cost: offer.amount * offer.pricePerUnit });
        if (seller) io.to(offer.sellerId).emit('p2p_trade_confirmed', { type: 'sold', amount: offer.amount, earned: offer.amount * offer.pricePerUnit });
        logEvent('p2p', `P2P trade on Node ${buyer.group}: ${offer.amount} units`, buyer.group);
    });

    socket.on('p2p_cancel', () => {
        gameState.p2pMarket = gameState.p2pMarket.filter(o => o.sellerId !== socket.id);
        io.emit('p2p_market_update', gameState.p2pMarket);
    });

    // ── Manual help call (Scenario 1) ─────────────────────────────────────────
    socket.on('call_for_help', (data) => {
        gameState.metrics.callsMade++;
        logEvent('call', `Help call from Node ${data.group}`, data.group);
        gameState.managers.forEach(mId => io.to(mId).emit('new_ticket', { group: data.group, userId: socket.id }));
    });

    // ── Manager restores power ────────────────────────────────────────────────
    socket.on('resolve_issue', (data) => {
        const user = gameState.users[data.targetId];
        const target = io.sockets.sockets.get(data.targetId);
        if (target && user) {
            user.powered = true;
            target.emit('power_restored');
            gameState.metrics.issuesResolved++;
            logEvent('restore', `Power restored on Node ${user.group}`, user.group);
        }
    });

    // ── Manager: load shedding (Scenario 1) ──────────────────────────────────
    socket.on('manager_load_shed', (data) => {
        const g = data.group;
        if (gameState.groups[g].shed) return;
        gameState.groups[g].shed = true;
        gameState.metrics.outages++;
        logEvent('shed', `Load shed on Node ${g}`, g);

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

    // ── Manager: auto-balance (Scenario 2) ───────────────────────────────────
    socket.on('manager_auto_balance', () => {
        const sorted = Object.entries(gameState.groups)
            .map(([id, g]) => ({ id: parseInt(id), pct: g.currentLoad / g.capacity }))
            .sort((a, b) => b.pct - a.pct);

        if (sorted[0].pct > 0.65 && sorted[sorted.length - 1].pct < 0.5) {
            const from = sorted[0].id, to = sorted[sorted.length - 1].id;
            gameState.groups[from].capacity -= 100;
            gameState.groups[to].capacity += 100;
            io.emit('auto_balance_result', { from, to });
            logEvent('balance', `Auto-balanced Node ${from} → Node ${to}`);
        } else {
            io.to(socket.id).emit('auto_balance_result', { from: null, to: null });
        }
    });

    // ── Manager: demand response broadcast ───────────────────────────────────
    socket.on('manager_demand_response', (data) => {
        const targetNodes = data.group ? [parseInt(data.group)] : [1, 2, 3, 4];
        targetNodes.forEach(n => {
            activeDrRequests[n] = { yes: 0, no: 0, total: 0, voters: new Set(), resolveAt: Date.now() + 30000 };
        });
        for (const [id, user] of Object.entries(gameState.users))
            if (user.role === 'consumer' && (!data.group || user.group == data.group))
                io.to(id).emit('demand_response_event', { duration: 30, reward: 20, group: data.group });
        logEvent('dr', `DR broadcast${data.group ? ` to Node ${data.group}` : ' (all)'}`);
    });

    // ── Smart reroute ─────────────────────────────────────────────────────────
    socket.on('reroute_power', (data) => {
        gameState.groups[data.from].capacity = Math.max(200, gameState.groups[data.from].capacity - 200);
        gameState.groups[data.to].capacity += 200;
        logEvent('reroute', `Rerouted Node ${data.from} → Node ${data.to}`);
    });

    // ── Chat ──────────────────────────────────────────────────────────────────
    socket.on('manager_ask_question', (data) =>
        io.to(data.targetId).emit('incoming_question', { managerId: socket.id, question: data.question, answerExpected: data.answer }));
    socket.on('consumer_send_reply', (data) =>
        io.to(data.managerId).emit('incoming_reply', { answer: data.answer }));

    // ── Quiz ──────────────────────────────────────────────────────────────────
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
            counts,
            correct: activeQuiz.correct,
            explanation: activeQuiz.explanation,
            total: Object.keys(quizAnswers).length,
        });
        activeQuiz = null;
        quizAnswers = {};
    });

    socket.on('quiz_answer', (data) => {
        if (!activeQuiz) return;
        quizAnswers[socket.id] = data.answer;
        const counts = {};
        activeQuiz.options.forEach((_, i) => { counts[i] = 0; });
        Object.values(quizAnswers).forEach(a => { counts[a] = (counts[a] || 0) + 1; });
        io.emit('quiz_live_votes', { counts, total: Object.keys(quizAnswers).length });
    });

    // ── Admin events ──────────────────────────────────────────────────────────
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
            io.emit('grid_event', { type: 'surge', group: g, message: `⚡ Power surge on Node ${g}! Capacity −45% for 20 s.` });
            logEvent('surge', `Surge on Node ${g}`, g);
            setTimeout(() => { gameState.groups[g].capacity = orig; }, 20000);
        } else if (data.type === 'demand_response') {
            const targetNodes = data.group ? [parseInt(data.group)] : [1, 2, 3, 4];
            targetNodes.forEach(n => {
                activeDrRequests[n] = { yes: 0, no: 0, total: 0, voters: new Set(), resolveAt: Date.now() + 30000 };
            });
            for (const [id, user] of Object.entries(gameState.users))
                if (user.role === 'consumer' && (!data.group || user.group == data.group))
                    io.to(id).emit('demand_response_event', { duration: 30, reward: 15 });
            logEvent('dr', `Admin DR event`);
        } else if (data.type === 'price_spike') {
            gameState.pricing = { ...PRICE_TIERS[2] };
            gameState.carbonIntensity = getCurrentCarbonIntensity();
            io.emit('price_update', gameState.pricing);
            logEvent('price', 'Admin price spike → PEAK');
            setTimeout(() => {
                gameState.pricing = { ...PRICE_TIERS[1] };
                gameState.carbonIntensity = getCurrentCarbonIntensity();
                io.emit('price_update', gameState.pricing);
            }, 30000);
        } else if (data.type === 'cloud') {
            gameState.solarModifier = 0.35;
            gameState.renewableEvent = 'cloud';
            io.emit('renewable_event', { type: 'cloud', message: '☁️ Cloud cover! Solar output reduced to 35% for 30 s.', duration: 30 });
            logEvent('renewable', '☁️ Cloud cover event');
            setTimeout(() => {
                gameState.solarModifier = 1.0;
                gameState.renewableEvent = null;
                io.emit('renewable_event', { type: 'clear', message: '☀️ Skies cleared! Solar back to full output.' });
            }, 30000);
        } else if (data.type === 'wind_drop') {
            for (let i = 1; i <= 4; i++) gameState.groups[i].capacity = Math.round(gameState.groups[i].capacity * 0.85);
            io.emit('renewable_event', { type: 'wind_drop', message: '🌬️ Wind drop! Grid loses 150 MW of wind capacity for 25 s.', duration: 25 });
            logEvent('renewable', '🌬️ Wind drop event');
            setTimeout(() => {
                for (let i = 1; i <= 4; i++) gameState.groups[i].capacity = Math.round(gameState.groups[i].capacity / 0.85);
                io.emit('renewable_event', { type: 'wind_restored', message: '🌬️ Wind restored! Grid back to normal.' });
            }, 25000);
        }
    });

    socket.on('disconnect', () => {
        // Remove any p2p offers from this user
        gameState.p2pMarket = gameState.p2pMarket.filter(o => o.sellerId !== socket.id);
        io.emit('p2p_market_update', gameState.p2pMarket);
        delete gameState.users[socket.id];
        gameState.managers = gameState.managers.filter(id => id !== socket.id);
    });
});

// ─── Physics ──────────────────────────────────────────────────────────────────
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
    logEvent('outage', `Outage on Node ${user.group} (${reason})`, user.group);
    gameState.managers.forEach(mId => io.to(mId).emit('new_ticket', { group: user.group, userId: id }));
}

function checkSchedules() {
    for (const [id, user] of Object.entries(gameState.users)) {
        if (!user.schedules || user.schedules.length === 0 || !user.powered) continue;
        let changed = false;
        for (const s of user.schedules) {
            let met = false;
            if (s.condition === 'price_above'  && gameState.pricing.price > s.threshold)  met = true;
            if (s.condition === 'price_below'  && gameState.pricing.price < s.threshold)  met = true;
            if (s.condition === 'solar_above'  && user.production > s.threshold)          met = true;
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
        { name: '🍳 Cooking Dinner',       min: 60, max: 80  },
        { name: '📺 Watching TV',           min: 10, max: 30  },
        { name: '🫧 Doing Laundry',         min: 60, max: 80  },
        { name: '🚗 Charging EV',           min: 70, max: 100 },
        { name: '💡 Reading (Lights Only)', min: 5,  max: 15  },
        { name: '❄️ Running AC',             min: 20, max: 45  },
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
            logEvent('price', `Price → ${newTier.label} (${newTier.price} €/kWh)`);
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
        u.carbonFootprint = (u.carbonFootprint || 0) + hourlyGrams / 3600; // per second
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
            const successRate = req.total > 0 ? req.yes / req.total : 0;
            const success = successRate >= 0.5;
            io.emit('dr_resolved', { node: parseInt(nodeId), success, yes: req.yes, total: req.total });
            logEvent('dr', `DR resolved on Node ${nodeId}: ${req.yes}/${req.total} (${success ? 'SUCCESS' : 'FAILED'})`);
            delete activeDrRequests[nodeId];
        }
    }
}

function buildLeaderboard() {
    const entries = Object.entries(gameState.users)
        .filter(([, u]) => u.role === 'consumer')
        .map(([id, u]) => ({
            id, group: u.group,
            compliance: u.compliance || 0,
            havoc: u.havoc || 0,
            carbon: Math.round(u.carbonFootprint || 0),
        }))
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

// ─── Master game loop (1 second) ──────────────────────────────────────────────
setInterval(() => {
    if (!isGameRunning) return;

    calculateGridLoad();
    checkOutages();
    checkSchedules();
    assignTasks();
    checkTasks();
    updatePricing();
    updateBatteries();
    updateCarbonTracking();
    resolveDrVotes();
    buildLeaderboard();

    io.emit('state_update', gameState);

    timerSeconds--;
    const m = Math.floor(timerSeconds / 60), s = timerSeconds % 60;
    io.emit('time_update', `${m}:${s < 10 ? '0' : ''}${s}`);

    if (timerSeconds <= 0) {
        isGameRunning = false;
        scenarioSnapshots[gameState.scenario] = { ...gameState.metrics };
        io.emit('simulation_ended', {
            metrics: gameState.metrics,
            scenario: gameState.scenario,
            timeline: eventTimeline,
            snapshots: scenarioSnapshots,
        });
    }
}, 1000);

// ─── Role rotation (every 120 s) ──────────────────────────────────────────────
setInterval(() => {
    if (!isGameRunning) return;
    io.emit('role_swap_alert', { message: '🔄 Roles rotating in 5 seconds!' });
    setTimeout(rotateManagers, 5000);
}, 120000);

http.listen(process.env.PORT || 3000, () => console.log('✅ Smart Grid Workshop running on port 3000'));
