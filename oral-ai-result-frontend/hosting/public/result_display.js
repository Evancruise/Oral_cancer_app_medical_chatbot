import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { 
  getFirestore, 
  doc, 
  onSnapshot 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

console.log("🔥 result_display.js LOADED at", new Date().toISOString());

// Firebase config
const firebaseConfig = {
  apiKey: "AIzaSyBgZcg00FRYL5hvM03PuFNCDJFVrRRqrys",
  authDomain: "oral-cancer-line-fronted-web.firebaseapp.com",
  projectId: "oral-cancer-line-fronted-web",
  storageBucket: "oral-cancer-line-fronted-web.firebasestorage.app",
  messagingSenderId: "859648135508",
  appId: "1:859648135508:web:33028cf2fdb0cfd13778c1"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const statusEl = document.getElementById("status");
const imgEl = document.getElementById("resultImg");

// 取得 job_id
const params = new URLSearchParams(window.location.search);
const jobId = params.get("job_id");
const riskMap = {
  1: "low",
  2: "medium",
  3: "high"
};

if (!jobId) {
  statusEl.innerText = "缺少 job_id";
  throw new Error("Missing job_id");
}

// 🔥 即時監聽 Firestore
const unsub = onSnapshot(doc(db, "jobs", jobId), (snap) => {
    if (!snap.exists()) {
        statusEl.innerText = "找不到分析紀錄";
        return;
    }

    const job = snap.data();

    console.log(`job: ${job}`);

    if (job.status === "PENDING" || job.status === "RUNNING") {
        statusEl.innerText = "🧠 AI 分析中，請稍後...";
        return;
    }

    if (job.status === "FAILED") {
        statusEl.innerText = "❌ AI 分析失敗，請重新嘗試";
        return;
    }

    if (job.status === "DONE") {
        statusEl.innerText = "✅ 分析完成";

        if (job.https_signed_url) {
            imgEl.src = job.https_signed_url;
            imgEl.style.display = "block";
        } else {
            statusEl.innerText = "分析完成，但尚無結果圖";
        }

        updateRiskLevel(job.risk_level);
        updateDiagnosisText(job.diagnosis_text);

        // ✅ 已完成，不再需要監聽
        unsub();
    }
});

function updateRiskLevel(riskValue) {
    // 1. 先移除全部 active
    document.querySelectorAll(".risk-light").forEach(el => {
        el.classList.remove("active");
    });

    // 2. 將數值轉成對應的 level
    const level = {
        1: "low",
        2: "medium",
        3: "high"
    }[riskValue];

    if (!level) return;

    // 3. 找到對應燈號，加上 active
    const target = document.querySelector(
        `.risk-light[data-level="${level}"]`
    );

    if (target) {
        target.classList.add("active");
    }
}

function updateDiagnosisText(text) {
    const textarea = document.querySelector(
        'textarea[name="results"]'
    );
    if (textarea) {
        textarea.value = text || "";
    }
}