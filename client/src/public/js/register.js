import { loadModal, loadingModal, showingModal, showModal, closingModal } from "./modal.js";

loadModal('modal-container');
loadingModal('modal-loading-container');

const form = document.getElementById("request_form");

console.log("form:", form);

if (form) {
    form.addEventListener("submit", async (e) => {
        e.preventDefault();

        const formData = new FormData(form);
        const body = Object.fromEntries(formData.entries());
        console.log("body:", JSON.stringify(body));

        showingModal("Loading...", () => {
            closingModal();
        });

        const res = await fetch("/api/auth/request", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });

        const data = await res.json();
        console.log(data);
        
        closingModal();

        if (!data.success) {
            showModal(`註冊失敗: ${data.message}`);
            return;
        }

        showModal("信箱寄出成功，請查收", () => {
            setTimeout(() => {
                window.location.href = data.redirect; // 怎麼引入 data.name?
            }, 1500);
        }, () => {

        });
    });
}

