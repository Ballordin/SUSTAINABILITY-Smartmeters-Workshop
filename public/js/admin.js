// ─── Admin auth ───────────────────────────────────────────────────────────────
const urlParams  = new URLSearchParams(window.location.search);
const isAdmin    = urlParams.get('admin') === 'true';
const adminPanel = document.getElementById('admin-panel');

if (isAdmin && adminPanel) adminPanel.classList.remove('hidden');

// Tell server who we are
socket.emit('register_user', { isAdmin });

// ─── Scenario buttons ─────────────────────────────────────────────────────────
const btnScen1 = document.getElementById('btn-start-scen1');
const btnScen2 = document.getElementById('btn-start-scen2');
const btnReset = document.getElementById('btn-reset');
const adminCurrentScenario = document.getElementById('admin-current-scenario');

btnScen1.addEventListener('click', () => socket.emit('admin_change_scenario', 1));
btnScen2.addEventListener('click', () => socket.emit('admin_change_scenario', 2));

btnReset.addEventListener('click', () => {
    if (confirm('Reset all metrics and restart the timer?')) {
        socket.emit('admin_reset_game');
    }
});

// Keep admin label in sync
socket.on('scenario_changed', (id) => {
    if (!adminCurrentScenario) return;
    adminCurrentScenario.textContent = id === 1
        ? 'Scenario 1 — Legacy Grid'
        : 'Scenario 2 — Smart Grid';
});

// ─── Event injection ──────────────────────────────────────────────────────────
const groupSelect   = document.getElementById('admin-group-select');
const btnSurge      = document.getElementById('btn-inject-surge');
const btnDR         = document.getElementById('btn-inject-dr');
const btnPrice      = document.getElementById('btn-inject-price');

function selectedGroup() {
    const v = groupSelect ? groupSelect.value : '';
    return v ? parseInt(v) : null;
}

btnSurge.addEventListener('click', () => {
    const g = selectedGroup();
    socket.emit('admin_inject_event', { type: 'surge', group: g });
    showToast(`⚡ Surge injected${g ? ` on Node ${g}` : ' (random node)'}`, 'warning');
});

btnDR.addEventListener('click', () => {
    socket.emit('admin_inject_event', { type: 'demand_response' });
    showToast('📡 Demand response broadcast sent to all consumers', 'info');
});

btnPrice.addEventListener('click', () => {
    socket.emit('admin_inject_event', { type: 'price_spike' });
    showToast('💰 Price spike triggered! (30 s)', 'warning');
});

// ─── End-game results chart ───────────────────────────────────────────────────
socket.on('simulation_ended', (finalMetrics) => {
    if (consumerView) consumerView.classList.add('hidden');
    if (managerView)  managerView.classList.add('hidden');
    resultsView.classList.remove('hidden');

    const resultsScenario = document.getElementById('results-scenario');
    if (resultsScenario) resultsScenario.textContent = currentScenario;

    const ctx = document.getElementById('resultsChart');
    if (!ctx) return;

    // Destroy previous chart instance if one exists
    if (window.__resultsChart) window.__resultsChart.destroy();

    window.__resultsChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: [
                'Total Outages',
                'Help Calls Made',
                'Issues Resolved',
                'DR Accepted',
                'Grid Strain (MW)',
            ],
            datasets: [{
                label: `Scenario ${currentScenario} Results`,
                data: [
                    finalMetrics.outages,
                    finalMetrics.callsMade,
                    finalMetrics.issuesResolved,
                    finalMetrics.drAccepted || 0,
                    Math.round(finalMetrics.totalPower / 1000),
                ],
                backgroundColor: [
                    'rgba(239, 68,  68,  0.75)',
                    'rgba(245, 158, 11,  0.75)',
                    'rgba(34,  197, 94,  0.75)',
                    'rgba(59,  130, 246, 0.75)',
                    'rgba(168, 85,  247, 0.75)',
                ],
                borderColor: [
                    'rgba(239, 68,  68,  1)',
                    'rgba(245, 158, 11,  1)',
                    'rgba(34,  197, 94,  1)',
                    'rgba(59,  130, 246, 1)',
                    'rgba(168, 85,  247, 1)',
                ],
                borderWidth: 1,
                borderRadius: 6,
            }],
        },
        options: {
            responsive: true,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#111827',
                    borderColor: '#374151',
                    borderWidth: 1,
                    titleColor: '#9ca3af',
                    bodyColor: '#f9fafb',
                },
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: { color: '#6b7280' },
                },
                x: {
                    grid: { display: false },
                    ticks: { color: '#9ca3af', font: { weight: 'bold' } },
                },
            },
        },
    });
});
