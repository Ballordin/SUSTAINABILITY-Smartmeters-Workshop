const express = require('express');
const app = express();
const http = require('http').createServer(app);
const path = require('path');
const io = require('socket.io')(http, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ─── Eletrodomésticos ─────────────────────────────────────────────────────────
const APPLIANCES = {
    lights: { name: 'Luzes',           icon: '💡', watts: 100,  loadValue: 5  },
    tv:     { name: 'Televisão',        icon: '📺', watts: 150,  loadValue: 8  },
    ac:     { name: 'Ar Condicionado',  icon: '❄️',  watts: 800,  loadValue: 22 },
    oven:   { name: 'Forno',            icon: '🍳', watts: 700,  loadValue: 19 },
    washer: { name: 'Máq. de Lavar',    icon: '🫧', watts: 500,  loadValue: 14 },
    ev:     { name: 'Carregador VE',    icon: '🚗', watts: 1200, loadValue: 32 },
};

const PRICE_TIERS = [
    { tier: 'off-peak', price: 0.08, label: '🌙 Vazio',  color: 'green'  },
    { tier: 'normal',   price: 0.15, label: '🌤 Normal',  color: 'yellow' },
    { tier: 'peak',     price: 0.30, label: '🔥 PONTA',   color: 'red'    },
];

const CARBON_S2  = { 'off-peak': 80, 'normal': 220, 'peak': 420 };
const CARBON_S1  = 350; // Rede Tradicional — combustíveis fósseis sem otimização

const SCENARIO_NAMES = {
    1: 'Rede Elétrica Tradicional',
    2: 'Rede Elétrica Inteligente',
};

// ─── 10 Perguntas do Quiz (baseadas nos slides) ───────────────────────────────
const QUIZ_QUESTIONS = [
    {
        question: 'Qual é a principal diferença no fluxo de energia entre a rede elétrica tradicional e a Smart Grid?',
        options: [
            'A rede tradicional tem fluxo bidirecional',
            'A Smart Grid tem fluxo bidirecional — a casa também injeta energia na rede',
            'As duas redes têm o mesmo tipo de fluxo',
            'A Smart Grid usa apenas corrente contínua',
        ],
        correct: 1,
        explanation: 'Na rede tradicional, o fluxo é unidirecional (central → consumidor). Na Smart Grid, é bidirecional: a casa pode injetar o excedente solar na rede, transformando o consumidor num Prosumer.',
    },
    {
        question: 'O que é necessário para manter a frequência da rede elétrica nos 50 Hz?',
        options: [
            'A geração deve ser sempre superior ao consumo',
            'A tensão deve ser constante em todas as subestações',
            'O consumo e a geração devem ser equivalentes em tempo real',
            'Usar apenas fontes de energia renováveis',
        ],
        correct: 2,
        explanation: 'Para manter a frequência a 50 Hz, o consumo e a geração têm de ser equivalentes em cada instante. Qualquer desequilíbrio provoca variações perigosas de frequência.',
    },
    {
        question: 'Qual é o maior desafio quando uma nuvem passa sobre painéis solares?',
        options: [
            'A falta total de energia solar',
            'A velocidade com que a produção cai — cerca de 80% em poucos segundos',
            'O aquecimento excessivo dos painéis',
            'A sobrecarga da rede local',
        ],
        correct: 1,
        explanation: 'O desafio não é a falta de energia em si, mas a velocidade da queda. Uma nuvem pode reduzir a produção solar em ~80% em poucos segundos, dificultando a compensação pela rede.',
    },
    {
        question: 'O que é um "Prosumer" no contexto das redes elétricas inteligentes?',
        options: [
            'Um consumidor industrial de grande porte',
            'Um técnico especializado em Smart Meters',
            'Um consumidor que também é produtor ativo de energia',
            'Uma empresa de gestão de energia renovável',
        ],
        correct: 2,
        explanation: 'Um Prosumer (Producer + Consumer) é um consumidor que também produz energia — por exemplo com painéis solares — e pode injetar o excedente na rede.',
    },
    {
        question: 'Para que serve principalmente um Smart Meter?',
        options: [
            'Apenas para emitir faturas mensais de eletricidade',
            'Para converter energia solar em corrente alternada',
            'Para monitorizar o consumo em intervalos de minutos e comunicar dados à distribuidora',
            'Para cortar a energia quando o consumo é excessivo',
        ],
        correct: 2,
        explanation: 'O Smart Meter faz leituras granulares em intervalos de minutos, envia dados automaticamente à distribuidora e ao utilizador, e deteta cortes ou anomalias instantaneamente.',
    },
    {
        question: 'O que descreve a "Curva de Pato" na gestão da rede elétrica?',
        options: [
            'Uma metodologia de poupança energética da Califórnia',
            'O excesso de produção solar de dia e a necessidade de rampa ultra-rápida ao pôr-do-sol',
            'A curva de consumo típica de uma família portuguesa',
            'Um sistema de armazenamento em bateria de grande escala',
        ],
        correct: 1,
        explanation: 'A Curva de Pato representa o excesso de oferta solar durante o dia e a necessidade de uma rampa ultra-rápida ao pôr-do-sol, quando a produção cessa mas o consumo aumenta.',
    },
    {
        question: 'O que é uma Virtual Power Plant (VPP)?',
        options: [
            'Uma central elétrica simulada para treino de operadores',
            'Uma plataforma de realidade virtual para a rede elétrica',
            'Um software que agrega milhares de pequenos ativos como se fossem uma central de grande escala',
            'Um tipo de central nuclear de nova geração',
        ],
        correct: 2,
        explanation: 'Uma VPP agrega e gere milhares de pequenos ativos distribuídos (painéis, baterias, VEs) como se fossem uma única central, podendo injetar energia na rede em segundos.',
    },
    {
        question: 'Qual é a função principal do Edge Computing nas Smart Grids?',
        options: [
            'Aumentar a velocidade da internet nos transformadores de rua',
            'Processar dados localmente com latência reduzida e maior privacidade',
            'Armazenar energia em baterias distribuídas pela rede',
            'Gerir a faturação dos consumidores de forma autónoma',
        ],
        correct: 1,
        explanation: 'O Edge Computing processa dados no próprio transformador de rua, reduz a latência para milissegundos, protege a privacidade dos utilizadores e mantém a rede operacional mesmo sem internet.',
    },
    {
        question: 'Qual é o principal risco de cibersegurança específico das Smart Grids?',
        options: [
            'A sobrecarga dos servidores com excesso de dados',
            'A perda de sinal WiFi nos Smart Meters',
            'A manipulação de dados de consumo ou o desligamento remoto de subestações por hackers',
            'A falha dos painéis solares por vírus informáticos',
        ],
        correct: 2,
        explanation: 'Milhões de Smart Meters e sensores IoT criam uma vasta superfície de ataque. Hackers podem manipular dados ou desligar remotamente subestações, exigindo encriptação robusta.',
    },
    {
        question: 'Como a Smart Grid contribui para a sustentabilidade ambiental?',
        options: [
            'Eliminando completamente a necessidade de centrais elétricas',
            'Aumentando o consumo para estimular a economia verde',
            'Viabilizando 100% de energias renováveis sem colapsos e reduzindo emissões de CO₂',
            'Substituindo todos os contadores analógicos por digitais',
        ],
        correct: 2,
        explanation: 'A Smart Grid viabiliza 100% de energia limpa sem colapsos, reduz perdas técnicas e diminui a necessidade de centrais a carvão ou gás — contribuindo diretamente para a redução de CO₂.',
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
    metrics: {
        outages: 0, callsMade: 0, issuesResolved: 0,
        totalPower: 0, drAccepted: 0,
        totalCO2: 0,
        stabilityScore: 100,
    },
    pricing: { ...PRICE_TIERS[1] },
    solarModifier: 1.0,
    renewableEvent: null,
    p2pMarket: [],
    carbonIntensity: 220,
};

let timerSeconds      = 360; // Cenário 1: 6 minutos
let isGameRunning     = false;
let pricingTick       = 0;
let eventTimeline     = [];
let scenarioSnapshots = {};
let activeDrRequests  = {};

// Quiz state
let activeQuiz          = null;
let quizAnswers         = {};
let quizDeadlineTimeout = null;
let questionsLaunched   = 0;

// ─── Auxiliares ───────────────────────────────────────────────────────────────
function syncClock(socket) {
    const m = Math.floor(timerSeconds / 60), s = timerSeconds % 60;
    socket.emit('time_update', `${m}:${s < 10 ? '0' : ''}${s}`);
}

function logEvent(type, message, group = null) {
    eventTimeline.push({ time: 600 - timerSeconds, type, message, group });
}

function getCurrentCarbonIntensity() {
    return gameState.scenario === 1 ? CARBON_S1 : (CARBON_S2[gameState.pricing.tier] || 220);
}

function assignRoleAndGroup(socket, name) {
    const group = Math.floor(Math.random() * 4) + 1;
    const role  = gameState.managers.length === 0 ? 'manager' : 'consumer';
    if (role === 'manager') gameState.managers.push(socket.id);

    gameState.users[socket.id] = {
        role, group,
        name: (name || 'Anónimo').slice(0, 30),
        consumption: 0, production: 0, volatility: 0,
        havoc: 0, compliance: 0, quizScore: 0,
        powered: true, appliances: {}, batteryCharge: 50, batteryMode: 'idle',
        currentTask: null, taskProgress: 0, carbonFootprint: 0, schedules: [],
    };

    socket.emit('role_assigned', {
        role, group, scenario: gameState.scenario,
        name: gameState.users[socket.id].name,
        scenarioName: SCENARIO_NAMES[gameState.scenario],
    });
    socket.emit('price_update', gameState.pricing);
    socket.emit('battery_mode_update', 'idle');
    socket.emit('carbon_update', { intensity: getCurrentCarbonIntensity(), footprint: 0, hourlyRate: 0 });
    socket.emit('p2p_market_update', gameState.p2pMarket);
    socket.emit('stability_update', Math.round(gameState.metrics.stabilityScore));
    syncClock(socket);
}

function resetGameMetrics() {
    gameState.metrics = {
        outages: 0, callsMade: 0, issuesResolved: 0,
        totalPower: 0, drAccepted: 0,
        totalCO2: 0, stabilityScore: 100,
    };
    for (let i = 1; i <= 4; i++) gameState.groups[i] = { capacity: 1000, currentLoad: 0, shed: false };
    gameState.solarModifier = 1.0;
    gameState.renewableEvent = null;
    gameState.p2pMarket = [];
    activeDrRequests = {};
    eventTimeline = [];
    questionsLaunched = 0;

    if (quizDeadlineTimeout) { clearTimeout(quizDeadlineTimeout); quizDeadlineTimeout = null; }
    activeQuiz = null; quizAnswers = {};

    for (const id in gameState.users) {
        const u = gameState.users[id];
        Object.assign(u, {
            consumption: 0, production: 0, volatility: 0,
            havoc: 0, compliance: 0, quizScore: 0, powered: true,
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
        io.to(id).emit('quiz_reset'); // client resets quiz state
    }

    timerSeconds = gameState.scenario === 1 ? 360 : 600;
    isGameRunning = true; pricingTick = 0;
    gameState.pricing = { ...PRICE_TIERS[1] };
    gameState.carbonIntensity = getCurrentCarbonIntensity();
    io.emit('price_update', gameState.pricing);
    io.emit('p2p_market_update', []);
    io.emit('stability_update', 100);
}

// ─── Quiz: lançar pergunta ─────────────────────────────────────────────────────
function launchQuizQuestion(idx) {
    if (idx >= QUIZ_QUESTIONS.length) return;
    const q = QUIZ_QUESTIONS[idx];
    activeQuiz = { ...q, index: idx };
    quizAnswers = {};
    questionsLaunched++;

    const deadline = Date.now() + 30000;
    io.emit('quiz_question', {
        question: q.question,
        options: q.options,
        index: idx,
        deadline,
        total: QUIZ_QUESTIONS.length,
    });

    if (quizDeadlineTimeout) clearTimeout(quizDeadlineTimeout);
    quizDeadlineTimeout = setTimeout(() => {
        io.emit('quiz_timeout'); // lock client UI
        setTimeout(revealQuizResults, 500);
    }, 30000);

    logEvent('quiz', `Quiz P${idx + 1} lançada (manual)`);

    // After 5 questions show leaderboard popup to users
    if (questionsLaunched === 5) {
        setTimeout(() => io.emit('show_leaderboard_popup', buildLeaderboardData()), 33000);
    }
}

function revealQuizResults() {
    if (!activeQuiz) return;
    if (quizDeadlineTimeout) { clearTimeout(quizDeadlineTimeout); quizDeadlineTimeout = null; }

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

    io.emit('admin_leaderboard_update', buildLeaderboardData());
    activeQuiz = null; quizAnswers = {};
}

function buildLeaderboardData() {
    return Object.entries(gameState.users)
        .filter(([, u]) => u.role === 'consumer')
        .map(([id, u]) => ({
            id, name: u.name || 'Anónimo', group: u.group,
            quizScore: u.quizScore || 0,
            compliance: u.compliance || 0,
            havoc: u.havoc || 0,
            carbon: Math.round(u.carbonFootprint || 0),
        }))
        .sort((a, b) => b.quizScore - a.quizScore || b.compliance - a.compliance);
}

// ─── Ligações Socket ──────────────────────────────────────────────────────────
io.on('connection', (socket) => {
    console.log('Ligado:', socket.id);

    socket.on('register_user', (data) => {
        if (data.isAdmin) {
            syncClock(socket);
            // Send current leaderboard to admin immediately
            socket.emit('admin_leaderboard_update', buildLeaderboardData());
        } else {
            assignRoleAndGroup(socket, data.name);
        }
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
        const n = user.group;
        if (!activeDrRequests[n]) return;
        if (!activeDrRequests[n].voters) activeDrRequests[n].voters = new Set();
        if (activeDrRequests[n].voters.has(socket.id)) return;
        activeDrRequests[n].voters.add(socket.id);
        if (data.vote === 'yes') {
            activeDrRequests[n].yes++;
            user.compliance = (user.compliance || 0) + 20;
            gameState.metrics.drAccepted++;
            socket.emit('dr_accepted_confirm', user.compliance);
        } else { activeDrRequests[n].no++; }
        activeDrRequests[n].total++;
        const req = activeDrRequests[n];
        io.emit('dr_vote_update', { node: n, yes: req.yes, total: req.total, thresholdMet: req.total > 0 && (req.yes / req.total) >= 0.5 });
    });

    socket.on('p2p_offer', (data) => {
        const user = gameState.users[socket.id];
        if (!user || user.role !== 'consumer' || gameState.scenario !== 2) return;
        gameState.p2pMarket = gameState.p2pMarket.filter(o => o.sellerId !== socket.id);
        const offer = { id: `${socket.id}-${Date.now()}`, sellerId: socket.id, sellerGroup: user.group, amount: Math.max(1, Math.min(50, parseInt(data.amount) || 10)), pricePerUnit: Math.max(0.01, parseFloat(data.price) || 0.10), timestamp: Date.now() };
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
        gameState.metrics.stabilityScore = Math.max(0, gameState.metrics.stabilityScore - 8);
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
        } else { io.to(socket.id).emit('auto_balance_result', { from: null, to: null }); }
    });

    socket.on('manager_demand_response', (data) => {
        const nodes = data.group ? [parseInt(data.group)] : [1, 2, 3, 4];
        nodes.forEach(n => { activeDrRequests[n] = { yes: 0, no: 0, total: 0, voters: new Set(), resolveAt: Date.now() + 30000 }; });
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

    // ── Quiz ──────────────────────────────────────────────────────────────────
    socket.on('admin_start_quiz', (data) => {
        launchQuizQuestion(data.questionIndex % QUIZ_QUESTIONS.length);
    });

    // Quiz results are revealed automatically after the 30-second deadline — no manual reveal

    socket.on('quiz_answer', (data) => {
        if (!activeQuiz || quizAnswers[socket.id] !== undefined) return;
        quizAnswers[socket.id] = data.answer;
        const user = gameState.users[socket.id];
        const isCorrect = data.answer === activeQuiz.correct;
        if (user) {
            if (isCorrect) user.quizScore = (user.quizScore || 0) + 10;
            socket.emit('quiz_answer_result', { correct: isCorrect, newScore: user.quizScore || 0 });
        }
        const counts = {};
        activeQuiz.options.forEach((_, i) => { counts[i] = 0; });
        Object.values(quizAnswers).forEach(a => { counts[a] = (counts[a] || 0) + 1; });
        io.emit('quiz_live_votes', { counts, total: Object.keys(quizAnswers).length });
        io.emit('admin_leaderboard_update', buildLeaderboardData());
    });

    // ── Admin events ──────────────────────────────────────────────────────────
    socket.on('admin_change_scenario', (id) => {
        scenarioSnapshots[gameState.scenario] = {
            metrics: { ...gameState.metrics },
            scenario: gameState.scenario,
            name: SCENARIO_NAMES[gameState.scenario],
        };
        gameState.scenario = id;
        resetGameMetrics();
        io.emit('scenario_changed', { id, name: SCENARIO_NAMES[id] });
    });

    socket.on('admin_reset_game', () => {
        scenarioSnapshots[gameState.scenario] = {
            metrics: { ...gameState.metrics },
            scenario: gameState.scenario,
            name: SCENARIO_NAMES[gameState.scenario],
        };
        resetGameMetrics();
        io.emit('scenario_changed', { id: gameState.scenario, name: SCENARIO_NAMES[gameState.scenario] });
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
            const nodes = data.group ? [parseInt(data.group)] : [1, 2, 3, 4];
            nodes.forEach(n => { activeDrRequests[n] = { yes: 0, no: 0, total: 0, voters: new Set(), resolveAt: Date.now() + 30000 }; });
            for (const [id, user] of Object.entries(gameState.users))
                if (user.role === 'consumer' && (!data.group || user.group == data.group))
                    io.to(id).emit('demand_response_event', { duration: 30, reward: 15 });
            logEvent('dr', 'Resposta à Procura (instrutor)');

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
            // Cloud only relevant in S2 (smart grid with solar)
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
            if (gameState.scenario === 2) {
                // S2: rede inteligente COM turbinas — perde capacidade eólica
                for (let i = 1; i <= 4; i++) gameState.groups[i].capacity = Math.round(gameState.groups[i].capacity * 0.85);
                io.emit('renewable_event', { type: 'wind_drop', message: '🌬️ Queda de vento! Rede perde 15% da capacidade eólica durante 25 s.', duration: 25 });
                logEvent('renewable', '🌬️ Queda de vento (S2)');
                setTimeout(() => {
                    for (let i = 1; i <= 4; i++) gameState.groups[i].capacity = Math.round(gameState.groups[i].capacity / 0.85);
                    io.emit('renewable_event', { type: 'wind_restored', message: '🌬️ Vento restabelecido! Rede de volta ao normal.' });
                }, 25000);
            } else {
                // S1: rede tradicional SEM turbinas eólicas
                // Sinaliza incapacidade de usar recursos naturais → geradores fósseis de emergência
                const origPricing = { ...gameState.pricing };
                gameState.pricing = { ...PRICE_TIERS[2] }; // preço PONTA
                gameState.carbonIntensity = 500; // carbono fóssil de emergência
                io.emit('price_update', gameState.pricing);
                io.emit('grid_event', { type: 'wind_s1', group: null, message: '🌬️ Vento disponível mas sem turbinas — geradores fósseis de emergência ativados! CO₂ ↑↑, Custo ↑↑ durante 25 s.' });
                logEvent('renewable', '🌬️ Queda de vento — fósseis ativados (S1)');
                setTimeout(() => {
                    gameState.pricing = origPricing;
                    gameState.carbonIntensity = getCurrentCarbonIntensity();
                    io.emit('price_update', gameState.pricing);
                    io.emit('renewable_event', { type: 'wind_restored', message: '🌬️ Situação normalizada. Geradores fósseis de emergência desligados.' });
                }, 25000);
            }
        }
    });

    socket.on('manager_ask_question', (data) =>
        io.to(data.targetId).emit('incoming_question', { managerId: socket.id, question: data.question, answerExpected: data.answer }));
    socket.on('consumer_send_reply', (data) =>
        io.to(data.managerId).emit('incoming_reply', { answer: data.answer }));

    socket.on('disconnect', () => {
        gameState.p2pMarket = gameState.p2pMarket.filter(o => o.sellerId !== socket.id);
        io.emit('p2p_market_update', gameState.p2pMarket);
        delete gameState.users[socket.id];
        gameState.managers = gameState.managers.filter(id => id !== socket.id);
    });
});

// ─── Física ───────────────────────────────────────────────────────────────────
function calculateGridLoad() {
    for (let i = 1; i <= 4; i++) gameState.groups[i].currentLoad = 0;
    for (const [, u] of Object.entries(gameState.users)) {
        if (u.role !== 'consumer' || !u.powered) continue;
        let net = u.consumption;
        if (gameState.scenario === 2) {
            net -= u.production * gameState.solarModifier;
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
    gameState.metrics.stabilityScore = Math.max(0, gameState.metrics.stabilityScore - 8);
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
            if (met && !!user.appliances[s.appliance] !== (s.action === 'on')) {
                user.appliances[s.appliance] = s.action === 'on';
                changed = true;
                io.to(id).emit('schedule_triggered', { appliance: s.appliance, action: s.action, condition: s.condition });
            }
        }
        if (changed) {
            let total = 0;
            for (const [k, on] of Object.entries(user.appliances)) if (on && APPLIANCES[k]) total += APPLIANCES[k].loadValue;
            user.consumption = Math.min(100, total);
            io.to(id).emit('appliance_state', user.appliances);
            io.to(id).emit('consumption_update', user.consumption);
        }
    }
}

function assignTasks() {
    const tasks = [
        { name: '🍳 Cozinhar o Jantar', min: 60, max: 80 }, { name: '📺 Ver Televisão', min: 10, max: 30 },
        { name: '🫧 Lavar Roupa', min: 60, max: 80 }, { name: '🚗 Carregar Carro Elétrico', min: 70, max: 100 },
        { name: '💡 Ler (Só as Luzes)', min: 5, max: 15 }, { name: '❄️ Usar Ar Condicionado', min: 20, max: 45 },
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
            if (u.taskProgress >= 100) { u.compliance = (u.compliance || 0) + 10; u.currentTask = null; io.to(id).emit('task_completed', u.compliance); }
        } else if (u.taskProgress > 0) { u.taskProgress = 0; io.to(id).emit('task_progress', 0); }
    }
}

function updatePricing() {
    if (gameState.scenario !== 2) return;
    if (++pricingTick % 45 === 0) {
        const r = Math.random();
        const newTier = PRICE_TIERS[r < 0.3 ? 0 : r < 0.7 ? 1 : 2];
        if (newTier.tier !== gameState.pricing.tier) {
            gameState.pricing = { ...newTier };
            gameState.carbonIntensity = getCurrentCarbonIntensity();
            io.emit('price_update', gameState.pricing);
            logEvent('price', `Preço → ${newTier.label}`);
        }
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
    let sessionKw = 0;
    for (const [id, u] of Object.entries(gameState.users)) {
        if (u.role !== 'consumer') continue;
        const kw = (u.consumption / 100) * 3.45;
        sessionKw += Math.max(0, kw);
        const hourlyGrams = kw * ci;
        u.carbonFootprint = (u.carbonFootprint || 0) + hourlyGrams / 3600;
        io.to(id).emit('carbon_update', { intensity: ci, footprint: Math.round(u.carbonFootprint), hourlyRate: Math.round(hourlyGrams) });
    }
    gameState.metrics.totalCO2 += (sessionKw * ci) / 3600;
}

function resolveDrVotes() {
    const now = Date.now();
    for (const [n, req] of Object.entries(activeDrRequests)) {
        if (now >= req.resolveAt) {
            const success = req.total > 0 && (req.yes / req.total) >= 0.5;
            io.emit('dr_resolved', { node: parseInt(n), success, yes: req.yes, total: req.total });
            delete activeDrRequests[n];
        }
    }
}

function updateStability() {
    // Slowly recover stability when grid is running fine
    gameState.metrics.stabilityScore = Math.min(100, gameState.metrics.stabilityScore + 0.03);
}

function buildLeaderboard() {
    const data = buildLeaderboardData();
    io.emit('leaderboard_update', data);
    io.emit('admin_leaderboard_update', data);
}

function rotateManagers() {
    if (Object.keys(gameState.users).length < 2) return;
    const oldId = gameState.managers.shift();
    const consumers = Object.keys(gameState.users).filter(id => gameState.users[id].role === 'consumer');
    if (consumers.length > 0) {
        const newId = consumers[Math.floor(Math.random() * consumers.length)];
        if (gameState.users[oldId]) {
            gameState.users[oldId].role = 'consumer';
            io.to(oldId).emit('role_assigned', { role: 'consumer', group: gameState.users[oldId].group, scenario: gameState.scenario, name: gameState.users[oldId].name, scenarioName: SCENARIO_NAMES[gameState.scenario] });
        }
        gameState.users[newId].role = 'manager';
        gameState.managers.push(newId);
        io.to(newId).emit('role_assigned', { role: 'manager', group: gameState.users[newId].group, scenario: gameState.scenario, name: gameState.users[newId].name, scenarioName: SCENARIO_NAMES[gameState.scenario] });
    } else if (oldId) gameState.managers.push(oldId);
}

// ─── Ciclo principal (1 segundo) ──────────────────────────────────────────────
setInterval(() => {
    if (!isGameRunning) return;
    calculateGridLoad(); checkOutages(); checkSchedules();
    assignTasks(); checkTasks(); updatePricing();
    updateBatteries(); updateCarbonTracking();
    resolveDrVotes(); updateStability(); buildLeaderboard();

    io.emit('state_update', {
        ...gameState,
        metrics: {
            ...gameState.metrics,
            stabilityScore: Math.round(gameState.metrics.stabilityScore),
            totalCO2: Math.round(gameState.metrics.totalCO2),
        },
    });

    timerSeconds--;
    const m = Math.floor(timerSeconds / 60), s = timerSeconds % 60;
    io.emit('time_update', `${m}:${s < 10 ? '0' : ''}${s}`);

    if (timerSeconds <= 0) {
        isGameRunning = false;
        scenarioSnapshots[gameState.scenario] = { metrics: { ...gameState.metrics }, scenario: gameState.scenario, name: SCENARIO_NAMES[gameState.scenario] };
        // Final leaderboard popup for all users
        io.emit('show_leaderboard_popup', buildLeaderboardData());
        io.emit('simulation_ended', {
            metrics: gameState.metrics,
            scenario: gameState.scenario,
            timeline: eventTimeline,
            snapshots: scenarioSnapshots,
        });
    }
}, 1000);

// ─── Rotação de papéis (120 s) ────────────────────────────────────────────────
setInterval(() => {
    if (!isGameRunning) return;
    io.emit('role_swap_alert', { message: '🔄 Troca de papéis em 5 segundos!' });
    setTimeout(rotateManagers, 5000);
}, 120000);

http.listen(process.env.PORT || 3000, () => console.log(`✅ Workshop da Rede Elétrica a correr — porta 3000`));
