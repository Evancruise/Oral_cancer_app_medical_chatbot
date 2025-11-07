import { loadModal, loadingModal, showModal, showingModal, closingModal } from "./modal.js";

loadModal("modal-container");
loadModal("modal-container-2");
loadingModal('modal-loading-container');

document.addEventListener("DOMContentLoaded", () => {
    const account_setting_form = document.getElementById("account_setting_form");
    const system_setting_form = document.getElementById("system_setting_form");
    
    //const saveAccBtn = account_setting_form.querySelector("button[name='action'][value='save']");
    //const btn_acc_reset = account_setting_form.querySelector("#reset");

    // const saveSysBtn = system_setting_form.querySelector("button[name='action'][value='save']");
    const btn_sys_reset = system_setting_form?.querySelector("#reset");

    const fileInput = document.getElementById("configFile");
    const configTag = document.getElementById("config-data");

    const btn_restore = document.getElementById("btn-restore");

    let config = null;
    if (configTag) { config = JSON.parse(configTag.textContent); }

    if (config) {
        console.log("Loaded config:", config);
        document.getElementById("expireTime").value = config.expireTime || "";
        document.getElementById("model_version").value = config.model_version || "";
        document.getElementById("threshold").value = config.threshold || "";
        document.getElementById("model_accuracy").value = config.model_accuracy || "";
        document.getElementById("update_inform").checked = !!config.update_inform;
        document.getElementById("minPasswordLength").value = config.minPasswordLength || "";
        document.getElementById("passwordComplexity").value = config.passwordComplexity || "low";
        document.getElementById("passwordExpiryDays").value = config.passwordExpiryDays || "";
        document.getElementById("accountLockThreshold").value = config.accountLockThreshold || "";
        document.getElementById("enableMFA").checked = !!config.enableMFA;
        document.getElementById("mfaMethods").value = config.mfaMethods || "totp";
        document.getElementById("enableActivityMonitoring").checked = !!config.enableActivityMonitoring;
        document.getElementById("anomalyThreshold").value = config.anomalyThreshold || "";
    }

    if (account_setting_form) {
        account_setting_form.addEventListener("submit", async (e) => {
            e.preventDefault();

            console.log("account_setting_form triggerred!");

            const formData = new FormData(account_setting_form);

            if (e.submitter) {
                formData.append(e.submitter.name, e.submitter.value);
            }
            
            console.log("🔹 Submitting account setting form:", Object.fromEntries(formData));

            showingModal("Loading...", () => {
                closingModal();
            });

            const body = Object.fromEntries(formData.entries());

            const res = await fetch('/api/auth/apply_account_setting', {
                method: 'POST',
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });

            closingModal();

            const data = await res.json();
            
            if (data.success) {
                showModal(data.message, () => {
                    setTimeout(() => {
                        window.location.href = data.redirect;
                    }, 1500);
                }, () => {
                    setTimeout(() => {
                        window.location.href = data.redirect;
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

            console.log("system_setting_form triggerred!");

            const formData = new FormData(system_setting_form);

            if (e.submitter) {
                formData.append(e.submitter.name, e.submitter.value);
            }

            console.log("🔹 Submitting system setting form:", Object.fromEntries(formData));

            showingModal("Loading...", () => {
                closingModal();
            });

            const body = Object.fromEntries(formData.entries());

            const res = await fetch('/api/auth/apply_system_setting', {
                method: 'POST',
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });

            closingModal();

            const data = await res.json();

            if (e.submitter.value === "save") {
                if (data.success) {
                    showModal(data.message, () => {
                        setTimeout(() => {
                            window.location.href = data.redirect;
                        }, 1500);
                    }, () => {
                        setTimeout(() => {
                            window.location.href = data.redirect;
                        }, 1500);
                    });
                } else {
                    showModal(`操作失敗: ${data.message}`);
                }
            }
        });
    }

    if (btn_sys_reset) {
        btn_sys_reset.addEventListener("click", async (e) => {
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
                        window.location.href = data.redirect;
                    }, 1500);
                }, () => {
                    setTimeout(() => {
                        window.location.href = data.redirect;
                    }, 1500);
                });
            }, "modal-container-2", "取消", "確定");
        });
    }

    if (btn_restore) {
        btn_restore.addEventListener("click", (e) => {
            e.preventDefault();
            fileInput.click();
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
                            window.location.href = data.redirect;
                                }, 1500);
                    }, () => {
                        setTimeout(() => {
                            window.location.href = data.redirect;
                        }, 1500);
                    });
                } else {
                    showModal(data.message, () => {
                        setTimeout(() => {
                            window.location.href = data.redirect;
                                }, 1500);
                    }, () => {
                        setTimeout(() => {
                            window.location.href = data.redirect;
                        }, 1500);
                    });
                }
            } catch (err) {
                console.error(err);
            }
        });
    }
});
