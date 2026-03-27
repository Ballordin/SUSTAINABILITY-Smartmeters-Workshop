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
const produceSlider = document.getElementById('produce-slider');
const callHelpBtn = document.getElementById('call-help-btn');
const myGroupSpan = document.getElementById('my-group');
const smartControls = document.getElementById('smart-controls');
const havocScoreSpan = document.getElementById('havoc-score');

// Manager Elements
const inboxList = document.getElementById('inbox-list');
const predictiveRoutingPanel = document.getElementById('predictive-routing-panel');
const routingSuggestions = document.getElementById('routing-suggestions');

// Admin & Header Elements
const adminPanel = document.getElementById('admin-panel');
const btnStartScen1 = document.getElementById('btn-start-scen1');
const btnStartScen2 = document.getElementById('btn-start-scen2');
const btnReset = document.getElementById('btn-reset');
const adminCurrentScenario = document.getElementById('admin-current-scenario');
const scenarioTitle = document.getElementById('scenario-title');
const timerDisplay = document.getElementById('timer');

// Chat Modal Elements (Manager)
const chatModal = document.getElementById('chat-modal');
const chatUserIdSpan = document.getElementById('chat-user-id');
const chatHistory = document.getElementById('chat-history');
const resolutionBar = document.getElementById('resolution-bar');
const restorePowerBtn = document.getElementById('restore-power-btn');
const closeChatBtn = document.getElementById('close-chat-btn');
const diagButtons = document.querySelectorAll('.diag-btn');

// Chat Modal Elements (Consumer)
const consumerChatModal = document.getElementById('consumer-chat-modal');
const consumerIncomingQuestion = document.getElementById('consumer-incoming-question');
const consumerReplyBtn = document.getElementById('consumer-reply-btn');
const consumerReplyText = document.getElementById('consumer-reply-text');

// Local State Variables
let myRole = 'consumer';
let myGroup = 1;
let isPowered = true;
let currentScenario = 1;
let currentChatTargetId = null;
let currentChatManagerId = null;
let diagnosticProgress = 0;

// --- 1. Admin Unlock Logic ---
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get('admin') === 'true') {
    if(adminPanel) adminPanel.classList.remove('hidden');
}

// --- 2. Initial Setup & Role Assignment ---
socket.on('role_assigned', (data) => {
    myRole = data.role;
    myGroup = data.group;
    currentScenario = data.scenario;

    if (myRole === 'consumer') {
        consumerView.classList.remove('hidden');
        managerView.classList.add('hidden');
        myGroupSpan.innerText = myGroup;
        
        if (currentScenario === 2) {
            smartControls.classList.remove('hidden');
        } else {
            smartControls.classList.add('hidden');
        }
    } else if (myRole === 'manager') {
        consumerView.classList.add('hidden');
        managerView.classList.remove('hidden');
        inboxList.innerHTML = ''; 
    }
});

// --- 3. Consumer Actions ---
let lastConsumeSend = 0;
let lastProduceSend = 0;
const THROTTLE_MS = 250; // Only send data 4 times a second max

// Consume Slider (Continuous dragging)
consumeSlider.addEventListener('input', (e) => {
    if (!isPowered) {
        e.target.value = 0;
        return;
    }
    
    const now = Date.now();
    if (now - lastConsumeSend > THROTTLE_MS) {
        socket.emit('update_slider', { type: 'consume', value: e.target.value });
        lastConsumeSend = now;
    }
});

// Guarantee the absolute final resting value is sent when they let go of the mouse/screen
consumeSlider.addEventListener('change', (e) => {
    if (isPowered) {
        socket.emit('update_slider', { type: 'consume', value: e.target.value });
        lastConsumeSend = Date.now();
    }
});

// Produce Slider (Scenario 2)
produceSlider.addEventListener('input', (e) => {
    if (currentScenario !== 2) return;
    
    const now = Date.now();
    if (now - lastProduceSend > THROTTLE_MS) {
        socket.emit('update_slider', { type: 'produce', value: e.target.value });
        lastProduceSend = now;
    }
});

produceSlider.addEventListener('change', (e) => {
    if (currentScenario === 2) {
        socket.emit('update_slider', { type: 'produce', value: e.target.value });
        lastProduceSend = Date.now();
    }
});

callHelpBtn.addEventListener('click', () => {
    socket.emit('call_for_help', { group: myGroup });
    callHelpBtn.innerText = "Calling...";
    callHelpBtn.classList.replace('bg-red-600', 'bg-yellow-500');
    callHelpBtn.disabled = true;
});

// --- 4. Grid Events (From Server) ---
socket.on('outage_event', () => {
    if (myRole === 'consumer') {
        isPowered = false;
        powerStatus.classList.replace('bg-green-500', 'bg-red-600');
        powerStatus.innerText = "BLACKOUT";
        consumeSlider.value = 0;
        
        if (currentScenario === 1) {
            callHelpBtn.classList.remove('hidden');
            callHelpBtn.innerText = "CALL GRID MANAGER";
            callHelpBtn.classList.replace('bg-yellow-500', 'bg-red-600');
            callHelpBtn.disabled = false;
        }
    }
});

socket.on('power_restored', () => {
    if (myRole === 'consumer') {
        isPowered = true;
        powerStatus.classList.replace('bg-red-600', 'bg-green-500');
        powerStatus.innerText = "POWER ON";
        callHelpBtn.classList.add('hidden');
    }
});

socket.on('update_havoc', (score) => {
    if (havocScoreSpan) havocScoreSpan.innerText = score;
});

// --- 5. Manager Actions ---
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

        const btn = ticket.querySelector('button');
        btn.addEventListener('click', (e) => {
            const targetId = e.target.getAttribute('data-id');
            if (currentScenario === 1) {
                openChatModal(targetId);
                ticket.remove(); 
            } else {
                socket.emit('resolve_issue', { targetId: targetId });
                ticket.remove(); 
            }
        });
    }
});

// Predictive Alerts (Smart Grid)
socket.on('predictive_alert', (data) => {
    if (myRole === 'manager' && currentScenario === 2) {
        predictiveRoutingPanel.classList.remove('hidden');
        
        const suggestion = document.createElement('div');
        suggestion.className = 'bg-gray-700 p-3 rounded flex justify-between items-center';
        suggestion.innerHTML = `
            <span><b>Node ${data.overloadedGroup}</b> is at 90% capacity. Node ${data.safeGroup} has excess. Reroute 15% power?</span>
            <button class="bg-yellow-500 hover:bg-yellow-400 text-black font-bold px-4 py-2 rounded reroute-btn" 
                    data-from="${data.safeGroup}" data-to="${data.overloadedGroup}">
                Execute Reroute
            </button>
        `;
        
        routingSuggestions.appendChild(suggestion);

        suggestion.querySelector('.reroute-btn').addEventListener('click', (e) => {
            const fromGroup = e.target.getAttribute('data-from');
            const toGroup = e.target.getAttribute('data-to');
            socket.emit('reroute_power', { from: fromGroup, to: toGroup });
            suggestion.remove();
            if (routingSuggestions.children.length === 0) {
                predictiveRoutingPanel.classList.add('hidden');
            }
        });
    }
});

/// --- 6. Chat Modal Logic (Manager) ---
let isWaitingForReply = false;
let chatTimeout; // Failsafe if consumer ignores them

function openChatModal(targetId) {
    currentChatTargetId = targetId;
    chatUserIdSpan.innerText = `User ${targetId.substring(0,4)}`;
    diagnosticProgress = 0;
    isWaitingForReply = false; 
    clearTimeout(chatTimeout);
    
    resolutionBar.style.width = '0%';
    chatHistory.innerHTML = '<div class="text-gray-400 italic">Connection established with consumer...</div>';
    
    restorePowerBtn.disabled = true;
    restorePowerBtn.innerText = "DIAGNOSTICS INCOMPLETE";
    diagButtons.forEach(btn => {
        btn.disabled = false;
        btn.classList.remove('opacity-50', 'cursor-not-allowed');
    });

    chatModal.classList.remove('hidden');
}

closeChatBtn.addEventListener('click', () => {
    chatModal.classList.add('hidden');
});

// Manager receives the reply from the consumer
socket.on('incoming_reply', (data) => {
    if (myRole === 'manager') {
        isWaitingForReply = false; // UNLOCK!
        clearTimeout(chatTimeout); // Clear the failsafe

        chatHistory.innerHTML += `<div class="text-white"><b>Consumer:</b> ${data.answer}</div>`;
        chatHistory.scrollTop = chatHistory.scrollHeight;
        
        diagnosticProgress += 25;
        resolutionBar.style.width = `${diagnosticProgress}%`;

        if (diagnosticProgress >= 100) {
            restorePowerBtn.disabled = false;
            restorePowerBtn.innerText = "RESTORE POWER TO USER";
        }
    }
});

// Manager asks a question
diagButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
        if (isWaitingForReply) return; // Prevent speed-clicking!

        const targetBtn = e.currentTarget;
        const question = targetBtn.getAttribute('data-q');
        const answer = targetBtn.getAttribute('data-a');
        
        targetBtn.disabled = true;
        targetBtn.classList.add('opacity-50', 'cursor-not-allowed');

        chatHistory.innerHTML += `<div class="text-blue-400 mt-2"><b>You:</b> ${question}</div>`;
        chatHistory.scrollTop = chatHistory.scrollHeight; 

        isWaitingForReply = true; // LOCK!

        // 10-Second Failsafe (If consumer ignores the chat)
        chatTimeout = setTimeout(() => {
            if (isWaitingForReply) {
                isWaitingForReply = false;
                chatHistory.innerHTML += `<div class="text-gray-500 italic"><b>System:</b> Consumer unresponsive. Auto-diagnosing...</div>`;
                chatHistory.scrollTop = chatHistory.scrollHeight;
                
                diagnosticProgress += 25;
                resolutionBar.style.width = `${diagnosticProgress}%`;
                if (diagnosticProgress >= 100) {
                    restorePowerBtn.disabled = false;
                    restorePowerBtn.innerText = "RESTORE POWER TO USER";
                }
            }
        }, 10000);

        socket.emit('manager_ask_question', { 
            targetId: currentChatTargetId, 
            question: question, 
            answer: answer 
        });
    });
});

restorePowerBtn.addEventListener('click', () => {
    socket.emit('resolve_issue', { targetId: currentChatTargetId });
    chatModal.classList.add('hidden');
});

// --- 7. Chat Modal Logic (Consumer) ---
socket.on('incoming_question', (data) => {
    if (myRole === 'consumer') {
        currentChatManagerId = data.managerId;
        consumerIncomingQuestion.innerText = `"${data.question}"`;
        consumerReplyText.innerText = data.answerExpected;
        
        consumerChatModal.classList.remove('hidden');
    }
});

consumerReplyBtn.addEventListener('click', () => {
    socket.emit('consumer_send_reply', { 
        managerId: currentChatManagerId, 
        answer: consumerReplyText.innerText 
    });
    
    consumerChatModal.classList.add('hidden');
});

// --- 8. Admin Commands & State Management ---
btnStartScen1.addEventListener('click', () => socket.emit('admin_change_scenario', 1));
btnStartScen2.addEventListener('click', () => socket.emit('admin_change_scenario', 2));
btnReset.addEventListener('click', () => {
    if(confirm("Are you sure? This will wipe the current metrics.")) {
        socket.emit('admin_reset_game');
    }
});

socket.on('scenario_changed', (newScenarioId) => {
    currentScenario = newScenarioId;
    scenarioTitle.innerText = `Scenario ${newScenarioId}: ${newScenarioId === 1 ? 'Legacy Grid' : 'Smart Grid'}`;
    adminCurrentScenario.innerText = `Scenario ${newScenarioId}`;
    
    if (myRole === 'consumer') {
        if (newScenarioId === 2) smartControls.classList.remove('hidden');
        else smartControls.classList.add('hidden');
    }
    
    resultsView.classList.add('hidden');
    if (myRole === 'consumer') consumerView.classList.remove('hidden');
    if (myRole === 'manager') managerView.classList.remove('hidden');
});

// --- 9. UI Updates (Bars & Clock & Results) ---
socket.on('state_update', (state) => {
    if (myRole === 'manager') {
        for (let i = 1; i <= 4; i++) {
            const bar = document.getElementById(`load-bar-${i}`);
            if (bar && state.groups[i]) {
                let percentage = (state.groups[i].currentLoad / state.groups[i].capacity) * 100;
                if (percentage > 100) percentage = 100; 
                
                bar.style.width = `${percentage}%`;

                if (percentage > 90) bar.className = "bg-red-600 h-4 rounded transition-all";
                else if (percentage > 75) bar.className = "bg-yellow-500 h-4 rounded transition-all";
                else bar.className = "bg-blue-500 h-4 rounded transition-all";
            }
        }
    }
});

socket.on('time_update', (timeString) => {
    if(timerDisplay) timerDisplay.innerText = `Time Remaining: ${timeString}`;
});

socket.on('role_swap_alert', (data) => {
    alert(data.message); 
});

socket.on('simulation_ended', (finalMetrics) => {
    consumerView.classList.add('hidden');
    managerView.classList.add('hidden');
    resultsView.classList.remove('hidden');

    const ctx = document.getElementById('resultsChart').getContext('2d');
    new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['Total Outages', 'Distress Calls Made', 'Issues Resolved', 'Grid Strain (Megawatts)'],
            datasets: [{
                label: `Scenario ${currentScenario} Results`,
                data: [finalMetrics.outages, finalMetrics.callsMade, finalMetrics.issuesResolved, finalMetrics.totalPower / 1000],
                backgroundColor: ['rgba(239, 68, 68, 0.7)', 'rgba(245, 158, 11, 0.7)', 'rgba(16, 185, 129, 0.7)', 'rgba(59, 130, 246, 0.7)'],
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            scales: { y: { beginAtZero: true } },
            plugins: { legend: { display: false } }
        }
    });
});

// --- 10. Consumer Goals & Tasks ---
const consumerTaskBox = document.getElementById('consumer-task-box');
const taskNameSpan = document.getElementById('task-name');
const taskTargetSpan = document.getElementById('task-target');
const taskProgressBar = document.getElementById('task-progress');
const complianceScoreSpan = document.getElementById('compliance-score');

// When the server gives this specific consumer a new task
socket.on('new_task', (task) => {
    if (myRole === 'consumer') {
        // Unhide the task box and populate the text
        consumerTaskBox.classList.remove('hidden');
        taskNameSpan.innerText = task.name;
        taskTargetSpan.innerText = `${task.min}% - ${task.max}%`;
        taskProgressBar.style.width = '0%';
    }
});

// Animate the progress bar as they hold the slider in the correct zone
socket.on('task_progress', (progress) => {
    if (myRole === 'consumer') {
        taskProgressBar.style.width = `${progress}%`;
        
        // Change color dynamically based on progress
        if (progress > 0) {
            taskProgressBar.classList.replace('bg-green-500', 'bg-blue-400');
        } else {
            taskProgressBar.classList.replace('bg-blue-400', 'bg-green-500');
        }
    }
});

// When they successfully hold it for 10 seconds
socket.on('task_completed', (newScore) => {
    if (myRole === 'consumer') {
        // Hide the box until the server gives them a new one
        consumerTaskBox.classList.add('hidden');
        
        // Update their score
        if (complianceScoreSpan) complianceScoreSpan.innerText = newScore;
        
        // Add a quick flash animation to the badge so they know they got points!
        const badge = complianceScoreSpan.parentElement;
        badge.classList.add('bg-green-500', 'text-white');
        setTimeout(() => {
            badge.classList.remove('bg-green-500', 'text-white');
        }, 500);
    }
});