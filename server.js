const express = require('express');
const app = express();
const http = require('http').createServer(app);
const path = require('path');
const io = require('socket.io')(http,{
    cors: { origin:"*"}
}
);

// Serve the frontend files
app.use(express.static(__dirname));

// NEW: Forcefully serve index.html when someone visits the main URL
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// The Game State
let gameState = {
    scenario: 1, 
    users: {}, 
    managers: [], 
    groups: {
        1: { capacity: 1000, currentLoad: 0 },
        2: { capacity: 1000, currentLoad: 0 },
        3: { capacity: 1000, currentLoad: 0 },
        4: { capacity: 1000, currentLoad: 0 }
    },
    metrics: { outages: 0, callsMade: 0, issuesResolved: 0, totalPower: 0 }
};

// Simulation Timer
let timerSeconds = 600; // 10 minutes
let isGameRunning = false;

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);
    
    // 1. Register User (Player vs Admin)
    socket.on('register_user', (data) => {
        if (data.isAdmin) {
            // Give Admin the clock, but NO role and NO group
            let mins = Math.floor(timerSeconds / 60);
            let secs = timerSeconds % 60;
            socket.emit('time_update', `${mins}:${secs < 10 ? '0' : ''}${secs}`);
        } else {
            // Assign normal students their homes
            assignRoleAndGroup(socket);
        }
    });

    // 2. Listen for slider updates (Consumption AND Production)
    socket.on('update_slider', (data) => {
        let user = gameState.users[socket.id];
        if (!user) return;

        if (data.type === 'consume') {
            // Volatility math
            let change = Math.abs(user.consumption - data.value);
            user.volatility = (user.volatility + change) / 2;
            user.consumption = parseInt(data.value);
        } else if (data.type === 'produce') {
            user.production = parseInt(data.value);
        }
    });

    // 3. Scenario 1: Manual Help Calls
    socket.on('call_for_help', (data) => {
        gameState.metrics.callsMade++;
        // Route to managers
        gameState.managers.forEach(managerId => {
            io.to(managerId).emit('new_ticket', { group: data.group, userId: socket.id });
        });
    });

    // 4. Resolving Issues
    socket.on('resolve_issue', (data) => {
        const targetSocket = io.sockets.sockets.get(data.targetId);
        if (targetSocket) {
            targetSocket.emit('power_restored');
            gameState.metrics.issuesResolved++;
        }
    });

    // 5. Scenario 2: Smart Rerouting
    socket.on('reroute_power', (data) => {
        // Divert 200 capacity from safe to overloaded group
        gameState.groups[data.from].capacity -= 200;
        gameState.groups[data.to].capacity += 200;
        console.log(`Rerouted power from Node ${data.from} to Node ${data.to}`);
    });

    // 6. Admin Commands
    socket.on('admin_change_scenario', (newScenarioId) => {
        gameState.scenario = newScenarioId;
        resetGameMetrics();
        io.emit('scenario_changed', newScenarioId);
    });

    socket.on('admin_reset_game', () => {
        resetGameMetrics();
        io.emit('scenario_changed', gameState.scenario); 
    });

    socket.on('disconnect', () => {
        delete gameState.users[socket.id];
        gameState.managers = gameState.managers.filter(id => id !== socket.id);
    });

    // --- Interactive Chat Routing ---
    socket.on('manager_ask_question', (data) => {
        // Send the question to the specific consumer, and tell them who asked it
        io.to(data.targetId).emit('incoming_question', { 
            managerId: socket.id, 
            question: data.question, 
            answerExpected: data.answer 
        });
    });

    socket.on('consumer_send_reply', (data) => {
        // Route the reply back to the specific manager
        io.to(data.managerId).emit('incoming_reply', { answer: data.answer });
    });
});

// --- HELPER FUNCTIONS ---

function assignRoleAndGroup(socket) {
    const groupNum = Math.floor(Math.random() * 4) + 1;
    const role = gameState.managers.length === 0 ? 'manager' : 'consumer';
    
    if (role === 'manager') gameState.managers.push(socket.id);

    gameState.users[socket.id] = {
        role: role, group: groupNum, consumption: 0, production: 0, volatility: 0, havoc: 0
    };

    socket.emit('role_assigned', { role: role, group: groupNum, scenario: gameState.scenario });

    // NEW FIX: Instantly sync the clock for the late consumer!
    let mins = Math.floor(timerSeconds / 60);
    let secs = timerSeconds % 60;
    socket.emit('time_update', `${mins}:${secs < 10 ? '0' : ''}${secs}`);
}

function resetGameMetrics() {
    gameState.metrics = { outages: 0, callsMade: 0, issuesResolved: 0, totalPower: 0 };
    for (let i = 1; i <= 4; i++) {
        gameState.groups[i].currentLoad = 0;
        gameState.groups[i].capacity = 1000; // reset capacities
    }
    timerSeconds = 600; // Reset timer to 10 min
    isGameRunning = true;
}

// --- GAME LOOP MECHANICS ---

function assignConsumerTasks() {
    const tasks = [
        { name: "Cooking Dinner", min: 60, max: 80 },
        { name: "Watching TV", min: 10, max: 30 },
        { name: "Doing Laundry", min: 70, max: 90 },
        { name: "Charging EV", min: 80, max: 100 },
        { name: "Reading (Lights Only)", min: 5, max: 15 }
    ];

    for (const id in gameState.users) {
        let user = gameState.users[id];
        // 30% chance every few seconds to get a new task if they don't have one, and ONLY if they have power
        if (user.role === 'consumer' && !user.currentTask && user.consumption > 0 && Math.random() < 0.3) {
            user.currentTask = tasks[Math.random() * tasks.length | 0];
            user.taskProgress = 0;
            io.to(id).emit('new_task', user.currentTask);
        }
    }
}

function calculateGridLoad() {
    // Reset load counters
    for (let i = 1; i <= 4; i++) gameState.groups[i].currentLoad = 0;

    for (const id in gameState.users) {
        const user = gameState.users[id];
        if (user.role === 'consumer') {
            // Net load = Consumption - Production (if Scenario 2)
            let netLoad = user.consumption;
            if (gameState.scenario === 2) netLoad -= user.production;
            if (netLoad < 0) netLoad = 0; // Prevent negative loads
            
            // Multiply by 5 so slider impacts the 1000 capacity visibly
            let actualLoad = netLoad * 5; 
            
            gameState.groups[user.group].currentLoad += actualLoad;
            gameState.metrics.totalPower += actualLoad;
        }
    }
}

function checkOutages() {
    // 1. NEW: The "Personal Breaker" for Erratic Sliders
    for (const id in gameState.users) {
        let user = gameState.users[id];
        if (user.role === 'consumer' && user.consumption > 0) {
            // Cool down their volatility slightly every second so good behavior is rewarded
            user.volatility = user.volatility * 0.8; 

            // If they jerked the slider too fast, blow their personal fuse!
            if (user.volatility > 25) { // 25 is the threshold for erratic behavior
                io.to(id).emit('outage_event');
                user.consumption = 0;
                user.volatility = 0; // Reset their volatility after a crash
                gameState.metrics.outages++;

                // Notify manager if Scenario 2
                if (gameState.scenario === 2) {
                    gameState.managers.forEach(mgrId => {
                        io.to(mgrId).emit('new_ticket', { group: user.group, userId: id });
                    });
                }
            }
        }
    }

    // 2. EXISTING: Substation Overload Logic
    for (let i = 1; i <= 4; i++) {
        const group = gameState.groups[i];
        const loadPercentage = group.currentLoad / group.capacity;

        // Scenario 2: Proactive Alerting (90% capacity)
        if (gameState.scenario === 2 && loadPercentage > 0.90 && loadPercentage <= 1.0) {
            let safeGroup = Object.keys(gameState.groups).find(k => (gameState.groups[k].currentLoad / gameState.groups[k].capacity) < 0.6);
            if (safeGroup) {
                gameState.managers.forEach(mgrId => {
                    io.to(mgrId).emit('predictive_alert', { overloadedGroup: i, safeGroup: safeGroup });
                });
            }
        }

        // Both Scenarios: Tripping the Substation Breaker
        if (loadPercentage > 1.0) {
            let consumers = Object.keys(gameState.users).filter(id => gameState.users[id].group == i && gameState.users[id].role === 'consumer');
            
            if (consumers.length > 0) {
                // Sort by who is most volatile and trip them first
                consumers.sort((a, b) => gameState.users[b].volatility - gameState.users[a].volatility);
                let victimId = consumers[0]; 

                if (gameState.users[victimId].consumption > 0) {
                    io.to(victimId).emit('outage_event');
                    gameState.users[victimId].consumption = 0;
                    gameState.metrics.outages++;
                    // (Inside the volatility check > 25)
                    user.havoc += 10; // +10 points for blowing personal fuse
                    io.to(id).emit('update_havoc', user.havoc);

                    // ... later, inside the Substation Overload check (loadPercentage > 1.0) ...
                    gameState.users[victimId].havoc += 50; // +50 points for crashing the whole neighborhood!
                    io.to(victimId).emit('update_havoc', gameState.users[victimId].havoc);

                    if (gameState.scenario === 2) {
                        gameState.managers.forEach(mgrId => {
                            io.to(mgrId).emit('new_ticket', { group: i, userId: victimId });
                        });
                    }
                }
            }
        }
    }
}

function rotateManagers() {
    if (Object.keys(gameState.users).length < 2) return; // Need at least 2 people

    let oldManagerId = gameState.managers.shift(); 
    let consumers = Object.keys(gameState.users).filter(id => gameState.users[id].role === 'consumer');
    
    if (consumers.length > 0) {
        // Pick a random consumer to promote
        let newManagerId = consumers[Math.floor(Math.random() * consumers.length)];
        
        // Demote
        if (gameState.users[oldManagerId]) {
            gameState.users[oldManagerId].role = 'consumer';
            io.to(oldManagerId).emit('role_assigned', { role: 'consumer', group: gameState.users[oldManagerId].group, scenario: gameState.scenario });
        }

        // Promote
        gameState.users[newManagerId].role = 'manager';
        gameState.managers.push(newManagerId);
        io.to(newManagerId).emit('role_assigned', { role: 'manager', group: gameState.users[newManagerId].group, scenario: gameState.scenario });
    } else {
        if(oldManagerId) gameState.managers.push(oldManagerId); // Put them back
    }
}

// --- MASTER LOOPS ---

// Fast Loop: Physics, Math, & Consumer Tasks (Runs every 1 second)
setInterval(() => {
    if (isGameRunning) {
        // 1. Grid Math
        calculateGridLoad();
        checkOutages();
        assignConsumerTasks(); 

        // 2. Check Task Progress
        for (const id in gameState.users) {
            let user = gameState.users[id];
            if (user.role === 'consumer' && user.currentTask) {
                // Check if slider is in the target zone AND they have power
                if (user.consumption >= user.currentTask.min && user.consumption <= user.currentTask.max && user.consumption > 0) {
                    user.taskProgress += 10; // Takes 10 seconds to complete
                    io.to(id).emit('task_progress', user.taskProgress);

                    if (user.taskProgress >= 100) {
                        user.compliance += 10; // Reward them!
                        user.currentTask = null; // Clear task
                        io.to(id).emit('task_completed', user.compliance);
                    }
                } else {
                    // Penalty for dropping out of the zone
                    if (user.taskProgress > 0) {
                        user.taskProgress = 0;
                        io.to(id).emit('task_progress', 0);
                    }
                }
            }
        }

        // 3. Send state to frontend
        io.emit('state_update', gameState);

        // 4. Timer Logic
        timerSeconds--;
        let mins = Math.floor(timerSeconds / 60);
        let secs = timerSeconds % 60;
        let timeString = `${mins}:${secs < 10 ? '0' : ''}${secs}`;
        io.emit('time_update', timeString);

        if (timerSeconds <= 0) {
            isGameRunning = false;
            io.emit('simulation_ended', gameState.metrics);
        }
    }
}, 1000);

// Slow Loop: Role Rotation (Runs every 120 seconds)
setInterval(() => {
    if (isGameRunning) {
        io.emit('role_swap_alert', { message: "Roles rotating in 5 seconds!" });
        setTimeout(rotateManagers, 5000); // Actually swap 5 seconds after warning
    }
}, 120000);

// Start server
http.listen(process.env.PORT || 3000, () => console.log('Smart Grid Simulation running!'));