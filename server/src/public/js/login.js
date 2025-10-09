import { loadModal, showModal } from "./modal.js";

loadModal("modal-container");

const professor_div = document.getElementById("professor");
const patient_div = document.getElementById("patient");
const professorForm = document.getElementById("professor-tab");
const patientForm = document.getElementById("patient-tab");

console.log("professorForm:", professorForm);
console.log("patientForm:", patientForm);

const canvas = document.getElementById("snapshot");
const ctx = canvas.getContext("2d");
let countdown = 30;
let ws;
let connectionMode = null;

/*
const video = document.getElementById("camera");
const canvas = document.getElementById("snapshot");
const ctx = canvas.getContext("2d");
const resultDiv = document.getElementById("scan-result");
const resetBtn = document.getElementById("reset-scan");
const patient_tab = document.getElementById("patient-tab");
const professor_tab = document.getElementById("professor-tab");

let stream = null;
let scanning = false;
let scannedContent = null;
*/

/*
async function startCamera() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    video.srcObject = stream;
    video.setAttribute("playsinline", true); // iOS fix
    scanning = true;
    video.play();
    requestAnimationFrame(scanQRCode);
  } catch (err) {
    console.error("Error accessing camera:", err);
  }
}
*/

/*
function scanQRCode() {
    if (!scanning) return;

    if (video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: "dontInvert",
        });

        if (code) {
            scannedContent = code.data;
            console.log("✅ QR Code Detected:", scannedContent);
            resultDiv.innerText = `掃描成功，驗證中...`;

            stopCamera();

            fetch('/api/auth/scan_result', {
                method: 'POST',
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ qrContent: scannedContent }),
            })
            .then(res => res.json())
            .then(data => {
                console.log("伺服器回應:", data);
                resultDiv.innerText = `✅ ${data.message}`;
                // 如果要自動導向，可以這樣做：
                // if (data.success) window.location.href = "/dashboard";
            })
            .catch(err => {
                console.error("驗證失敗:", err);
                resultDiv.innerText = "❌ QR Code 驗證失敗，請重試";
            });

            return;
        }
    }

    requestAnimationFrame(scanQRCode);
}
*/

/*
function stopCamera() {
  scanning = false;
  if (stream) {
    stream.getTracks().forEach(track => track.stop());
    stream = null;
  }
}
*/

function handleLoginSuccess(token) {
    document.getElementById("status").innerText = "✅ 登入成功！";
    console.log("登入成功 Token:", token);
    setTimeout(() => window.location.href = "/api/auth/dashboard", 1500);
}

function connectSSE(qrToken) {
    connectionMode = "sse";
    console.log("🔄 啟用 SSE 事件串流");
    const evtSource = new EventSource(`/api/auth/stream/${qrToken}`);
    evtSource.onmessage = (event) => {
        const data = JSON.parse(event.data);
        handleLoginSuccess(data.token);
        evtSource.close();
    };
    evtSource.onerror = (err) => {
        console.error("❌ SSE 連線失敗:", err);
        evtSource.close();
    };
}

async function tryWebSocketOrSSE(qrToken) {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/${protocol}`;
    let ws;

    try {
      ws = new WebSocket(wsUrl);
      connectionMode = "ws";
      console.log("🛰 嘗試連線 WebSocket:", wsUrl);

      ws.onopen = () => {
        console.log("✅ WebSocket 已連線");
        ws.send(JSON.stringify({ type: "register", qr_token: qrToken }));
      };

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === "authenticated") handleLoginSuccess(msg.token);
      };

      ws.onerror = () => {
        console.warn("⚠️ WebSocket 錯誤，切換 SSE 模式");
        if (ws) ws.close();
        connectSSE(qrToken);
      };

      ws.onclose = () => {
        if (connectionMode === "ws") {
          console.warn("⚠️ WebSocket 已關閉，改用 SSE");
          connectSSE(qrToken);
        }
      };
    } catch (err) {
      console.error("❌ WebSocket 初始化失敗:", err);
      connectSSE(qrToken);
    }
}

async function loadQRCode() {
    const res = await fetch("/api/auth/generate_qr");
    const data = await res.json();
    countdown = 30;

    let qrToken = data.qr_token;
    document.getElementById("qrImage").src = data.qrImage;
    document.getElementById("status").innerText = "等待掃描...";

    // 這裡 data.token 就是病患要掃的內容
    //connectWebSocket(qrToken);
    //checkStatus(qrToken);
    //tryWebSocketOrSSE(qrToken);
}

function checkStatus(qrToken) {
    if (!qrToken) return;

    const evtSource = new EventSource(`/api/auth/stream/${qrToken}`);
    evtSource.onmessage = (e) => {
        console.log("登入成功:", e.data);
        evtSource.close();
    };

    /*
    const res = await fetch(`/api/auth/status/${qrToken}`);
    const data = await res.json();
    if (data.is_used) {
        document.getElementById("status").innerText = "✅ 已掃描登入成功！";
        setTimeout(() => window.location.href = "/dashboard", 1500);
    } else if (data.expired) {
        document.getElementById("status").innerText = "⚠️ QR Code 已過期，重新載入中...";
        await fetchQR();
    }
    */
}

document.addEventListener("DOMContentLoaded", () => {

    // let close_msg = null;
    // let open_msg = null;

    // fetch("/api/auth/lang/zh")
    // .then(res => res.json())
    // .then(dict => {
    //     close_msg = dict.close_msg;
    //     open_msg = dict.open_msg;
    //});

    /*
    if (resetBtn) {
        resetBtn.addEventListener("click", () => {
            scannedContent = null;
            resultDiv.innerText = "";
            startCamera();
        });
    }
    */

    /*
    if (patient_tab) {
        patient_tab.addEventListener("click", () => {
            resultDiv.innerText = "";
            scannedContent = null;
            startCamera();
        });
    }
    */

        console.log(`patient_div.classList: ${patient_div.classList}`);
        console.log(`professor_div.classList: ${professor_div.classList}`);

        if (patient_div && !patient_div.classList.contains("hidden")) {
            console.log(`patientForm event`);

            setInterval(() => {
                countdown--;
                if (countdown <= 0) {
                    document.getElementById("countdown").innerText = `QR Code 將於 0s 後更新`;
                    loadQRCode();
                } else {
                    document.getElementById("countdown").innerText = `QR Code 將於 ${countdown}s 後更新`;
                }
            }, 1000);

            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const code = jsQR(imageData.data, imageData.width, imageData.height);
            
            loadQRCode();

            if (code) {
                const scannedToken = code.data;
            
                fetch("/api/auth/scan_result", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ qrContent: scannedToken })
                })
                .then(res => res.json())
                .then(data => {
                    if (data.success) {
                        window.location.href = "/api/auth/dashboard";
                    } else {
                        alert(data.message);
                    }
                });
            }
        }

        if (professor_div && !professor_div.classList.contains("hidden")) {
            professorForm.addEventListener("submit", async (e) => {
                console.log(`professorForm event`);
                e.preventDefault();

                const formData = new FormData(professorForm);
                const body = Object.fromEntries(formData.entries());

                try {
                    const res = await fetch("/api/auth/sign-in", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(body),
                    });
                    
                    const data = await res.json();

                    if (!data.success) {
                        showModal(`登入失敗: ${data.message}`);
                        return;
                    }

                    console.log(`data.user.token: ${data.user.token}`);
                    window.location.href = `/api/auth/dashboard?token=${data.user.token}`;
                    
                } catch (err) {
                    showModal(`伺服器錯誤: ${err.message}`);
                }
            });
        }
});