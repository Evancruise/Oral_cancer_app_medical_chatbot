import { loadModal, loadInferenceStageModal, showModal } from "./modal.js";

loadModal('modal-container');

document.addEventListener("DOMContentLoaded", () => {
    const add_form = document.getElementById("add_form");
    const newModal = document.getElementById("newRecordModal");
    const edit_form = document.getElementById("edit_form");
    const editModal = document.getElementById("editRecordModal");
    const resultModal = document.getElementById("resultRecordModal");
    const goBackBtn = document.getElementById("btnGoBack");
    const inferenceModal = loadInferenceStageModal("modal-infer-container");

    let uploaded_msg = null;
    let infer_again_msg = null;
    let interval = null;
    let progress = document.getElementById("progress-bar");

    async function check_progress(task_id) {

        console.log(`task_id: ${task_id}`);

        const res = await fetch(`/api/auth/get_inference_status/${task_id}`);
        const data = await res.json();

        console.log(`[check_progress] data: ${JSON.stringify(data)}`);

        if (progress) {
            progress.innerText = `${data.progress}%`;
        }

        if (data.status == "completed") {
            clearInterval(interval);
            // render_result(data.result);
        }

        return data;
    };

    fetch("/api/auth/lang/zh")
    .then(res => res.json())
    .then(dict => {
        uploaded_msg = dict.uploaded;
        infer_again_msg = dict.infer_again_msg;
    });

    const parts = ["1","2","3","4","5","6","7","8"];

    parts.forEach(code => {
      const btn = document.getElementById(`SelectBtn_${code}`);
      const input = document.getElementById(`upload_${code}`);
      const input2 = document.getElementById(`upload2_${code}`);
      const preview = document.getElementById(`preview_${code}`);

      if (btn && input) {
        // 點擊「選擇圖片」按鈕 → 觸發隱藏的 input file
        btn.addEventListener("click", () => {
          input.click();
        });

        // 當使用者選擇圖片後，更新預覽圖
        input.addEventListener("change", async (event) => {
          const file = event.target.files[0];
          const patient_id = newModal.querySelector("input[name='patient_id']").value;

          console.log("file:", file.name);
          if (file) {
            const reader = new FileReader();
            reader.onload = e => {
              preview.src = e.target.result;
              console.log(`preview.src=${preview.src}`);
            };
            reader.readAsDataURL(file);

            // 上傳到後端暫存
            const formData = new FormData();
            formData.append("file", file);
            formData.append("patient_id", patient_id);
            formData.append("code", code);

            const res = await fetch(`/api/auth/temp_upload?patient_id=${patient_id}&code=${code}`, {
                method: "POST",
                body: formData
            });

            const data = await res.json();
            console.log("Temp upload result:", data);

            if (data.success == true) {
                console.log(`data.temp_path: ${data.temp_path}`);
                btn.innerText = uploaded_msg;
                input2.value = `tmp/public/uploads/${patient_id}/${data.filename}`;
                console.log(`input2.value: ${input2.value}`);
            } else {
                showModal("上傳失敗，請再上傳一次");
            }
          }
        });
      }
    });

    // 綁定編輯 Modal
    parts.forEach(code => {
      const btn = document.getElementById(`SelectBtn_edit_${code}`);
      const input = document.getElementById(`upload_edit_${code}`);
      const input2 = document.getElementById(`upload2_edit_${code}`);
      const preview = document.getElementById(`preview_edit_${code}`);

      if (btn && input) {
        // 點擊「選擇圖片」按鈕 → 觸發隱藏的 input file
        btn.addEventListener("click", () => {
          input.click();
        });

        // 當使用者選擇圖片後，更新預覽圖
        input.addEventListener("change", async (event) => {
          const file = event.target.files[0];
          const patient_id = newModal.querySelector("input[name='patient_id']").value;

          console.log("file:", file.name);
          if (file) {
            const reader = new FileReader();
            reader.onload = e => {
              preview.src = e.target.result;
              console.log(`preview.src=${preview.src}`);
            };
            reader.readAsDataURL(file);

            // 上傳到後端暫存
            const formData = new FormData();
            formData.append("file", file);
            formData.append("patient_id", patient_id);
            formData.append("code", code);

            const res = await fetch(`/api/auth/temp_upload?patient_id=${patient_id}&code=${code}`, {
                method: "POST",
                body: formData
            });

            const data = await res.json();
            console.log("Temp upload result:", data);

            if (data.success == true) {
                console.log(`data.temp_path: ${data.temp_path}`);
                btn.innerText = uploaded_msg;
                input2.value = `tmp/public/uploads/${patient_id}/${data.filename}`;
                console.log(`input2.value: ${input2.value}`);
            } else {
                showModal("上傳失敗，請再上傳一次");
            }
          }
        });
      }
    });

    if (add_form) {
        add_form.addEventListener("submit", async (e) => {
            e.preventDefault();

            const formData = new FormData(add_form);

            // 把觸發的按鈕補進 formData
            if (e.submitter) {
                formData.append(e.submitter.name, e.submitter.value);
            }

            console.log(`formData: ${formData}`);

            const res = await fetch("/api/auth/new_record", {
                method: "POST",
                body: formData,
            });

            const data = await res.json();
            console.log(data);
        
            if (!data.success) {
                showModal(`新增病例失敗: ${data.message}`);
                return;
            }

            showModal("新增病例成功", () => {
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

    if (edit_form) {
        edit_form.addEventListener("submit", async (e) => {
            e.preventDefault();

            const formData = new FormData(edit_form);

            // 把觸發的按鈕補進 formData
            if (e.submitter) {
                formData.append(e.submitter.name, e.submitter.value);
            }

            for (let i = 1; i <= 8; i++) {
                formData.append(`pic${i}`, document.querySelector(`#upload2_edit_${i}`).value);
            }
            
            for (const [key, value] of formData.entries()) {
                console.log(key, value);
            }

            if (e.submitter.value === "infer") {
                const res = await fetch("/api/auth/analyze", {
                    method: "POST",
                    body: formData,
                });

                const data = await res.json();
                if (!data) {
                    showModal("Cannot retrieve data content");
                    return;
                }

                inferenceModal.show(); // 顯示 modal

                interval = setInterval(async () => {
                    const data_p = await check_progress(data.task_id);
                    
                    console.log(`data_p: ${JSON.stringify(data_p)}`);

                    if (data_p.status === "running") {
                        inferenceModal.updateProgress(data_p.progress, data_p.message);
                    } else if (data_p.status === "completed") {
                        inferenceModal.complete("Report Ready", data.redirect);
                        clearInterval(interval);
                    } else if (data_p.status === "failed") {
                        inferenceModal.updateProgress(100, "Failed");
                        clearInterval(interval);
                    }
                }, 2000);
            } else {
                const res = await fetch("/api/auth/edit_record", {
                    method: "POST",
                    body: formData,
                });

                const data = await res.json();
                console.log(data);
            
                if (!data.success) {
                    showModal(`編輯病例失敗: ${data.message}`);
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
            }
        });
    }

    /*
    if (newModal) {
        newModal.addEventListener("show.bs.modal", (e) => {
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
            newModal.querySelector("input[name='name']").value = name;
            newModal.querySelector("select[name='gender']").value = gender;
            newModal.querySelector("input[name='age']").value = age;
            newModal.querySelector("textarea[name='notes']").value = notes;
            let hiddenId = newModal.querySelector("input[name='record_id']");
            if (!hiddenId) {
                hiddenId = document.createElement("input");
                hiddenId.type = "hidden";
                hiddenId.name = "record_id";
                newModal.querySelector("form").appendChild(hiddenId);
            }
            hiddenId.value = record_id;
            // 口腔圖片
            for (let i = 1; i <= 8; i++) {
                const picVal = link.getAttribute(`data-pic${i}`);  // 原本的檔案路徑
                const input = newModal.querySelector(`#upload2_edit_${i}`); // hidden input
                const img = newModal.querySelector(`#preview_edit_${i}`);  // 預覽 <img>
                console.log("picVal:", picVal);
                if (input && img) {
                    input.value = picVal || "";
                    img.src = picVal ? picVal : `/static/images/${i}.png`; // 如果沒有就顯示預設圖
                }
            }
        });
    }
    */

    if (editModal) {

        document.querySelectorAll(".record-link").forEach(el => {
            el.addEventListener("click", e => {
                console.log("Clicked record_id:", e.currentTarget.dataset.record_id);
            });
        });

        editModal.addEventListener("show.bs.modal", (e) => {
            // Trigger modal=record-link element
            const link = e.relatedTarget;

            console.log(`link: ${link}`);

            // const { name, gender, age, patient_id, notes, record_id } = link.dataset;

            // fetch data-* attributes' value
            const name = link.getAttribute("data-name");
            const gender = link.getAttribute("data-gender");
            const age = link.getAttribute("data-age");
            const patient_id = link.getAttribute("data-patient_id");
            const notes = link.getAttribute("data-notes");
            const record_id = link.getAttribute("data-record_id");
            
            console.log(`name: ${name}`);
            console.log(`gender: ${gender}`);
            console.log(`age: ${age}`);
            console.log(`patient_id: ${patient_id}`);
            console.log(`notes: ${notes}`);
            console.log(`record_id: ${record_id}`);

            // filling the form
            editModal.querySelector("input[name='name']").value = name;
            editModal.querySelector("select[name='gender']").value = gender;
            editModal.querySelector("input[name='age']").value = age;
            editModal.querySelector("textarea[name='notes']").value = notes;
            editModal.querySelector("input[name='patient_id']").value = patient_id;

            let hiddenId = editModal.querySelector("input[name='record_id']");
            if (!hiddenId) {
                hiddenId = document.createElement("input");
                hiddenId.type = "hidden";
                hiddenId.name = "record_id";
                editModal.querySelector("form").appendChild(hiddenId);
            }
            hiddenId.value = record_id;

            // 口腔圖片
            for (let i = 1; i <= 8; i++) {
                const picVal = link.getAttribute(`data-pic${i}`);  // 原本的檔案路徑
                const input = editModal.querySelector(`#upload2_edit_${i}`); // hidden input
                const img = editModal.querySelector(`#preview_edit_${i}`);  // 預覽 <img>

                console.log("picVal.length:", picVal.length);

                if (input && img) {
                    input.value = picVal || "";
                    img.src = (picVal && picVal.split('/')[3] !== "undefined") ? picVal : `/static/images/${i}.png`; // 如果沒有就顯示預設圖
                }
            }

            const status = link.getAttribute(`data-status`);

            console.log(`status: ${status}`);
            
            if (status !== "completed") {
                document.getElementById("infer").style.width = "100%";
                document.getElementById("check_result_edit").style.display = "none";
            } else {
                // document.getElementById("infer").innerText = check_result_edit;
                document.getElementById("infer").style.width = "48%";
                document.getElementById("check_result_edit").style.display = true;
                document.getElementById("check_result_edit").style.width = "48%";
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
    
    if (goBackBtn) {
        goBackBtn.addEventListener("click", () => {
            const resultModal = document.getElementById("resultRecordModal");
            const triggerId = resultModal.getAttribute("data-trigger-id");

            console.log(`triggerId: ${triggerId}`);

            const bsResultModal = bootstrap.Modal.getInstance(resultModal);
            bsResultModal.hide();

            if (triggerId === "check_result_add") {
              bootstrap.Modal.getOrCreateInstance(document.getElementById("newRecordModal")).show();
            } else if (triggerId === "check_result_edit") {
              bootstrap.Modal.getOrCreateInstance(document.getElementById("editRecordModal")).show();
            }
        });
    }
});