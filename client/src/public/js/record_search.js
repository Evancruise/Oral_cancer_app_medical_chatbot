import { loadModal, showModal } from "./modal.js";
import { renderTable } from './table.js';
import { renderPagination } from './pagination.js';

loadModal('modal-container');

document.addEventListener("DOMContentLoaded", () => {
    const dataEl = document.getElementById("rows-data");
    if (!dataEl) {
        return;
    }

    const groupedRecords = JSON.parse(dataEl.textContent || "{}");
    const container = document.getElementById("record-container");

    if (!groupedRecords || Object.keys(groupedRecords).length === 0) {
        container.innerHTML = `
        <div class="no-record text-center" style="margin-top: 30px; color: gray;">
            查無資料
        </div>
        `;
        return;
    }

    const table_record_wraps = document.querySelectorAll(".table-record-wrap");
    const search_form = document.getElementById("search_form");
    const btn_search = document.getElementById("btn-search");
    const row_data = document.getElementById("rows-data");

    if (!row_data) {
        return;
    }
    
    const rows = JSON.parse(row_data.textContent);
    const rowsArray = Array.isArray(rows) ? rows : Object.values(rows);

    console.log(`rows: ${JSON.stringify(rows)}`);
    console.log(`rowsArray: ${JSON.stringify(rowsArray)}`);

    const pageSize = 5;
    let currentPage = 1;

    function filterRows() {
        const dateRange = document.getElementById("dateRange").value.trim();
        const uploader = document.getElementById("uploader").value;
        const status = document.getElementById("status").value;

        console.log(`status: ${status}`);
        
        // document.getElementById("status").innerText = status == "completed" ? "完成" : 
        //    status == "running" ? "未完成" : "未開始";

        const category = document.getElementById("category").value;

        let filtered = [...rowsArray];

        console.log(`filtered (before daterange): ${filtered}`);

        // 🗓 篩選日期區間
        if (dateRange.includes("~")) {
            const [start, end] = dateRange.split("~").map(s => s.trim());
            
            console.log(`start: ${start}`);
            console.log(`end: ${end}`);

            const startDate = new Date(start);
            const endDate = new Date(end);

            console.log(`startDate: ${startDate}`);
            console.log(`endDate: ${endDate}`);

            filtered = filtered.filter(item => {
                console.log(`item: ${JSON.stringify(item)}`);

                console.log('updated_at raw:', item[0].updated_at);
                console.log('type:', typeof item[0].updated_at);

                // item.updated_at: 2025-10-08T12:10:35.584Z
                const uploadDate = new Date(item[0].updated_at.split("T")[0]);

                console.log(`uploadDate: ${uploadDate}`);
                console.log(`uploadDate >= startDate && uploadDate <= endDate: ${uploadDate >= startDate && uploadDate <= endDate}`);
                return uploadDate >= startDate && uploadDate <= endDate;
            });
        }

        console.log(`filtered (after daterange): ${JSON.stringify(filtered)}`);

        console.log(`uploader: ${uploader}`);
        console.log(`status: ${status}`);
        console.log(`category: ${category}`);

        // 篩選上傳帳號
        if (uploader !== "all") {
            filtered = filtered.filter(item => item[0].name === uploader);
        }
        
        if (status !== "all") {
            filtered = filtered.filter(item => item[0].status === null || item[0].status === status);
        }

        // 篩選分類結果
        if (category !== "all") {
            filtered = filtered.filter(item => item[0].result === null || item[0].result === category);
        }

        return filtered;
    }

    function update(filteredData = rowsArray) {
        renderTable(filteredData, pageSize, currentPage);
        renderPagination(filteredData, pageSize, currentPage, (newPage) => {
            currentPage = newPage;
            update(filteredData);
        });
    }

    // 綁定查詢按鈕
    if (btn_search) {
        btn_search.addEventListener("click", () => {
            currentPage = 1;
            const filtered = filterRows();
            console.log("Filtered results:", filtered);
            update(filtered);
        });
    }

    // 初始化 uploader 選單
    const uploader = document.getElementById('uploader');

    if (uploader) {
        let html = "<option value=\"all\">全部</option>";
        if (rows.length !== 0) {
            const uniqueUsers = [...new Set(rowsArray.flat().map(r => r.name))];
            uniqueUsers.forEach(user => {
            html += `<option value="${user}">${user}</option>`;
            });
        }
        uploader.innerHTML = html;
    }

    // 首次渲染
    update();

    if (table_record_wraps) {
        table_record_wraps.forEach(wrap => {
            wrap.addEventListener('click', (e) => {
                const btn = e.target.closest('.view_btn');
                if (!btn || !wrap.contains(btn)) {return;}  // 不是點到「修改」就略過

                console.log("btn.dataset:", btn.dataset);
                // 這裡就可以用 dataset（kebab 會轉 camelCase）
                const { fCreatetime, fCase, fUploadtime, fUser, fStatus, fNotes,
                        fImg1, fImg2, fImg3, fImg4, fImg5, fImg6, fImg7, fImg8,
                        fImg1_result, fImg2_result, fImg3_result, fImg4_result, fImg5_result, fImg6_result, fImg7_result, fImg8_result
                 } = btn.dataset;

                const modal = document.getElementById("viewAllRecordModal");

                modal.querySelector("input[name='f_createtime']").value = fCreatetime || '';
                modal.querySelector("input[name='f_case']").value    = fCase    || '';
                modal.querySelector("input[name='f_uploadtime']").value    = fUploadtime    || '';
                modal.querySelector("input[name='f_user']").value    = fUser    || 'tester';

                modal.querySelector("input[name='f_status']").value = fStatus === "completed" ? "已完成" : 
                    fStatus === "running" ? "未完成" : "未開始";
                //modal.querySelector("input[name='f_status']").innerText = fStatus === "completed" ? "完成" : 
                //    fStatus === "running" ? "未完成" : "未開始";
                
                const img_list = [fImg1, fImg2, fImg3, fImg4, fImg5, fImg6, fImg7, fImg8];
                const img_result_list = [fImg1_result, fImg2_result, fImg3_result, fImg4_result, fImg5_result, fImg6_result, fImg7_result, fImg8_result];

                for (let i = 1; i <= 8; i++) {
                    modal.querySelector(`img[name='preview_${i}']`).src = (img_list[i-1] && img_list[i-1].split('/')[3] !== "undefined") ? img_list[i-1] : `/static/images/${i}.png`; // 如果沒有就顯示預設圖
                    modal.querySelector(`img[name='preview_result_${i}']`).src = (img_result_list[i-1] && img_result_list[i-1].split('/')[3] !== "undefined") ? img_result_list[i-1] : `/static/images/${i}.png`; // 如果沒有就顯示預設圖
                    console.log(`${modal.querySelector(`img[name='preview_${i}']`).src}`);
                }

                modal.querySelector("textarea[name='f_notes']").value = fNotes    || '';
            });
        });
    }

    if (search_form) {
        search_form.addEventListener('submit', async (e) => {
            e.preventDefault();

            const formData = new FormData();

            // 加上 tableData
            const rows = [...document.querySelectorAll("#tbody tr")].map(tr => ({
                patient_id: tr.querySelector('td[name="patient_id"]').innerText,
                created_at: tr.querySelector('td[name="created_at"]').innerText,
                updated_at: tr.querySelector('td[name="updated_at"]').innerText,
                name: tr.querySelector('td[name="name"]').innerText,
                status: tr.querySelector('td[name="status"]').innerText,
                notes: tr.querySelector('td[name="notes"]').innerText
            }));

            formData.append("tableData", JSON.stringify(rows));

            console.log("formData:", [...formData]);

            const res = await fetch("/api/auth/export_data", {
                method: "POST",
                body: formData,
            });

            // 下載 Excel 檔案
            if (res.ok) {
                const blob = await res.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = "records.xlsx";
                document.body.appendChild(a);
                a.click();
                a.remove();
                window.URL.revokeObjectURL(url);
            } else {
                const data = await res.json();
                alert("匯出失敗: " + data.message);
            }
        });        
    }
});