// Connect to the Socket.io server
const socket = io();

// --- DOM Elements ---
// Views
const consumerView = document.getElementById('consumer-view');
const managerView = document.getElementById('manager-view');
const resultsView = document.getElementById('results-view');

// Consumer Elements
const powerStatus = document.getElementById('power-status');
const consumeSlider = document.getElementById('consume-slider');
const produceSlider = document.getElementById('produce-slider'); // Scenario 2
const callHelpBtn = document.getElementById('call-help-btn');
const myGroupSpan = document.getElementById('my-group');
const smartControls = document.getElementById('smart-controls');

// Manager Elements
const inboxList = document.getElementById('inbox-list');

// Local State Variables
let myRole = 'consumer';
let myGroup = 1;
let isPowered = true;
let currentScenario = 1;

// --- 1. Initial Setup & Role Assignment ---
socket.on('role_assigned', (data) => {
    myRole = data.role;
    myGroup = data.group;
    currentScenario = data.scenario;

    if (myRole === 'consumer') {
        consumerView.classList.remove('hidden');
        managerView.classList.add('hidden');
        myGroupSpan.innerText = myGroup;
        
        if (currentScenario === 2) {
            smartControls.classList.remove('hidden'); // Show solar panels
        } else {
            smartControls.classList.add('hidden');
        }
    } else if (myRole === 'manager') {
        consumerView.classList.add('hidden');
        managerView.classList.remove('hidden');
        // Clear inbox on role swap
        inboxList.innerHTML = ''; 
    }
});

// --- 2. Consumer Actions ---
// Send slider data to the server continuously
consumeSlider.addEventListener('input', (e) => {
    if (isPowered) {
        socket.emit('update_slider', { type: 'consume', value: e.target.value });
    } else {
        e.target.value = 0; // Force slider back if power is out
    }
});

// Scenario 2: Prosumer Solar production
produceSlider.addEventListener('input', (e) => {
    if (currentScenario === 2) {
        socket.emit('update_slider', { type: 'produce', value: e.target.value });
    }
});

// The Panic Button (Scenario 1)
callHelpBtn.addEventListener('click', () => {
    socket.emit('call_for_help', { group: myGroup });
    callHelpBtn.innerText = "Calling...";
    callHelpBtn.classList.replace('bg-red-600', 'bg-yellow-500');
    callHelpBtn.disabled = true;
});

// --- 3. Grid Events (From Server) ---

// When the grid trips this specific user
socket.on('outage_event', () => {
    if (myRole === 'consumer') {
        isPowered = false;
        powerStatus.classList.replace('bg-green-500', 'bg-red-600');
        powerStatus.innerText = "BLACKOUT";
        consumeSlider.value = 0; // Lights out
        
        // In Scenario 1, they must call for help. In Scenario 2, the smart meter does it.
        if (currentScenario === 1) {
            callHelpBtn.classList.remove('hidden');
            callHelpBtn.innerText = "CALL GRID MANAGER";
            callHelpBtn.classList.replace('bg-yellow-500', 'bg-red-600');
            callHelpBtn.disabled = false;
        }
    }
});

// When the Manager fixes the issue
socket.on('power_restored', () => {
    if (myRole === 'consumer') {
        isPowered = true;
        powerStatus.classList.replace('bg-red-600', 'bg-green-500');
        powerStatus.innerText = "POWER ON";
        callHelpBtn.classList.add('hidden');
    }
});

// --- 4. Manager Actions ---
// Receive a distress call (Scenario 1) or Smart Alert (Scenario 2)
socket.on('new_ticket', (ticketData) => {
    if (myRole === 'manager') {
        const ticket = document.createElement('div');
        ticket.className = 'bg-gray-700 p-3 mb-2 rounded border-l-4 border-red-500 flex justify-between items-center';
        
        if (currentScenario === 1) {
            ticket.innerHTML = `
                <span>Call from Node ${ticketData.group} (User ${ticketData.userId.substring(0,4)})</span>
                <button class="bg-blue-500 px-3 py-1 rounded text-sm start-chat-btn" data-id="${ticketData.userId}">Answer</button>
            `;
        } else {
             ticket.innerHTML = `
                <span>Smart Alert: Node ${ticketData.group} (Surge Detected)</span>
                <button class="bg-green-500 px-3 py-1 rounded text-sm auto-resolve-btn" data-id="${ticketData.userId}">Auto-Fix</button>
            `;
        }
        
        inboxList.appendChild(ticket);

        // Add event listener to the newly created button
        const btn = ticket.querySelector('button');
        btn.addEventListener('click', (e) => {
            const targetId = e.target.getAttribute('data-id');
            if (currentScenario === 1) {
                // Open the chat interface (Next feature to build!)
                console.log("Starting chat with", targetId);
            } else {
                // Instant fix for Smart Grid
                socket.emit('resolve_issue', { targetId: targetId });
                ticket.remove(); 
            }
        });
    }
});

// --- 5. Game State & Role Rotation Warnings ---
socket.on('role_swap_alert', (data) => {
    // You could replace this with a nice HTML banner instead of an alert
    alert(data.message); 
});

socket.on('simulation_ended', (finalMetrics) => {
    consumerView.classList.add('hidden');
    managerView.classList.add('hidden');
    resultsView.classList.remove('hidden');
    
    // Logic to draw Chart.js graph goes here using finalMetrics
    console.log("Game Over. Final Stats:", finalMetrics);
});

// --- Chat Modal Elements ---
const chatModal = document.getElementById('chat-modal');
const chatUserIdSpan = document.getElementById('chat-user-id');
const chatHistory = document.getElementById('chat-history');
const resolutionBar = document.getElementById('resolution-bar');
const restorePowerBtn = document.getElementById('restore-power-btn');
const closeChatBtn = document.getElementById('close-chat-btn');
const diagButtons = document.querySelectorAll('.diag-btn');

let currentChatTargetId = null;
let diagnosticProgress = 0;

// Modify your existing 'new_ticket' event listener to open this modal
// (Find the part where we created the "Answer" button in the previous step)
// Inside the socket.on('new_ticket', ...) block:
/*
        btn.addEventListener('click', (e) => {
            const targetId = e.target.getAttribute('data-id');
            if (currentScenario === 1) {
                openChatModal(targetId);
                ticket.remove(); // Remove ticket from inbox once answered
            }
        });
*/

// Function to reset and open the chat
function openChatModal(targetId) {
    currentChatTargetId = targetId;
    chatUserIdSpan.innerText = `User ${targetId.substring(0,4)}`;
    diagnosticProgress = 0;
    resolutionBar.style.width = '0%';
    chatHistory.innerHTML = '<div class="text-gray-400 italic">Connection established with consumer...</div>';
    
    // Reset buttons
    restorePowerBtn.disabled = true;
    restorePowerBtn.innerText = "DIAGNOSTICS INCOMPLETE";
    diagButtons.forEach(btn => {
        btn.disabled = false;
        btn.classList.remove('opacity-50', 'cursor-not-allowed');
    });

    chatModal.classList.remove('hidden');
}

// Close Chat manually (if they want to back out)
closeChatBtn.addEventListener('click', () => {
    chatModal.classList.add('hidden');
});

// Handle clicking the 4 diagnostic questions
diagButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
        const question = e.target.getAttribute('data-q');
        const answer = e.target.getAttribute('data-a');
        
        // Disable this specific button so it can't be clicked twice
        e.target.disabled = true;
        e.target.classList.add('opacity-50', 'cursor-not-allowed');

        // Add Manager's Question to chat
        chatHistory.innerHTML += `<div class="text-blue-400 mt-2"><b>You:</b> ${question}</div>`;
        chatHistory.scrollTop = chatHistory.scrollHeight; // Auto-scroll to bottom

        // Simulate a slight delay for the user's automated reply
        setTimeout(() => {
            chatHistory.innerHTML += `<div class="text-white"><b>Consumer:</b> ${answer}</div>`;
            chatHistory.scrollTop = chatHistory.scrollHeight;
            
            // Increase progress
            diagnosticProgress += 25;
            resolutionBar.style.width = `${diagnosticProgress}%`;

            // Unlock Restore Power if 100%
            if (diagnosticProgress >= 100) {
                restorePowerBtn.disabled = false;
                restorePowerBtn.innerText = "RESTORE POWER TO USER";
            }
        }, 600); // 600ms delay feels like someone quickly typing
    });
});

// Final Step: Restoring the power
restorePowerBtn.addEventListener('click', () => {
    // Tell the server we fixed it
    socket.emit('resolve_issue', { targetId: currentChatTargetId });
    
    // Close the modal
    chatModal.classList.add('hidden');
});