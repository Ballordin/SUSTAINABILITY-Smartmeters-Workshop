const powerStatus = document.getElementById('power-status');
const consumeSlider = document.getElementById('consume-slider');
const produceSlider = document.getElementById('produce-slider');
const callHelpBtn = document.getElementById('call-help-btn');
const havocScoreSpan = document.getElementById('havoc-score');

// Slider Logic with Throttling
let lastConsumeSend = 0;
let lastProduceSend = 0;
const THROTTLE_MS = 250; 

consumeSlider.addEventListener('input', (e) => {
    if (!isPowered) { e.target.value = 0; return; }
    const now = Date.now();
    if (now - lastConsumeSend > THROTTLE_MS) {
        socket.emit('update_slider', { type: 'consume', value: e.target.value });
        lastConsumeSend = now;
    }
});

consumeSlider.addEventListener('change', (e) => {
    if (isPowered) {
        socket.emit('update_slider', { type: 'consume', value: e.target.value });
        lastConsumeSend = Date.now();
    }
});

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

// Grid Outages & Restorations
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

// Consumer Tasks & Compliance
const consumerTaskBox = document.getElementById('consumer-task-box');
const taskNameSpan = document.getElementById('task-name');
const taskTargetSpan = document.getElementById('task-target');
const taskProgressBar = document.getElementById('task-progress');
const complianceScoreSpan = document.getElementById('compliance-score');

socket.on('new_task', (task) => {
    if (myRole === 'consumer') {
        consumerTaskBox.classList.remove('hidden');
        taskNameSpan.innerText = task.name;
        taskTargetSpan.innerText = `${task.min}% - ${task.max}%`;
        taskProgressBar.style.width = '0%';
    }
});

socket.on('task_progress', (progress) => {
    if (myRole === 'consumer') {
        taskProgressBar.style.width = `${progress}%`;
        if (progress > 0) taskProgressBar.classList.replace('bg-green-500', 'bg-blue-400');
        else taskProgressBar.classList.replace('bg-blue-400', 'bg-green-500');
    }
});

socket.on('task_completed', (newScore) => {
    if (myRole === 'consumer') {
        consumerTaskBox.classList.add('hidden');
        if (complianceScoreSpan) complianceScoreSpan.innerText = newScore !== undefined ? newScore : 0;
        
        const badge = complianceScoreSpan.parentElement;
        badge.classList.add('bg-green-500', 'text-white');
        setTimeout(() => badge.classList.remove('bg-green-500', 'text-white'), 500);
    }
});

// Consumer Chat 
const consumerChatModal = document.getElementById('consumer-chat-modal');
const consumerIncomingQuestion = document.getElementById('consumer-incoming-question');
const consumerReplyBtn = document.getElementById('consumer-reply-btn');
const consumerReplyText = document.getElementById('consumer-reply-text');
let currentChatManagerId = null;

socket.on('incoming_question', (data) => {
    if (myRole === 'consumer') {
        currentChatManagerId = data.managerId;
        consumerIncomingQuestion.innerText = `"${data.question}"`;
        consumerReplyText.innerText = data.answerExpected;
        consumerChatModal.classList.remove('hidden');
    }
});

consumerReplyBtn.addEventListener('click', () => {
    socket.emit('consumer_send_reply', { managerId: currentChatManagerId, answer: consumerReplyText.innerText });
    consumerChatModal.classList.add('hidden');
});