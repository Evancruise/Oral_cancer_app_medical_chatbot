import { loadModal, showModal } from "./modal.js";

loadModal("modal-container");

document.addEventListener("DOMContentLoaded", async () => {

    const btnOpenDashboard = document.getElementById("btnOpenDashboard");
    const liffId = window.LIFF_ID;

    await liff.init({ liffId });

    if (!liff.isLoggedIn()) {
        liff.login();
        return;
    }

    console.log("LIFF 初始化成功");

    if (btnOpenDashboard) {
        btnOpenDashboard.addEventListener("click", async () => {
            //const token = liff.getIDToken();        // 取得 LINE Login 授權 Token
            const profile = await liff.getProfile();
            
            const user_id = profile.user_id;
            const name = profile.name;

            const resp = await fetch("/api/auth/login_line", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: name, line_user_id: user_id })
            });

            const data = await resp.json();

            if (!data.ok) {
                showModal(`取得登入 token 失敗: ${data.message}`);
                return;
            }

            liff.openWindow({
                url: data.redirect,
                external: false
            });
        });
    }
});
