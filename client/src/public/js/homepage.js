document.addEventListener("DOMContentLoaded", () => {
    const roleButtons = document.querySelectorAll(".role-btn");

    roleButtons.forEach(button => {
        button.addEventListener("click", async () => {
            const login_role = button.dataset.role;

            // 切換 active 樣式
            roleButtons.forEach(btn => btn.classList.remove("active"));
            button.classList.add("active");

            console.log("選擇角色：", login_role);

            const res = await fetch("/api/auth/processing", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ login_role })
            });
            
            const data = await res.json();

            console.log(data);

            if (data.success === true) {
                window.location.href = data.redirect;
            }
        });
    });
});