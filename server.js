const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

// Serve the frontend files
app.use(express.static(__dirname));

// The Game State
let gameState = {
    scenario: 1, // 1 = Old, 2 = Smart
    users: {}, // Stores socket.id, role, group (1-4), volatility, consumption
    managers: [], // Array of current manager socket.ids
    groups: {
        1: { capacity: 1000, currentLoad: 0 },
        2: { capacity: 1000, currentLoad: 0 },
        3: { capacity: 1000, currentLoad: 0 },
        4: { capacity: 1000, currentLoad: 0 }
    },
    metrics: { outages: 0, callsMade: 0, issuesResolved: 0, totalPower: 0 }
};

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);
    
    // 1. Assign Role & Group
    assignRoleAndGroup(socket);

    // 2. Listen for slider updates and calculate Volatility
    socket.on('update_slider', (data) => {
        let user = gameState.users[socket.id];
        // Simple volatility math: absolute difference from last reading
        let change = Math.abs(user.consumption - data.value);
        user.volatility = (user.volatility + change) / 2; // Rolling average
        user.consumption = data.value;
    });

    socket.on('disconnect', () => {
        delete gameState.users[socket.id];
        // Re-assign managers if a manager dropped
    });

    socket.on('resolve_issue', (data) => {
        const targetSocket = io.sockets.sockets.get(data.targetId);
        
        if (targetSocket) {
            // Tell the specific consumer their power is back!
            targetSocket.emit('power_restored');
            
            // Log it for the post-game discussion
            gameState.metrics.issuesResolved++;
        }
    });
    // --- Admin Commands ---
    socket.on('admin_change_scenario', (newScenarioId) => {
        console.log(`Instructor changed scenario to ${newScenarioId}`);
        gameState.scenario = newScenarioId;
        
        // Reset the metrics for the new round
        gameState.metrics = { outages: 0, callsMade: 0, issuesResolved: 0, totalPower: 0 };
        
        // Tell everyone in the class that the scenario changed
        io.emit('scenario_changed', newScenarioId);
    });

    socket.on('admin_reset_game', () => {
        // Reset metrics and group loads
        gameState.metrics = { outages: 0, callsMade: 0, issuesResolved: 0, totalPower: 0 };
        for (let i = 1; i <= 4; i++) {
            gameState.groups[i].currentLoad = 0;
        }
        io.emit('scenario_changed', gameState.scenario); // Triggers UI reset on clients
    });
});

// The missing Role Assignment Function!
function assignRoleAndGroup(socket) {
    // 1. Assign them to Group 1, 2, 3, or 4 randomly
    const groupNum = Math.floor(Math.random() * 4) + 1;
    
    // 2. Assign Role (First person to connect is Manager, rest are Consumers)
    // If you have more than 20 people, you can change this logic later
    const role = gameState.managers.length === 0 ? 'manager' : 'consumer';
    
    if (role === 'manager') {
        gameState.managers.push(socket.id);
    }

    // 3. Save to server memory
    gameState.users[socket.id] = {
        role: role,
        group: groupNum,
        consumption: 0,
        volatility: 0
    };

    // 4. Send the data back to the client's screen
    socket.emit('role_assigned', {
        role: role,
        group: groupNum,
        scenario: gameState.scenario
    });
}

// The Game Loop (Runs every second)
setInterval(() => {
    calculateGridLoad();
    checkOutages();
    io.emit('state_update', gameState); // Send fresh data to everyone
}, 1000);

// Role Rotation Timer (Every 90 seconds)
setInterval(() => {
    rotateManagers();
    io.emit('role_swap_alert', { message: "Roles rotating in 5 seconds!" });
}, 90000);

http.listen(3000, () => console.log('Grid Server running on port 3000'));

