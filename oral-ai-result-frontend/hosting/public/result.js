import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// Firebase config
const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_PROJECT.firebaseapp.com",
    projectId: "YOUR_PROJECT_ID"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const statusEl = document.getElementById("status");
const imgEl = document.getElementById("resultImg");

// 取得 job_id
const param = new URLSearchParams(window.location.search);
const jobId = URLSearchParams.get("job_id");

if (!jobId) {
    statusEl.innerText = "缺少 job_id";
    throw new Error("Missing job_id");
}

// 讀 Firestore
async function loadResult() {
    const snap = await getDoc(doc(db, "jobs", jobId));

    if (!snap.exists()) {
        statusEl.innerText = "找不到分析紀錄";
        return;
    }

    const job = snap.data();

    if (job.status !== "DONE") {
        statusEl.innerText = "AI 分析中，請稍後...";
        setTimeout(loadResult, 3000);
        return;
    }

    statusEl.innerText = "分析完成";

    // 後端產生的 signed URL
    imgEl.src = job.overlay_png;
    imgEl.style.display = "block";
}

loadResult();
