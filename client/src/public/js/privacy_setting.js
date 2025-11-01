import { loadModal, showModal } from "./modal.js";

loadModal("modal-container");

document.addEventListener("DOMContentLoaded", () => {
    const saveBtn = document.getElementById("savePrivacyBtn");
    const deleteBtn = document.getElementById("deleteDataBtn");
    const form = document.getElementById("privacy_settings_form");

    // 模擬儲存設定
    if (form) {
        form.addEventListener("submit", async (e) => {
            e.preventDefault();

            const formData = new FormData(form);
            const body = Object.fromEntries(formData.entries());

            const res = await fetch("/api/auth/save_privacy_setting", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });

            const data = await res.json();

            console.log(`data: ${JSON.stringify(data)}`);

            if (data.success) {
                showModal("✅ 隱私設定已更新並儲存成功！", () => {
                    window.location.href = data.redirect;
                });
            }
        });
    }

    if (deleteBtn) {
        deleteBtn.addEventListener("click", () => {
            if (confirm("⚠️ 您確定要刪除所有個人資料與上傳影像嗎？此操作無法復原！")) {
                showModal("🗑️ 已送出資料刪除請求，系統將於 3 日內處理。");
            }
        });
    }
});