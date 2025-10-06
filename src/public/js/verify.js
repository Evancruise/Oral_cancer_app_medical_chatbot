import { loadModal, showModal } from "./modal.js";

loadModal('modal-container');

const form = document.getElementById("verify_form");
const resend_form = document.getElementById("resend_form");

console.log("form:", form);

if (form) {
    form.addEventListener("submit", async (e) => {
        e.preventDefault();

        const formData = new FormData(form);
        const body = Object.fromEntries(formData.entries());
        console.log("body:", JSON.stringify(body));

        try {
            const res = await fetch("/api/auth/verify_register", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });

            const data = await res.json();
            console.log(data);
        
            if (!data.success) {
                showModal(`驗證失敗: ${data.message}`);
                return;
            }

            showModal("驗證信箱成功，請重新設定密碼", () => {
                setTimeout(() => {
                    window.location.href = data.redirect;
                }, 1500);
            }, () => {
                setTimeout(() => {
                    window.location.href = data.redirect;
                }, 1500);
            });
        } catch (err) {
            console.error(err);
            showModal("系統錯誤，請稍後再試");
        }
    });
}

if (resend_form) {
    resend_form.addEventListener("submit", async (e) => {
        e.preventDefault();
        
        const formData = new FormData(resend_form);
        const body = Object.fromEntries(formData.entries());
        console.log("body:", JSON.stringify(body));

        const res = await fetch("/api/auth/resend", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
        });
        
        const data = await res.json();
        console.log(data);

        if (!data.success) {
            showModal(`驗證失敗: ${data.message}`);
            return;
        }

        showModal("驗證信箱成功，請重新設定密碼", () => {
            setTimeout(() => {
                window.location.href = data.redirect;
            }, 1500);
        }, () => {
            setTimeout(() => {
                window.location.href = data.redirect;
            }, 1500);
        });
    });
}

