// pagination.js
import { applyFilters } from './filters.js';

export function renderUserPagination(users, pageSize, currentPage, updateCallback) {
  const pager = document.getElementById("pagination");
  const totalPages = Math.max(1, Math.ceil(users.length / pageSize));
  let html_page = "";

  for (let i = 1; i <= totalPages; i++) {
    html_page += `<button class="pager ${
      i === currentPage ? "active" : ""
    }" data-page="${i}">${i}</button>`;
  }

  let html = `
    <div class="pagination">
      <button class="pager prev ${currentPage === 1 ? "disabled" : ""}">Prev</button>
      ${html_page}
      <button class="pager next ${currentPage === totalPages ? "disabled" : ""}">Next</button>
    </div>
  `;

  pager.innerHTML = html;

  // 綁定事件
  pager.querySelectorAll(".pager").forEach((btn) => {
    btn.addEventListener("click", () => {
      const page = btn.dataset.page;
      if (page) {
        updateCallback(parseInt(page));
      } else if (btn.classList.contains("prev") && currentPage > 1) {
        updateCallback(currentPage - 1);
      } else if (btn.classList.contains("next") && currentPage < totalPages) {
        updateCallback(currentPage + 1);
      }
    });
  });
};

export function renderPagination(rows, pageSize, currentPage, setPageCallback) {
  const data = applyFilters(rows);

  console.log(`Filtered data: ${JSON.stringify(data)}`);

  const totalPages = Math.max(1, Math.ceil(data.length / pageSize));
  const pager = document.getElementById('pagination');
  let html_page = '';

  for (let i = 1; i <= totalPages; i++) {
    html_page += `<button class="pager ${i === currentPage ? 'active' : ''}" data-page="${i}">${i}</button>`;
  }

  pager.innerHTML = `
    <div class="pagination">
      <button class="pager prev ${currentPage === 1 ? 'disabled' : ''}">Prev</button>
      ${html_page}
      <button class="pager next ${currentPage === totalPages ? 'disabled' : ''}">Next</button>
    </div>
  `;

  pager.querySelectorAll(".pager").forEach(btn => {
    btn.addEventListener("click", () => {
      const page = btn.dataset.page;
      if (page) {
        setPageCallback(parseInt(page));
      } else if (btn.classList.contains("prev") && currentPage > 1) {
        setPageCallback(currentPage - 1);
      } else if (btn.classList.contains("next") && currentPage < totalPages) {
        setPageCallback(currentPage + 1);
      }
    });
  });
}
