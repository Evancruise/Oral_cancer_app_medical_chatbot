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

export function loadInferenceCircleModal(containerId) {
  const container = document.getElementById(containerId);
  container.innerHTML = `
    <div id="inference-modal" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%;
        background:rgba(0,0,0,0.4); z-index:10000; align-items:center; justify-content:center;">
      <div style="background:white; padding:30px 40px; border-radius:16px; min-width:300px; max-width:420px;
          text-align:center; box-shadow:0 4px 25px rgba(0,0,0,0.3);">
        
        <h3 style="margin-bottom:1rem;">🧠 Inference in Progress</h3>
        
        <div style="position:relative; width:120px; height:120px; margin:0 auto;">
          <svg viewBox="0 0 36 36" style="transform:rotate(-90deg);">
            <path id="circle-bg"
              d="M18 2.0845
                 a 15.9155 15.9155 0 0 1 0 31.831
                 a 15.9155 15.9155 0 0 1 0 -31.831"
              fill="none"
              stroke="#eee"
              stroke-width="2.5"
            />
            <path id="circle-progress"
              d="M18 2.0845
                 a 15.9155 15.9155 0 0 1 0 31.831
                 a 15.9155 15.9155 0 0 1 0 -31.831"
              fill="none"
              stroke="url(#gradient)"
              stroke-width="2.5"
              stroke-dasharray="0,100"
              stroke-linecap="round"
            />
            <defs>
              <linearGradient id="gradient" x1="1" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#007bff"/>
                <stop offset="100%" stop-color="#00c6ff"/>
              </linearGradient>
            </defs>
          </svg>
          <div id="percent-text" style="position:absolute; top:50%; left:50%; transform:translate(-50%,-50%);
              font-size:20px; font-weight:bold; color:#333;">0%</div>
        </div>

        <p id="status-text" style="font-size:14px; margin-top:1rem; color:#555;">Preparing model...</p>
        
        <button id="cancel-btn" style="margin-top:1.2rem; padding:6px 14px; background:#aaa; color:white; border:none;
            border-radius:6px; cursor:pointer;">
          Cancel
        </button>
      </div>
    </div>
  `;

  const modal = container.querySelector("#inference-modal");
  const progressPath = container.querySelector("#circle-progress");
  const percentText = container.querySelector("#percent-text");
  const statusText = container.querySelector("#status-text");
  const cancelBtn = container.querySelector("#cancel-btn");

  // 顯示
  modal.show = () => {
    modal.style.display = "flex";
    updateProgress(0, "Initializing model...");
  };

  // 更新進度
  function updateProgress(percent, text = "") {
    const dash = (percent * 100) / 100;
    progressPath.setAttribute("stroke-dasharray", `${percent},100`);
    percentText.textContent = `${Math.floor(percent)}%`;
    if (text) statusText.textContent = text;
  }

  // 封裝方法
  modal.updateProgress = (percent, text = "") => updateProgress(percent, text);

  // 完成
  modal.complete = (finalText = "Inference completed!") => {
    updateProgress(100, finalText);
    progressPath.setAttribute("stroke", "url(#greenGradient)");
    percentText.textContent = "✅";
    setTimeout(() => (modal.style.display = "none"), 1500);
  };

  // 取消
  cancelBtn.onclick = () => {
    if (modal.cancelCallback) modal.cancelCallback();
    modal.style.display = "none";
  };

  return modal;
}

export function loadInferenceModal(containerId) {
  const container = document.getElementById(containerId);
  container.innerHTML = `
    <div id="inference-modal" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%;
        background:rgba(0,0,0,0.4); z-index:10000; align-items:center; justify-content:center;">
      <div style="background:white; padding:25px 30px; border-radius:10px; min-width:300px; max-width:400px;
          text-align:center; box-shadow:0 4px 20px rgba(0,0,0,0.3);">
        
        <h3 style="margin-bottom:1rem;">🧠 Inference in Progress</h3>
        <div style="background:#e6e6e6; border-radius:10px; overflow:hidden; height:14px; margin-bottom:1rem;">
          <div id="progress-bar" style="width:0%; height:100%; background:linear-gradient(90deg, #007bff, #00c6ff); transition:width 0.4s;"></div>
        </div>
        <p id="status-text" style="font-size:14px; margin-bottom:1rem; color:#333;">Preparing model...</p>

        <button id="inference-cancel" style="padding:6px 14px; background:#aaa; color:white; border:none; border-radius:6px; cursor:pointer;">
          Cancel
        </button>
      </div>
    </div>
  `;

  const modal = container.querySelector("#inference-modal");
  const progressBar = container.querySelector("#progress-bar");
  const statusText = container.querySelector("#status-text");
  const cancelBtn = container.querySelector("#inference-cancel");

  // 方法：顯示 modal
  modal.show = () => {
    modal.style.display = "flex";
    statusText.textContent = "Initializing model...";
    progressBar.style.width = "0%";
  };

  // 方法：更新進度
  modal.updateProgress = (percent, text = "") => {
    progressBar.style.width = percent + "%";
    if (text) statusText.textContent = text;
  };

  // 方法：完成
  modal.complete = (finalText = "Inference completed!") => {
    progressBar.style.width = "100%";
    progressBar.style.background = "linear-gradient(90deg, #28a745, #68e08f)";
    statusText.textContent = finalText;
    setTimeout(() => (modal.style.display = "none"), 1500);
  };

  // 方法：取消
  cancelBtn.onclick = () => {
    if (modal.cancelCallback) modal.cancelCallback();
    modal.style.display = "none";
  };

  return modal;
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

export function loadInferenceStageModal(containerId) {
  const container = document.getElementById(containerId);
  container.innerHTML = `
    <div id="inference-modal" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%;
        background:rgba(0,0,0,0.4); z-index:10000; align-items:center; justify-content:center;">
      <div style="background:white; padding:30px 40px; border-radius:16px; min-width:300px; max-width:420px;
          text-align:center; box-shadow:0 4px 25px rgba(0,0,0,0.3);">
        
        <h3 style="margin-bottom:1rem;">🧠 Inference in Progress</h3>
        
        <div style="position:relative; width:120px; height:120px; margin:0 auto;">
          <svg viewBox="0 0 36 36" style="transform:rotate(-90deg);">
            <path id="circle-bg"
              d="M18 2.0845
                 a 15.9155 15.9155 0 0 1 0 31.831
                 a 15.9155 15.9155 0 0 1 0 -31.831"
              fill="none"
              stroke="#eee"
              stroke-width="2.5"
            />
            <path id="circle-progress"
              d="M18 2.0845
                 a 15.9155 15.9155 0 0 1 0 31.831
                 a 15.9155 15.9155 0 0 1 0 -31.831"
              fill="none"
              stroke="url(#gradient)"
              stroke-width="2.5"
              stroke-dasharray="0,100"
              stroke-linecap="round"
            />
            <defs>
              <linearGradient id="gradient" x1="1" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#007bff"/>
                <stop offset="100%" stop-color="#00c6ff"/>
              </linearGradient>
              <linearGradient id="greenGradient" x1="1" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#28a745"/>
                <stop offset="100%" stop-color="#68e08f"/>
              </linearGradient>
            </defs>
          </svg>
          <div id="percent-text" style="position:absolute; top:50%; left:50%; transform:translate(-50%,-50%);
              font-size:20px; font-weight:bold; color:#333;">0%</div>
        </div>

        <p id="status-text" style="font-size:14px; margin-top:1rem; color:#555;">Preparing model...</p>
        
        <button id="cancel-btn" style="margin-top:1.2rem; padding:6px 14px; background:#aaa; color:white; border:none;
            border-radius:6px; cursor:pointer;">
          Cancel
        </button>
      </div>
    </div>
  `;

  const modal = container.querySelector("#inference-modal");
  const progressPath = container.querySelector("#circle-progress");
  const percentText = container.querySelector("#percent-text");
  const statusText = container.querySelector("#status-text");
  const cancelBtn = container.querySelector("#cancel-btn");
  let redirect_link = null;

  const stages = [
    "Loading model weights...",
    "Extracting DINOv2 features...",
    "Analyzing lesion patterns...",
    "Generating LangChain report..."
  ];

  // 顯示 modal
  modal.show = () => {
    modal.style.display = "flex";
    updateProgress(0, "Initializing model...");
    runStages();
  };

  // 更新進度條
  function updateProgress(percent, text = "") {
    progressPath.setAttribute("stroke-dasharray", `${percent},100`);
    const percent_text = Math.floor(percent);
    
    if (percent >= 100) {
      percentText.textContent = `100%`;
    }
    else
    {
      percentText.textContent = `${percent_text}%`;
    }

    if (text) statusText.textContent = text;
  }

  // 模擬分階段推進（可根據實際後端狀態來替換）
  async function runStages() {
    for (let i = 0; i < stages.length; i++) {
      await smoothProgress(i * 25, (i + 1) * 25, stages[i]);
    }
  }

  // 平滑動畫控制
  function smoothProgress(from, to, text) {
    return new Promise((resolve) => {
      let current = from;
      const timer = setInterval(() => {
        current += 2;
        updateProgress(current, text);
        if (current >= to) {
          clearInterval(timer);
          resolve();
        }
      }, 120);
    });
  }

  // 外部可手動更新 (當你從 Flask 查詢狀態)
  modal.updateProgress = (percent, text = "") => updateProgress(percent, text);

  // 完成
  modal.complete = (finalText = "✅ Inference Completed!", redirect = null) => {
    progressPath.setAttribute("stroke", "url(#greenGradient)");
    console.log("[complete] redirect:", redirect);
    updateProgress(100, finalText);
    redirect_link = redirect;
    percentText.textContent = "✅";
    // setTimeout(() => (modal.style.display = "none"), 2000);
  };

  // 取消按鈕
  cancelBtn.onclick = () => {
    if (modal.cancelCallback) modal.cancelCallback();
    modal.style.display = "none";
    
    if (redirect_link) {
      window.location.href = redirect_link;
    }
    // redirect to corresponding modal
  };

  return modal;
}
