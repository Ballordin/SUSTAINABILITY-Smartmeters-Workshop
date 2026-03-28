// Global Socket Connection
const socket = io();

// Global State Variables (Accessible by all other files)
let myRole = 'consumer';
let myGroup = 1;
let currentScenario = 1;
let isPowered = true;

// Shared DOM Elements
const consumerView = document.getElementById('consumer-view');
const managerView = document.getElementById('manager-view');
const resultsView = document.getElementById('results-view');
const scenarioTitle = document.getElementById('scenario-title');
const timerDisplay = document.getElementById('timer');
const myGroupSpan = document.getElementById('my-group');
const smartControls = document.getElementById('smart-controls');

// Initial Setup & Role Assignment
socket.on('role_assigned', (data) => {
    myRole = data.role;
    myGroup = data.group;
    currentScenario = data.scenario;

    if (myRole === 'consumer') {
        consumerView.classList.remove('hidden');
        managerView.classList.add('hidden');
        myGroupSpan.innerText = myGroup;
        
        if (currentScenario === 2) smartControls.classList.remove('hidden');
        else smartControls.classList.add('hidden');
    } else if (myRole === 'manager') {
        consumerView.classList.add('hidden');
        managerView.classList.remove('hidden');
        document.getElementById('inbox-list').innerHTML = ''; 
    }
});

// Shared Scenario Change Logic
socket.on('scenario_changed', (newScenarioId) => {
    currentScenario = newScenarioId;
    scenarioTitle.innerText = `Scenario ${newScenarioId}: ${newScenarioId === 1 ? 'Legacy Grid' : 'Smart Grid'}`;
    
    if (myRole === 'consumer') {
        if (newScenarioId === 2) smartControls.classList.remove('hidden');
        else smartControls.classList.add('hidden');
    }
    
    resultsView.classList.add('hidden');
    if (myRole === 'consumer') consumerView.classList.remove('hidden');
    if (myRole === 'manager') managerView.classList.remove('hidden');
});

// Shared Time & Alert Logic
socket.on('time_update', (timeString) => {
    if(timerDisplay) timerDisplay.innerText = `Time Remaining: ${timeString}`;
});

socket.on('role_swap_alert', (data) => alert(data.message));