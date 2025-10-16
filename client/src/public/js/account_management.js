import { loadModal, showModal } from "./modal.js";
import { renderUserTable } from "./table.js";
import { renderUserPagination } from "./pagination.js";

loadModal("modal-container");
loadModal("modal-container-2");

document.addEventListener("DOMContentLoaded", () => {
    const account_form = document.getElementById("account_form");
    const add_account_form = document.getElementById("add_account_form");
    const account_setting_form = document.getElementById("account_setting_form");
    const account_setting_modal = document.getElementById("accountSettingModal");
    const system_setting_form = document.getElementById("system_setting_form");
    const system_setting_modal = document.getElementById("systemSettingModal");
    const table_wraps = document.querySelectorAll(".table-wrap");
    const toggleBtn = document.getElementById("toggle-password");
    const btn_export = document.getElementById("btn-export");
    const btn_reset = document.getElementById("btn-reset");
    const btn_restore = document.getElementById("btn-restore");
    const fileInput = document.getElementById("configFile");

    const configTag = document.getElementById("config-data");
    const token = document.getElementById("token")?.value || document.getElementById("page-token")?.innerText || null;
    
    const modal = document.getElementById("curAccountModal");
    
    let config = null;
    if (configTag) { config = JSON.parse(configTag.textContent); }
    const user_data = document.getElementById("users-data");

    if (!user_data) {
        return;
    }

    const users = JSON.parse(user_data.textContent);
    const usersArray = Array.isArray(users) ? users : Object.values(users);

    console.log("users:", users);

    const pageSize = 8;
    let currentPage = 1;

    function update(newPage = currentPage) {
        console.log(`Updating to page ${newPage}`);
        currentPage = newPage;
        renderUserTable(usersArray, pageSize, currentPage);
        renderUserPagination(usersArray, pageSize, currentPage, update);
    }

    // 初始渲染
    update(1);

    if (toggleBtn) {
        toggleBtn.addEventListener("click", (e) => {
        e.preventDefault();
        const input = document.getElementById("password-field");
        input.type = input.type === "password" ? "text" : "password";
        });
    }

    if (table_wraps) {
        table_wraps.forEach(wrap => {
            wrap.addEventListener('click', (e) => {
                const btn = e.target.closest('.modify_btn');
                if (!btn || !wrap.contains(btn)) {return;}  // 不是點到「修改」就略過

                console.log(btn.dataset);
                // 這裡就可以用 dataset（kebab 會轉 camelCase）
                const { fAccount, fName, fPassword, fUnit, fRole, fStatus, fNote } = btn.dataset;

                console.log(fAccount, fName, fPassword, fUnit, fRole, fStatus, fNote);
            
                const modal = document.getElementById("curAccountModal");

                const form = modal.querySelector("#account_form");
                form.querySelector("input[name='email']").value = fAccount || '';
                form.querySelector("input[name='name']").value = fName || '';
                form.querySelector("input[name='password']").value = fPassword || '';
                form.querySelector("input[name='unit']").value = fUnit || '';
                form.querySelector("select[name='role']").value = fRole || 'tester';
                form.querySelector("select[name='status']").value = fStatus || 'deactivated';
                form.querySelector("textarea[name='notes']").value = fNote || '';
                form.querySelector("input[name='token']").value = token || '';

                // const bsModal = new bootstrap.Modal(modal);
                // bsModal.show();
            });
        });
    }

    if (config) {
        console.log("Loaded config:", config);

        // 系統設定
        document.getElementById("expireTime").value = config.expireTime || "";
        document.getElementById("model_version").value = config.model_version || "";
        document.getElementById("threshold").value = config.threshold || "";
        document.getElementById("model_accuracy").value = config.model_accuracy || "";
        document.getElementById("update_inform").checked = !!config.update_inform;

        // 帳號設定
        // 密碼最小長度
        document.getElementById("minPasswordLength").value = config.minPasswordLength || "";

        // 複雜度要求 (select)
        document.getElementById("passwordComplexity").value = config.passwordComplexity || "low";

        // 密碼過期天數
        document.getElementById("passwordExpiryDays").value = config.passwordExpiryDays || "";

        // 帳號鎖定閾值
        document.getElementById("accountLockThreshold").value = config.accountLockThreshold || "";

        // 啟用 MFA (checkbox)
        document.getElementById("enableMFA").checked = !!config.enableMFA;

        // MFA 方法 (select)
        document.getElementById("mfaMethods").value = config.mfaMethods || "totp";

        // 啟用活動監控
        document.getElementById("enableActivityMonitoring").checked = !!config.enableActivityMonitoring;

        // 異常活動閾值
        document.getElementById("anomalyThreshold").value = config.anomalyThreshold || "";
    }

    if (account_form && modal) {

        modal.addEventListener('shown.bs.modal', () => {
            account_form.addEventListener('submit', async (e) => {
                e.preventDefault();

                const form = modal.querySelector("#account_form"); // ✅ 再取一次最新 form
                const formData = new FormData(form); // ✅ 使用 form 內的最新值
                            
                // 把觸發的按鈕補進 formData
                if (e.submitter) {
                    formData.append(e.submitter.name, e.submitter.value);
                }

                for (const [k, v] of formData.entries()) {
                    console.log(`${k}: ${v}`); // ✅ Debug: 確認資料都有帶
                }

                console.log(`formData: ${JSON.stringify(formData)}`);

                const res = await fetch('/api/auth/edit_account', {
                    method: 'POST',
                    body: formData,
                });

                const data = await res.json();

                if (!data.success) {
                    showModal(`${data.message}`);
                    return;
                }

                showModal(data.message, () => {
                    setTimeout(() => {
                        window.location.href = data.redirect; // 怎麼引入 data.name?
                    }, 1500);
                }, () => {
                    setTimeout(() => {
                        window.location.href = data.redirect; // 怎麼引入 data.name?
                    }, 1500);
                });
            });
        });
    }

    if (add_account_form) {
        add_account_form.addEventListener('submit', async (e) => {
            e.preventDefault();

            const formData = new FormData(add_account_form);

            const res = await fetch('/api/auth/new_account', {
                method: 'POST',
                body: formData,
            });

            const data = await res.json();

            if (!data.success) {
                showModal(`新增使用者失敗: ${data.message}`);
                return;
            }

            showModal("新增使用者成功", () => {
                setTimeout(() => {
                    window.location.href = data.redirect; // 怎麼引入 data.name?
                }, 1500);
            }, () => {
                setTimeout(() => {
                    window.location.href = data.redirect; // 怎麼引入 data.name?
                }, 1500);
            });
        });
    }

    if (account_setting_form) {
        account_setting_form.addEventListener("submit", async (e) => {
            e.preventDefault();

            const formData = new FormData(account_setting_form);

            // 把觸發的按鈕補進 formData
            if (e.submitter) {
                formData.append(e.submitter.name, e.submitter.value);
            }

            const res = await fetch('/api/auth/apply_account_setting', {
                method: 'POST',
                body: formData,
            });

            const data = await res.json();
            
            if (data.success) {
                showModal(data.message, () => {
                    setTimeout(() => {
                        window.location.href = data.redirect; // 怎麼引入 data.name?
                    }, 1500);
                }, () => {
                    setTimeout(() => {
                        window.location.href = data.redirect; // 怎麼引入 data.name?
                    }, 1500);
                });
            } else {
                showModal(`操作失敗: ${data.message}`);
            }
        });
    }

    if (system_setting_form) {
        system_setting_form.addEventListener("submit", async (e) => {
            e.preventDefault();

            const formData = new FormData(system_setting_form);

            // 把觸發的按鈕補進 formData
            if (e.submitter) {
                formData.append(e.submitter.name, e.submitter.value);
            }

            const res = await fetch('/api/auth/apply_system_setting', {
                method: 'POST',
                body: formData,
            });

            
            if (e.submitter.value === "save") {
                const data = await res.json();
                if (data.success) {
                    showModal(data.message, () => {
                        setTimeout(() => {
                            window.location.href = data.redirect; // 怎麼引入 data.name?
                        }, 1500);
                    }, () => {
                        setTimeout(() => {
                            window.location.href = data.redirect; // 怎麼引入 data.name?
                        }, 1500);
                    });
                } else {
                    showModal(`操作失敗: ${data.message}`);
                }
            }
        });
    }

    if (btn_export) {
        btn_export.addEventListener("click", async (e) => {
            e.preventDefault();

            const res = await fetch("/api/auth/sys_export", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
            });

            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);

            // 建立一個隱藏 <a> 觸發下載
            const a = document.createElement("a");
            a.href = url;
            a.download = "settings.json"; // 下載檔名
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);

            window.URL.revokeObjectURL(url);
        });
    }

    if (btn_reset) {
        btn_reset.addEventListener("click", async (e) => {
            e.preventDefault();

            showModal("確定要系統重設?", () => {
                return;
            }, async () => {

                const formData = new FormData(system_setting_form);
                
                const res = await fetch(`/api/auth/reset`, {
                    method: "POST",
                    body: formData,
                });

                const data = await res.json();

                if (!data.success) {
                    showModal(`${data.message}`);
                    return;
                }

                showModal(data.message, () => {
                    setTimeout(() => {
                        window.location.href = data.redirect; // 怎麼引入 data.name?
                    }, 1500);
                }, () => {
                    setTimeout(() => {
                        window.location.href = data.redirect; // 怎麼引入 data.name?
                    }, 1500);
                });
            }, "modal-container-2", "取消", "確定");
        });
    }

    if (btn_restore) {
        btn_restore.addEventListener("click", (e) => {
            e.preventDefault();
            fileInput.click(); // ✅ 點擊 button → 觸發隱藏 input[type=file]
        });

        fileInput.addEventListener("change", async () => {
            if (!fileInput.files.length) {return;}

            const formData = new FormData();
            formData.append("config", fileInput.files[0]);

            try {
                const res = await fetch("/api/auth/sys_import", {
                    method: "POST",
                    body: formData
                });

                const data = await res.json();
                if (data.success) {
                    showModal(data.message, () => {
                        setTimeout(() => {
                            window.location.href = data.redirect; // 怎麼引入 data.name?
                                }, 1500);
                    }, () => {
                        setTimeout(() => {
                            window.location.href = data.redirect; // 怎麼引入 data.name?
                        }, 1500);
                    });
                } else {
                    showModal(data.message, () => {
                        setTimeout(() => {
                            window.location.href = data.redirect; // 怎麼引入 data.name?
                                }, 1500);
                    }, () => {
                        setTimeout(() => {
                            window.location.href = data.redirect; // 怎麼引入 data.name?
                        }, 1500);
                    });
                }
            } catch (err) {
                console.error(err);
                // alert("❌ 系統錯誤，請稍後再試");
            }
        });
    }
});