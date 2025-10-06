import { loadModal, showModal } from "./modal.js";

loadModal("modal-container");
const form = document.getElementById("changepwd_form");

if (form) {
    form.addEventListener("submit", async (e) => {
        e.preventDefault();

        const formData = new FormData(form);
        const body = Object.fromEntries(formData.entries());

            const res = await fetch("/api/auth/verify_changepwd", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });

            const data = await res.json();

            if (!data.success) {
                showModal(`更改密碼失敗: ${data.message}`);
                return;
            }

            showModal("更改密碼成功！請重新登入", () => {
                window.location.href = "/api/auth/loginPage";
            }, () => {
                window.location.href = "/api/auth/loginPage";
            });
            
    });
}