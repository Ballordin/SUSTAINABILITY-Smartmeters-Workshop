const express = require('express');
const app = express();
const http = require('http').createServer(app);
const path = require('path');
const io = require('socket.io')(http, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ─── Appliance definitions ────────────────────────────────────────────────────
// loadValue: contribution to the 0–100 consumption scale (all 6 sum to 100)
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
};

let timerSeconds = 600;
let isGameRunning = false;
let pricingTick = 0;

// ─── Socket handlers ──────────────────────────────────────────────────────────
io.on('connection', (socket) => {
    console.log('Connected:', socket.id);

    socket.on('register_user', (data) => {
        if (data.isAdmin) syncClock(socket);
        else assignRoleAndGroup(socket);
    });

    // Appliance toggle — primary interaction for both scenarios
    socket.on('toggle_appliance', (data) => {
        const user = gameState.users[socket.id];
        if (!user || !user.powered) return;
        if (!APPLIANCES[data.appliance]) return;

        user.appliances[data.appliance] = !user.appliances[data.appliance];

        let total = 0;
        for (const [key, active] of Object.entries(user.appliances))
            if (active && APPLIANCES[key]) total += APPLIANCES[key].loadValue;
        user.consumption = Math.min(100, total);

        socket.emit('appliance_state', user.appliances);
        socket.emit('consumption_update', user.consumption);
    });

    // Solar production slider (Scenario 2)
    socket.on('update_slider', (data) => {
        const user = gameState.users[socket.id];
        if (!user) return;
        if (data.type === 'produce') user.production = parseInt(data.value);
    });

    // Battery mode (Scenario 2)
    socket.on('toggle_battery', (data) => {
        const user = gameState.users[socket.id];
        if (!user) return;
        user.batteryMode = data.mode; // 'charge' | 'discharge' | 'idle'
        socket.emit('battery_mode_update', user.batteryMode);
    });

    // Accept demand-response event (Scenario 2)
    socket.on('accept_demand_response', () => {
        const user = gameState.users[socket.id];
        if (!user) return;
        user.compliance = (user.compliance || 0) + 20;
        gameState.metrics.drAccepted++;
        socket.emit('dr_accepted_confirm', user.compliance);
    });

    // Manual help call (Scenario 1)
    socket.on('call_for_help', (data) => {
        gameState.metrics.callsMade++;
        gameState.managers.forEach(mId => io.to(mId).emit('new_ticket', { group: data.group, userId: socket.id }));
    });

    // Manager restores a consumer's power
    socket.on('resolve_issue', (data) => {
        const user = gameState.users[data.targetId];
        const target = io.sockets.sockets.get(data.targetId);
        if (target && user) {
            user.powered = true;
            target.emit('power_restored');
            gameState.metrics.issuesResolved++;
        }
    });

    // Manager: load-shedding (Scenario 1) — cuts an entire node for 15 s
    socket.on('manager_load_shed', (data) => {
        const g = data.group;
        if (gameState.groups[g].shed) return;
        gameState.groups[g].shed = true;
        gameState.metrics.outages++;

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

    // Manager: one-click auto-balance (Scenario 2)
    socket.on('manager_auto_balance', () => {
        const sorted = Object.entries(gameState.groups)
            .map(([id, g]) => ({ id: parseInt(id), pct: g.currentLoad / g.capacity }))
            .sort((a, b) => b.pct - a.pct);

        if (sorted[0].pct > 0.65 && sorted[sorted.length - 1].pct < 0.5) {
            const from = sorted[0].id, to = sorted[sorted.length - 1].id;
            gameState.groups[from].capacity -= 100;
            gameState.groups[to].capacity += 100;
            io.emit('auto_balance_result', { from, to });
        } else {
            io.to(socket.id).emit('auto_balance_result', { from: null, to: null });
        }
    });

    // Manager: broadcast demand-response to consumers
    socket.on('manager_demand_response', (data) => {
        for (const [id, user] of Object.entries(gameState.users))
            if (user.role === 'consumer' && (!data.group || user.group == data.group))
                io.to(id).emit('demand_response_event', { duration: 30, reward: 20, group: data.group });
    });

    // Smart reroute from predictive panel
    socket.on('reroute_power', (data) => {
        gameState.groups[data.from].capacity = Math.max(200, gameState.groups[data.from].capacity - 200);
        gameState.groups[data.to].capacity += 200;
    });

    // Admin controls
    socket.on('admin_change_scenario', (id) => {
        gameState.scenario = id;
        resetGameMetrics();
        io.emit('scenario_changed', id);
    });
    socket.on('admin_reset_game', () => { resetGameMetrics(); io.emit('scenario_changed', gameState.scenario); });

    socket.on('admin_inject_event', (data) => {
        if (data.type === 'surge') {
            const g = data.group || Math.ceil(Math.random() * 4);
            const orig = gameState.groups[g].capacity;
            gameState.groups[g].capacity = Math.round(orig * 0.55);
            io.emit('grid_event', { type: 'surge', group: g, message: `⚡ Power surge on Node ${g}! Capacity −45% for 20 s.` });
            setTimeout(() => { gameState.groups[g].capacity = orig; }, 20000);
        } else if (data.type === 'demand_response') {
            for (const [id, user] of Object.entries(gameState.users))
                if (user.role === 'consumer')
                    io.to(id).emit('demand_response_event', { duration: 30, reward: 15 });
        } else if (data.type === 'price_spike') {
            gameState.pricing = { ...PRICE_TIERS[2] };
            io.emit('price_update', gameState.pricing);
            setTimeout(() => { gameState.pricing = { ...PRICE_TIERS[1] }; io.emit('price_update', gameState.pricing); }, 30000);
        }
    });

    // Diagnostic chat between manager and consumer
    socket.on('manager_ask_question', (data) =>
        io.to(data.targetId).emit('incoming_question', { managerId: socket.id, question: data.question, answerExpected: data.answer }));
    socket.on('consumer_send_reply', (data) =>
        io.to(data.managerId).emit('incoming_reply', { answer: data.answer }));

    socket.on('disconnect', () => {
        delete gameState.users[socket.id];
        gameState.managers = gameState.managers.filter(id => id !== socket.id);
    });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function syncClock(socket) {
    const m = Math.floor(timerSeconds / 60), s = timerSeconds % 60;
    socket.emit('time_update', `${m}:${s < 10 ? '0' : ''}${s}`);
}

function assignRoleAndGroup(socket) {
    const group = Math.floor(Math.random() * 4) + 1;
    const role = gameState.managers.length === 0 ? 'manager' : 'consumer';
    if (role === 'manager') gameState.managers.push(socket.id);

    gameState.users[socket.id] = {
        role, group, consumption: 0, production: 0, volatility: 0,
        havoc: 0, compliance: 0, powered: true,
        appliances: {}, batteryCharge: 50, batteryMode: 'idle',
        currentTask: null, taskProgress: 0,
    };

    socket.emit('role_assigned', { role, group, scenario: gameState.scenario });
    socket.emit('price_update', gameState.pricing);
    socket.emit('battery_mode_update', 'idle');
    syncClock(socket);
}

function resetGameMetrics() {
    gameState.metrics = { outages: 0, callsMade: 0, issuesResolved: 0, totalPower: 0, drAccepted: 0 };
    for (let i = 1; i <= 4; i++) gameState.groups[i] = { capacity: 1000, currentLoad: 0, shed: false };
    for (const id in gameState.users) {
        const u = gameState.users[id];
        Object.assign(u, { consumption: 0, production: 0, volatility: 0, havoc: 0, compliance: 0, powered: true,
                           appliances: {}, batteryCharge: 50, batteryMode: 'idle', currentTask: null, taskProgress: 0 });
        io.to(id).emit('appliance_state', {}); io.to(id).emit('update_havoc', 0);
        io.to(id).emit('battery_mode_update', 'idle'); io.to(id).emit('battery_update', 50);
    }
    timerSeconds = 600; isGameRunning = true; pricingTick = 0;
    gameState.pricing = { ...PRICE_TIERS[1] };
    io.emit('price_update', gameState.pricing);
}

// ─── Physics ──────────────────────────────────────────────────────────────────
function calculateGridLoad() {
    for (let i = 1; i <= 4; i++) gameState.groups[i].currentLoad = 0;
    for (const [, u] of Object.entries(gameState.users)) {
        if (u.role !== 'consumer' || !u.powered) continue;
        let net = u.consumption;
        if (gameState.scenario === 2) {
            net -= u.production;
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
    gameState.managers.forEach(mId => io.to(mId).emit('new_ticket', { group: user.group, userId: id }));
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
        gameState.pricing = { ...PRICE_TIERS[r < 0.3 ? 0 : r < 0.7 ? 1 : 2] };
        io.emit('price_update', gameState.pricing);
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

function buildLeaderboard() {
    const entries = Object.entries(gameState.users)
        .filter(([, u]) => u.role === 'consumer')
        .map(([id, u]) => ({ id, group: u.group, compliance: u.compliance || 0, havoc: u.havoc || 0, consumption: u.consumption }))
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

// ─── Loops ────────────────────────────────────────────────────────────────────
setInterval(() => {
    if (!isGameRunning) return;
    calculateGridLoad(); checkOutages(); assignTasks(); checkTasks();
    updatePricing(); updateBatteries(); buildLeaderboard();

    io.emit('state_update', gameState);

    timerSeconds--;
    const m = Math.floor(timerSeconds / 60), s = timerSeconds % 60;
    io.emit('time_update', `${m}:${s < 10 ? '0' : ''}${s}`);

    if (timerSeconds <= 0) { isGameRunning = false; io.emit('simulation_ended', gameState.metrics); }
}, 1000);

setInterval(() => {
    if (!isGameRunning) return;
    io.emit('role_swap_alert', { message: '🔄 Roles rotating in 5 seconds!' });
    setTimeout(rotateManagers, 5000);
}, 120000);

http.listen(process.env.PORT || 3000, () => console.log('✅ Smart Grid Workshop running on port 3000'));
