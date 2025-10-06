export function loadModal(containerId, leftMsg="OK", rightMsg="Cancel") {
  const container = document.getElementById(containerId);
  container.innerHTML = `
    <div id="modal" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%;
        background:rgba(0,0,0,0.4); z-index:10000; align-items:center; justify-content:center;">
      <div style="background:white; padding:20px 30px; border-radius:10px; min-width:280px; max-width:400px; text-align:center; box-shadow:0 4px 20px rgba(0,0,0,0.3);">
        <p id="modal-message" style="font-size:16px; margin-bottom:1.2rem;"></p>
        <div style="display:flex; justify-content:center; gap:1rem;">
          <button id="modal-ok">${leftMsg}</button>
          <button id="modal-cancel">${rightMsg}</button>
        </div>
      </div>
    </div>
  `;

  const modal = container.querySelector("#modal");
  const okBtn = container.querySelector("#modal-ok");
  const cancelBtn = container.querySelector("#modal-cancel");

  okBtn.onclick = () => {
    if (modal.okCallback) modal.okCallback();
    modal.style.display = "none";
  };

  cancelBtn.onclick = () => {
    if (modal.cancelCallback) modal.cancelCallback();
    modal.style.display = "none";
  };
}

export function showModal(message, onOk=null, onCancel=null, containerId="modal-container", leftMsg="OK", rightMsg="Cancel") {
  const container = document.getElementById(containerId);
  const modal = container.querySelector("#modal");

  container.querySelector("#modal-message").innerText = message;
  container.querySelector("#modal-ok").innerText = leftMsg;
  container.querySelector("#modal-cancel").innerText = rightMsg;

  modal.okCallback = onOk;
  modal.cancelCallback = onCancel;

  modal.style.display = "flex";
}