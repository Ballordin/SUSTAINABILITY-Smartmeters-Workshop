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
});

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