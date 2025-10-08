import { loadModal, showModal } from "./modal.js";

loadModal('modal-container');

let logoutTimer;

function startLogoutTimer(minutes) {
    clearTimeout(logoutTimer);
    logoutTimer = setTimeout(() => {
        showModal("登入已過期，請重新登入！", () => {
            window.location.href = "/api/auth/homepage";
        }, () => {
            window.location.href = "/api/auth/homepage";
        });
    }, minutes * 60 * 1000);
};

["click", "mousemove", "keydown"].forEach(evt => {
    document.addEventListener(evt, () => startLogoutTimer(30));
});