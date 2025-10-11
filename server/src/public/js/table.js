// table.js
import { applyFilters } from './filters.js';

export function renderUserTable(users, pageSize, currentPage) {
  const tbody = document.getElementById("tbody");
  const start = (currentPage - 1) * pageSize;
  const end = start + pageSize;
  const pageRows = users.slice(start, end);

  tbody.innerHTML = pageRows.flat()
    .map((u) => {

      console.log("Rendering user:", u);

      const statusBadge =
        u.status === "啟用" || u.status === "activated"
          ? '<span class="badge badge-ok">啟用</span>'
          : '<span class="badge badge-off">停用</span>';

      const role = u.role ? `<span class="role">${u.role}</span>` : "";

      return `
        <tr>
            <td data-th="帳號">${u.email}</td>
            <td data-th="姓名">${u.name}</td>
            <td data-th="密碼">
              <span class="masked">******</span>
              <span class="real d-none">${u.password || ''}</span>
            </td>
            <td data-th="單位">${u.unit || ""}</td>
            <td data-th="身分">${role}</td>
            <td data-th="備註">${u.note || ""}</td>
            <td data-yj="修改/刪除">
              <button type="button" class="modify_btn btn btn-sm btn-primary"
                      data-bs-toggle="modal" data-bs-target="#curAccountModal"
                      data-f-account="${u.email ?? ""}"
                      data-f-name="${u.name ?? ""}"
                      data-f-password="${u.password ?? ""}"
                      data-f-unit="${u.unit ?? ""}"
                      data-f-role="${u.role ?? ""}"
                      data-f-status="${u.status ?? ""}"
                      data-f-note="${u.note ?? ""}">
                檢視 / 修改 / 刪除
              </button>
            </td>
        </tr>`;
    })
    .join("");
};

export function renderTable(rows, pageSize, currentPage) {
  const data = applyFilters(rows);
  const start = (currentPage - 1) * pageSize;
  const end = start + pageSize;
  const pageRows = data.slice(start, end);

  const tbody = document.getElementById('tbody');
  tbody.innerHTML = pageRows.map(r => {
    const status = r.status === 'completed'
      ? '<span class="badge green">已完成</span>'
      : r.status === 'running'
      ? '<span class="badge green">未完成</span>'
      : '<span class="badge gray">未開始</span>';
    return `
      <tr>
        <td name="patient_id">${r.patient_id}</td>
        <td name="created_at">${r.created_at.split("T")[0] ?? ''}</td>
        <td name="updated_at">${r.updated_at.split("T")[0] ?? ''}</td>
        <td name="name">${r.name}</td>
        <td name="status">${status}</td>
        <td name="notes">${r.notes || ''}</td>
        <td>
          <button type="button" class="view_btn btn btn-sm btn-primary" name="view_btn"
                  data-bs-toggle="modal" data-bs-target="#viewAllRecordModal"
                  data-f-createtime="${r.created_at.split("T")[0] ?? ''}"
                  data-f-case="${r.patient_id ?? ''}"
                  data-f-uploadtime="${r.updated_at.split("T")[0] ?? ''}"
                  data-f-user="${r.name ?? ''}"
                  data-f-status="${r.status ?? ''}"
                  data-f-notes="${r.notes ?? ''}">
            查看
          </button>
        </td>
      </tr>`;
  }).join('');
};
