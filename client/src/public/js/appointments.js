import { loadModal, loadingModal, showModal, showingModal, closingModal } from "./modal.js";

loadModal("modal-container");
loadingModal('modal-loading-container');

document.addEventListener("DOMContentLoaded", async () => {
    const btnAddFromUpcoming = document.getElementById("btnAddFromUpcoming");
    //const btnEditFromReserve = document.getElementById("btnEditFromReserve");
    const modalEl = document.getElementById("ReminderModal");
    //const editmodalEl = document.getElementById("EditReminderModal");

    const editButtons = document.querySelectorAll(".btn-edit");
    const confirmButtons = document.querySelectorAll(".btn-confirm");
    const cancelButtons = document.querySelectorAll(".btn-cancel");

    /*
    const addBtn = document.getElementById("btnAddReminder");
    const editBtn = document.getElementById("btnEditReminder");
    */

    const form = document.getElementById("reminderForm");
    const edit_form = document.getElementById("reminderEditForm");
    const token = new URLSearchParams(window.location.search).get("token");
    /*
    const upcomingList = document.getElementById("upcomingList");
    const historyTable = document.querySelector(".appointments-container table[aria-label='歷史回診'] tbody");
    */

    console.log(`token=${token}`);

    if (!token) {
        console.log("No token found");
        return;
    }

    /*
    // try {
        const res = await fetch(`/api/auth/appointments?token=${token}`, {
            method: "GET",
            headers: { "Accept": "application/json" }
        });

        const data = await res.json();
        console.log(`data: ${data}`);
        const appointments = data.appointments || [];

        const now = new Date();
        const upcoming = appointments.filter(a => new Date(a.date) >= now);
        const history = appointments.filter(a => new Date(a.date) < now);

        upcomingList.innerHTML = "";
        if (upcoming.length === 0) {
            upcomingList.innerHTML = `<tr><td colspan="6" style="text-align:center">目前沒有即將回診的紀錄</td></tr>`;
        } else {
            upcoming.forEach(ap => {
                const dateTime = formatDateTime(ap.date);
                const row = document.createElement("tr");
                row.innerHTML = `
                    <td>${dateTime}</td>
                    <td>${ap.dept || "-"}</td>
                    <td>${ap.doctor_name || "-"}</td>
                    <td>${ap.location || "未設定"}</td>
                    <td>
                        <button class="btn secondary btn-confirm" data-id="${ap.id}">確認出席</button>
                        <button class="btn danger btn-cancel" data-id="${ap.id}>取消</button>
                    </td>
                `;
                upcomingList.appendChild(row);
            });

            historyTable.innerHTML = "";
            if (history.length === 0) {
                historyTable.innerHTML = `<tr><td colspan="3" style="text-align:center">尚無歷史回診紀錄</td></tr>`;
            } else {
                history.forEach(ap => {
                    const row = document.createElement("tr");
                    row.innerHTML = `
                        <td>${new Date(ap.date).toISOString().split("T")[0]}</td>
                        <td>${ap.dept || "-"} / ${ap.doctor_name || "-"}</td>
                        <td>${ap.notes || "-"}</td>
                    `;
                    historyTable.appendChild(row);
                });
            }

            if (confirmBtn) {
                confirmBtn.forEach(btn => {
                    btn.addEventListener("click", async (e) => {
                        const id = e.target.dataset.id;
                        await updateStatus(id, "confirmed", token);
                    })
                });
            }

            if (cancelBtn) {
                cancelBtn.forEach(btn => {
                    btn.addEventListener("click", async (e) => {
                        const id = e.target.dataset.id;

                        showModal("確定要取消這次回診嗎?", async () => {
                            await updateStatus(id, "cancelled", token);
                        });
                    });
                });
            }
        }
    */
    // } catch (err) {
    //     console.error("Failed to load appointments:", err);
    // }

    if (btnAddFromUpcoming) {
        btnAddFromUpcoming.addEventListener("click", () => {
            // 建立 Bootstrap Modal 實例
            const modal = new bootstrap.Modal(modalEl);
            modal.show();
        });
    }

    /*
    if (btnEditFromReserve) {
        btnEditFromReserve.addEventListener("click", () => {
            // 建立 Bootstrap Modal 實例
            const modal = new bootstrap.Modal(editmodalEl);
            modal.show();
        });
    }
    */

    if (editButtons) {
        editButtons.forEach(btn => {
            btn.addEventListener("click", () => {
                const editModal = document.getElementById("EditReminderModal");
                const dateInput = editModal.querySelector("#date-edit");
                const doctorInput = editModal.querySelector("#doctor_name-edit");
                const locationInput = editModal.querySelector("#location-edit");
                const notifySwitch = editModal.querySelector("#notify_switch-edit");
                const notifyTimer = editModal.querySelector("#notify_timer-edit");
                const notesArea = editModal.querySelector("#notes-edit");

                dateInput.value = new Date(btn.dataset.date).toISOString().slice(0, 16);
                doctorInput.value = btn.dataset.doctor;
                locationInput.value = btn.dataset.location;
                notifySwitch.checked = btn.dataset.notify === "true";
                notifyTimer.value = btn.dataset.timer;
                notesArea.value = btn.dataset.notes || "";

                const modal = new bootstrap.Modal(editModal);
                modal.show();
            });
        });
    }

    if (confirmButtons) {
        confirmButtons.forEach(btn => {
            btn.addEventListener("click", async () => {
                showModal("確定要預約?", async () => {
                    const formData = new FormData();

                    formData.append("date", new Date(btn.dataset.date).toISOString().slice(0, 16));
                    formData.append("action", btn.value);
                    formData.append("token", btn.dataset.token);

                    /*
                    data-doctor="<%= ap.doctor_name || '' %>"
                    data-location="<%= ap.location || '' %>"
                    data-notify="<%= ap.notify_switch ? 'true' : 'false' %>"
                    data-timer="<%= ap.notify_timer || '' %>"
                    data-notes="<%= ap.notes || '' %>">
                    */

                    const body = Object.fromEntries(formData.entries());

                    showingModal("Loading...", () => {
                        closingModal();
                    });

                    const res = await fetch(`/api/auth/update_appointment_status`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(body),
                    });

                    closingModal();

                    const data = await res.json();

                    if (data.success === true) {
                        showModal("確定預約成功，請準時就診。", () => {
                            window.location.href = data.redirect;
                        }, () => {
                            window.location.href = data.redirect;
                        });
                    } else {
                        showModal("預約操作失敗，請再試一次", () => {
                            window.location.href = data.redirect;
                        }, () => {
                            window.location.href = data.redirect;
                        });
                    }
                });
            });
        });
    }

    if (cancelButtons) {
        cancelButtons.forEach(btn => {
            btn.addEventListener("click", async () => {
                showModal("確定要取消預約?", async () => {
                    const formData = new FormData();

                    formData.append("date", new Date(btn.dataset.date).toISOString().slice(0, 16));
                    formData.append("action", btn.value);
                    formData.append("token", btn.dataset.token);

                    /*
                    data-doctor="<%= ap.doctor_name || '' %>"
                    data-location="<%= ap.location || '' %>"
                    data-notify="<%= ap.notify_switch ? 'true' : 'false' %>"
                    data-timer="<%= ap.notify_timer || '' %>"
                    data-notes="<%= ap.notes || '' %>">
                    */

                    const body = Object.fromEntries(formData.entries());

                    showingModal("Loading...", () => {
                        closingModal();
                    });

                    const res = await fetch(`/api/auth/update_appointment_status`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(body),
                    });

                    closingModal();

                    const data = await res.json();

                    if (data.success === true) {
                        showModal("取消預約成功", () => {
                            window.location.href = data.redirect;
                        }, () => {
                            window.location.href = data.redirect;
                        });
                    } else {
                        showModal("預約操作失敗，請再試一次。", () => {
                            window.location.href = data.redirect;
                        }, () => {
                            window.location.href = data.redirect;
                        });
                    }
                });
            });
        });
    }

    if (form) {
        form.addEventListener("submit", async (e) => {
            e.preventDefault();

            const formData = new FormData(form);

            if (e.submitter) {
                formData.append(e.submitter.name, e.submitter.value);
            }

            const body = Object.fromEntries(formData.entries());
            
            body.notify_switch = document.getElementById('notify_switch').checked;

            showingModal("Loading...", () => {
                closingModal();
            });

            const res = await fetch(`/api/auth/update_appointment`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });

            const data = await res.json();
            
            closingModal();

            showModal("新增設定成功", () => {
                window.location.href = data.redirect;
            }, () => {
                window.location.href = data.redirect;
            });
        });
    }

    if (edit_form) {
        edit_form.addEventListener("submit", async (e) => {
            e.preventDefault();

            const formData = new FormData(edit_form);
            let action = "";

            if (e.submitter) {
                formData.append(e.submitter.name, e.submitter.value);
                action = e.submitter.value;
            }

            const body = Object.fromEntries(formData.entries());

            if (action === "delete") {
                showModal("確定刪除預約?", () => {
                    console.log("確定取消預約 (fall through)");
                    proceed(action);
                }, () => {
                    console.log("返回");
                });

                return;
            } else {
                proceed(action);
            }

            async function proceed (action) {
                
                showingModal("Loading...", () => {
                    closingModal();
                });

                const res = await fetch(`/api/auth/update_appointment`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(body),
                });

                const data = await res.json();
                
                closingModal();

                showModal(action === "delete" ? "刪除預約成功" : "更改預約內容成功", () => {
                    window.location.href = data.redirect;
                }, () => {
                    window.location.href = data.redirect;
                });
            }
        });
    }

    /*
    function formatDateTime(dateStr) {
        const d = new Date(dateStr);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");
        const h = String(d.getHours()).padStart(2, "0");
        const min = String(d.getMinutes().padStart(2, "0"));
        return `${y}-${m}-${day} ${h}:${min}`;
    }
    */

    /*
    async function updateStatus(id, status, token) {
        try {

            const formData = new FormData(form);

            if (e.submitter) {
                formData.append(e.submitter.name, e.submitter.value);
            }

            const body = Object.fromEntries(formData.entries());

            formData.append("status", status);

            showingModal("Loading...", () => {
                closingModal();
            });

            const res = await fetch(`/api/auth/update_appointment?token=${token}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });

            const data = await res.json();
            
            closingModal();

            showModal(`${status}設定成功`, () => {
                window.location.href = data.redirect;
            }, () => {
                window.location.href = data.redirect;
            });
        } catch (err) {
            console.error("Failed to load appointments:", err);
        }
    }
    */
});