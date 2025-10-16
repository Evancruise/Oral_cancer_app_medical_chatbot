// /js/sidebar.js
document.addEventListener("DOMContentLoaded", () => {
    const sidebar = document.querySelector(".sidebar");
    const main = document.querySelector("main");
    const toggleBtn = document.getElementById("sidebarToggle");

    if (sidebar && main && toggleBtn) {
        toggleBtn.addEventListener("click", () => {
            sidebar.classList.toggle("hidden");
            main.classList.toggle("expanded");
        });
    } else {
        console.error("❌ 找不到 sidebar 或 toggleBtn");
    }
});
