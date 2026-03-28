const inboxList = document.getElementById('inbox-list');
const predictiveRoutingPanel = document.getElementById('predictive-routing-panel');
const routingSuggestions = document.getElementById('routing-suggestions');

// Manager UI Updates
socket.on('state_update', (state) => {
    if (myRole === 'manager') {
        for (let i = 1; i <= 4; i++) {
            const bar = document.getElementById(`load-bar-${i}`);
            if (bar && state.groups[i]) {
                let percentage = (state.groups[i].currentLoad / state.groups[i].capacity) * 100;
                if (percentage > 100) percentage = 100; 
                
                bar.style.width = `${percentage}%`;
                if (percentage > 90) bar.className = "bg-red-600 h-6 rounded transition-all duration-300";
                else if (percentage > 75) bar.className = "bg-yellow-500 h-6 rounded transition-all duration-300";
                else bar.className = "bg-blue-500 h-6 rounded transition-all duration-300";
            }
        }
    }
});

// Ticketing System
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

        ticket.querySelector('button').addEventListener('click', (e) => {
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

// Predictive Routing (Scenario 2)
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
            socket.emit('reroute_power', { from: e.target.getAttribute('data-from'), to: e.target.getAttribute('data-to') });
            suggestion.remove();
            if (routingSuggestions.children.length === 0) predictiveRoutingPanel.classList.add('hidden');
        });
    }
});

// Manager Chat Logic
const chatModal = document.getElementById('chat-modal');
const chatUserIdSpan = document.getElementById('chat-user-id');
const chatHistory = document.getElementById('chat-history');
const resolutionBar = document.getElementById('resolution-bar');
const restorePowerBtn = document.getElementById('restore-power-btn');
const closeChatBtn = document.getElementById('close-chat-btn');
const diagButtons = document.querySelectorAll('.diag-btn');

let currentChatTargetId = null;
let diagnosticProgress = 0;
let isWaitingForReply = false;
let chatTimeout;

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

closeChatBtn.addEventListener('click', () => chatModal.classList.add('hidden'));

socket.on('incoming_reply', (data) => {
    if (myRole === 'manager') {
        isWaitingForReply = false;
        clearTimeout(chatTimeout);

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

diagButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
        if (isWaitingForReply) return;

        const targetBtn = e.currentTarget;
        const question = targetBtn.getAttribute('data-q');
        const answer = targetBtn.getAttribute('data-a');
        
        targetBtn.disabled = true;
        targetBtn.classList.add('opacity-50', 'cursor-not-allowed');

        chatHistory.innerHTML += `<div class="text-blue-400 mt-2"><b>You:</b> ${question}</div>`;
        chatHistory.scrollTop = chatHistory.scrollHeight; 

        isWaitingForReply = true;

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

        socket.emit('manager_ask_question', { targetId: currentChatTargetId, question: question, answer: answer });
    });
});

restorePowerBtn.addEventListener('click', () => {
    socket.emit('resolve_issue', { targetId: currentChatTargetId });
    chatModal.classList.add('hidden');
});