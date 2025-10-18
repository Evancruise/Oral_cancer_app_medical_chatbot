import { loadModal, loadingModal, showModal, showingModal, closingModal } from "./modal.js";

loadModal('modal-container');
loadingModal('modal-loading-container');

document.addEventListener("DOMContentLoaded", () => {
    const recycle_form = document.getElementById("recycle_form");
    const viewModal = document.getElementById("viewRecordModal_rec");
    const resultModal = document.getElementById("resultRecordModal_rec");
    const goBackBtn = document.getElementById("btnGoBack_rec");
    const recordlink = document.querySelectorAll(".record-link");
    let currentRecord = {};

    const parts = ["1","2","3","4","5","6","7","8"];

    // 綁定編輯 Modal
    parts.forEach(code => {
        const preview = document.getElementById(`preview_${code}`);
        console.log(`preview: ${preview}`);
    });

    if (recycle_form) {
        recycle_form.addEventListener("submit", async (e) => {
            e.preventDefault();

            const formData = new FormData(recycle_form);

            // 把觸發的按鈕補進 formData
            if (e.submitter) {
                formData.append(e.submitter.name, e.submitter.value);
            }

            showingModal("Loading...", () => {
                closingModal();
            });

            const res = await fetch("/api/auth/recycle_record", {
                method: "POST",
                body: formData,
            });

            const data = await res.json();
            console.log(data);

            closingModal();

            if (!data.success) {
                showModal(`還原/刪除病例失敗: ${data.message}`);
                return;
            }

            showModal(`${data.message}`, () => {
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

    if (viewModal) {
        viewModal.addEventListener("show.bs.modal", (e) => {
            // Trigger modal=record-link element
            const link = e.relatedTarget;

            // fetch data-* attributes' value
            const name = link.getAttribute("data-name");
            const gender = link.getAttribute("data-gender");
            const age = link.getAttribute("data-age");
            const patient_id = link.getAttribute("data-patient_id");
            const notes = link.getAttribute("data-notes");
            const record_id = link.getAttribute("data-record_id");

            // filling the form
            viewModal.querySelector("input[name='name']").value = name;
            viewModal.querySelector("select[name='gender']").value = gender;
            viewModal.querySelector("input[name='age']").value = age;
            viewModal.querySelector("textarea[name='notes']").value = notes;
            viewModal.querySelector("input[name='patient_id']").value = patient_id;

            let hiddenId = viewModal.querySelector("input[name='record_id']");
            if (!hiddenId) {
                hiddenId = document.createElement("input");
                hiddenId.type = "hidden";
                hiddenId.name = "record_id";
                viewModal.querySelector("form").appendChild(hiddenId);
            }
            hiddenId.value = record_id;

            // 口腔圖片
            for (let i = 1; i <= 8; i++) {
                const picVal = link.getAttribute(`data-pic${i}`);  // 原本的檔案路徑
                const img = viewModal.querySelector(`#preview_${i}`);  // 預覽 <img>

                console.log(`picVal: ${picVal}`);

                if (img) {
                    img.src = (picVal && picVal.split('/')[3] !== "undefined") ? picVal : `/static/images/${i}.png`;
                }

                console.log("img.src:", img.src);
            }
        });
    }

    if (resultModal) {
        resultModal.addEventListener("show.bs.modal", (event) => {
            // 觸發 modal 的按鈕
            const button = event.relatedTarget;

            console.log("這個 modal 是由以下按鈕觸發的:", button.id);
            
            // 你可以把它記錄到 modal 裡
            resultModal.setAttribute("data-trigger-id", button.id);
        });
    }

    if (recordlink) {
        recordlink.forEach(link => {
            link.addEventListener("click", () => {
                currentRecord = {
                    name: link.getAttribute("data-name"),
                    gender: link.getAttribute("data-gender"),
                    age: link.getAttribute("data-age"),
                    patient_id: link.getAttribute("data-patient_id"),
                    notes: link.getAttribute("data-notes"),
                    record_id: link.getAttribute("data-record_id"),
                    pics: Array.from({length: 8}, (_,i) => link.getAttribute(`data-pic${i+1}`))
                };
            });
        });
    }

    if (goBackBtn) {
        // 回上一頁時重新填入 currentRecord
        goBackBtn.addEventListener("click", () => {
            bootstrap.Modal.getInstance(resultModal).hide();
            const view = document.getElementById("viewRecordModal_rec");
            bootstrap.Modal.getOrCreateInstance(view).show();

            view.querySelector("input[name='name']").value = currentRecord.name;
            view.querySelector("select[name='gender']").value = currentRecord.gender;
            view.querySelector("input[name='age']").value = currentRecord.age;
            view.querySelector("textarea[name='notes']").value = currentRecord.notes;
            view.querySelector("input[name='patient_id']").value = currentRecord.patient_id;
            // 圖片也重新帶回去
            currentRecord.pics.forEach((pic, idx) => {
                const img = view.querySelector(`#preview_${idx+1}`);
                if (img) {img.src = pic || `/static/images/${idx+1}.png`;}
            });
        });
    }
});