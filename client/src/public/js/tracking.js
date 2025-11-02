import { loadModal, loadingModal, showModal, showingModal, closingModal } from "./modal.js";

loadModal('modal-container');
loadingModal('modal-loading-container');

document.addEventListener("DOMContentLoaded", () => {

    const chart = document.getElementById('riskTrendChart');

    if (chart) {
        const ctx = chart.getContext('2d');
        new chart(ctx, {
            type: 'line',
            data: {
                labels: ['8/05', '8/19', '9/02', '9/16', '9/30', '10/14'],
                datasets: [{
                label: 'AI 平均風險分數',
                data: [0.42, 0.47, 0.55, 0.61, 0.68, 0.74],
                borderColor: '#f87171',
                backgroundColor: 'rgba(248,113,113,0.2)',
                tension: 0.3,
                fill: true,
                pointRadius: 4
                }]
            },
            options: {
                scales: { y: { min: 0, max: 1, ticks: { stepSize: 0.2 } } },
                plugins: { legend: { display: false } }
            }
        });
    }
});