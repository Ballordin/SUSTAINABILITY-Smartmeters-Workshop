const adminPanel = document.getElementById('admin-panel');
const btnStartScen1 = document.getElementById('btn-start-scen1');
const btnStartScen2 = document.getElementById('btn-start-scen2');
const btnReset = document.getElementById('btn-reset');
const adminCurrentScenario = document.getElementById('admin-current-scenario');

// Admin Setup & Authentication
const urlParams = new URLSearchParams(window.location.search);
const isAdmin = urlParams.get('admin') === 'true';

if (isAdmin) {
    if(adminPanel) adminPanel.classList.remove('hidden');
}

// Tell the server who is connecting
socket.emit('register_user', { isAdmin: isAdmin });

// Admin Button Listeners
btnStartScen1.addEventListener('click', () => socket.emit('admin_change_scenario', 1));
btnStartScen2.addEventListener('click', () => socket.emit('admin_change_scenario', 2));
btnReset.addEventListener('click', () => {
    if(confirm("Are you sure? This will wipe the current metrics.")) socket.emit('admin_reset_game');
});

// Update Admin UI on scenario change
socket.on('scenario_changed', (newScenarioId) => {
    if (adminCurrentScenario) adminCurrentScenario.innerText = `Scenario ${newScenarioId}`;
});

// End Game Chart Logic
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
        options: { responsive: true, scales: { y: { beginAtZero: true } }, plugins: { legend: { display: false } } }
    });
});