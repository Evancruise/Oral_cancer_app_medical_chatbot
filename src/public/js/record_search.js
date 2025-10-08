import { loadModal, showModal } from "./modal.js";
import { renderTable } from './table.js';
import { renderPagination } from './pagination.js';

loadModal('modal-container');

const table_record_wraps = document.querySelectorAll(".table-record-wrap");
const search_form = document.getElementById("search_form");
const btn_search = document.getElementById("btn-search");

document.addEventListener("DOMContentLoaded", () => {
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

        // 👤 篩選上傳帳號
        if (uploader !== "all") {
            filtered = filtered.filter(item => item[0].name === uploader);
        }
        
        if (status !== "all") {
            filtered = filtered.filter(item => item[0].status === null || item[0].status === status);
        }

        // 🏷 篩選分類結果
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
                if (!btn || !wrap.contains(btn)) return;  // 不是點到「修改」就略過

                console.log(btn.dataset);
                // 這裡就可以用 dataset（kebab 會轉 camelCase）
                const { fCreatetime, fCase, fCount, fUploadtime, fUser, fStatus, fNotes } = btn.dataset;

                console.log(fCreatetime, fCase, fCount, fUploadtime, fUser, fStatus, fNotes);

                const modal = document.getElementById("viewAllRecordModal");

                modal.querySelector("input[name='f_createtime']").value = fCreatetime || '';
                modal.querySelector("input[name='f_case']").value    = fCase    || '';
                modal.querySelector("input[name='f_uploadtime']").value    = fUploadtime    || '';
                modal.querySelector("input[name='f_user']").value    = fUser    || 'tester';
                modal.querySelector("input[name='f_status']").value = fStatus  || 'deactivated';
                modal.querySelector("textarea[name='f_notes']").value = fNotes    || '';

                /*                        
                <button type="button" class="view_btn btn btn-sm btn-primary"
                      data-bs-toggle="modal" data-bs-target="#viewRecordModal"
                      data-f-createtime="${r.created ?? ''}"
                      data-f-case="${r.case ?? ''}"
                      data-f-count="${r.count ?? ''}"
                      data-f-uploadtime="${r.uploaded ?? ''}"
                      data-f-user="${r.user ?? ''}"
                      data-f-status="${r.status ?? ''}"
                      data-f-notes="${r.notes ?? ''}">
                查看
              </button>
                */
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
                status: tr.querySelector('td[name="badge"]').innerText,
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