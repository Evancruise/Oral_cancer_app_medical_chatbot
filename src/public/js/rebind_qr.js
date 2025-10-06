const img = document.getElementById("qr-image");
const reload_btn = document.getElementById("reload-btn");
const scan_btn = document.getElementById("btn-toggle-scanner");
const scanner_result = document.getElementById("send-scan-btn");
const video = document.getElementById("camera");
const canvas = document.getElementById("snapshot");
const reset_btn = document.getElementById("send-scan-btn-recap");
let scannedContent = null;
let stream = null;
let scanning = false;

document.addEventListener("DOMContentLoaded", () => {

    let close_msg = null;
    let open_msg = null;

    fetch("/api/auth/lang/zh")
    .then(res => res.json())
    .then(dict => {
        close_msg = dict.close_msg;
        open_msg = dict.open_msg;
    });

    // 倒數刷新 QR
    if (reload_btn) {
        let count = 30;
        setInterval(() => {
            if (count <= 0) {
                img.src = "/api/auth/rebind-qr?ts=" + Date.now();
                count = 30;
            }
            count--;
            document.getElementById("countdown").innerText = count;
        }, 1000);

        reload_btn.addEventListener("click", () => {
            img.src = "/api/auth/rebind-qr?ts=" + Date.now(); // 防止快取
            count = 30;
        });
    }

    // 開/關掃描器按鈕
    if (scan_btn) {
        scan_btn.addEventListener("click", async (e) => {
            const container = document.getElementById("scanner-container");
            const btn = e.target;
            if (container.style.display === "none") {
                container.style.display = "block";
                btn.textContent = close_msg;
                startCamera();
            } else {
                container.style.display = "none";
                btn.textContent = open_msg;
                stopCamera();
            }
        });
    }

    // Reset 重新啟動相機
    if (reset_btn) {
        reset_btn.addEventListener("click", async (e) => {
            scannedContent = null;
            document.getElementById("scan-result").innerText = "";
            startCamera();
        });
    }

    // scanner_result (送出掃描結果)
    if (scanner_result) {
        scanner_result.addEventListener("click", async (e) => {
            e.preventDefault();
            if (!scannedContent) {
                alert("尚未掃描到 QR Code！");
                return;
            }
            const res = await fetch('/api/auth/scan_result', {
                method: 'POST',
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ qrContent: scannedContent }),
            });
            const data = await res.json();
            document.getElementById("scan-result").innerText = data.message;
        });
    }
});

// 啟動相機並開始掃描
async function startCamera() {
    try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        video.srcObject = stream;
        video.setAttribute("playsinline", true);
        scanning = true;
        video.play();
        requestAnimationFrame(scanQRCode);
    } catch (err) {
        console.error("Error accessing camera:", err);
    }
}

// 掃描 QR Code
function scanQRCode() {
    if (!scanning) return;

    if (video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: "dontInvert",
        });

        if (code) {
            console.log("QR Code Detected:", code.data);
            scannedContent = code.data;
            document.getElementById("scan-result").innerText = `✅ ${code.data}`;
            stopCamera(); // 掃到一次就停止相機
            return;
        }
    }
    requestAnimationFrame(scanQRCode);
}

// 停止相機
function stopCamera() {
    scanning = false;
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
        stream = null;
    }
}
