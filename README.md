---
title: Oral Cancer Webapp
sdk: docker
emoji: 🦷
colorFrom: blue
colorTo: yellow
pinned: true
app_file: src/index.js
app_port: 7860
---
# Oral Cancer Web Application
This is a full-stack QR-enabled medical imaging web app deployed on Hugging Face Spaces (Docker).

- Backend: AI API

# Model pipeline
[1] Environment & Setup
[2] Dataset Path & Config
[3] Load Dataset (train / val / test)
[4] Build Model (DINOv3 Student + optional Teacher)
[5] (Optional) Build / Load Retriever Index
[6] Training Loop
[7] Save Weights
[8] Student-only Inference
[9] Results → FHIR Bundle
[10] Export Artifacts

# Preprocessing

## Split datasets into train/val/test sets
python split_fhir_dataset.py

## Convert json into FHIR format
cd utils/dataset/all
python generate_annot.py

## Start training
python main.py --phase train --train_annotations=./utils/dataset/train --val_annotations=./utils/dataset/val --test_annotations=./utils/dataset/test

## Start Inferencing
python main.py --phase inference --train_annotations=./utils/dataset/train --val_annotations=./utils/dataset/val --test_annotations=./utils/dataset/test

- Front-end: Android Layout

UI Layer
──────────
LoginScreen
LoginActivity
LoginViewModel
      ↓
Data Layer
──────────
AuthRepository   ←── loginWithLine()
AuthApi (Retrofit)
      ↓
Backend
──────────
POST /auth/sign-in-line

# Cloud Build Architecture

## 整體系統架構

            ┌────────────────────┐
            │   醫師 / 使用者     │
            │  (LINE App / Web)  │ [使用者介面]
            └─────────┬──────────┘
                      │ 上傳影像 / 查詢結果
                      ▼
            ┌──────────────────────────────────────────┐
            │           LINE Bot / Web Backend         │
            │  (Auth / 使用者管理): 身分驗證、權限控管    │
            │                 Supabase Auth            │
            └─────────┬────────────────────────────────┘
                      │ REST API
                      ▼
            ┌────────────────────────────────────┐
            │   AI 推論服務 (Cloud Run)           │
            │   Flask API                         │
            │   - bbox + segmentation             │
            │   - 無狀態設計                      │
            └─────────┬──────────────────────────┘
                      │ 非同步任務
                      ▼
            ┌──────────────────────────┐
            │   Cloud Tasks (任務佇列)  │
            │   - 重試機制              │
            │   - 速率限制              │
            └─────────┬────────────────┘
                      ▼
      ┌────────────────────────────────────┐
      │   AI 推論 Worker (Cloud Run)        │
      │   - GPU / CPU                       │
      │   - DINOv3 模型                     │
      └─────────┬───────────┬──────────────┘
                │            │
                │            │
                ▼            ▼
      ┌──────────────┐   ┌────────────────┐
      │   GCS        │   │ Firebase       │ 
      │  (影像/結果)  │   │ (即時狀態通知)  │
      └──────────────┘   └────────────────┘
                │
                ▼
      ┌──────────────────────────┐
      │ Supabase (PostgreSQL)    │
      │ - 病例紀錄                │
      | - 主資料庫: 病例、結果索引 |
      │ - 推論 metadata          │
      │ - 可稽核紀錄              │
      └──────────────────────────┘

## 整體架構細項

| 系統                             | 用來做什麼                       | 為什麼                       | 注意
| ------------------------------- | -------------------------------- | --------------------------- | -------------------------
| **Supabase (Postgres)**         | 使用者 / Case / 推論結果 metadata | 關聯式、可 SQL、醫療資料好查   | Supabase 才是「永久紀錄」
| **Firebase (Firestore / RTDB)** | job 狀態、即時通知                | 即時性、前端監聽方便           | Firestore 只存「即時狀態」
| **GCS**                         | 影像 / mask / overlay / JSON     | 大檔案、便宜、可靠             |
| **Cloud Tasks**                 | 非同步推論排程                    | retry / rate limit           |
| **Cloud Run**                   | AI 推論服務                      | GPU / auto-scale              |
| **LINE Bot**                    | 使用者入口                       | 醫師最熟的介面                 |

GCP 負責「算」
Supabase 負責「記」
Firebase 負責「通知」
LINE 負責「入口」

# IAM 權限 
## Cloud Run Service Account
gcloud run services describe oral-dino-api \
  --region asia-east1 \
  --format='value(spec.template.spec.serviceAccountName)'

## 給它 GCS 讀取權限
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:YOUR_SA_EMAIL" \
  --role="roles/storage.objectViewer"

# Cloud Run 部署方式
## CPU version
Build & Deploy
gcloud run deploy oral-dino-api \
  --source . \
  --region asia-east1 \
  --platform managed \
  --allow-unauthenticated \
  --memory 8Gi \
  --cpu 2

## GPU version
gcloud run deploy oral-dino-api \
  --source . \
  --region asia-east1 \
  --gpu 1 \
  --gpu-type nvidia-l4 \
  --memory 16Gi \
  --cpu 4

# 實際推論 Cloud Tasks - Cloud Tasks Async Inference 架構（核心設計）

Client
  │
  │ POST /infer/async   (upload image)
  ▼
Cloud Run (API)
  ├─ 1. image → GCS
  ├─ 2. create job_id
  ├─ 3. enqueue Cloud Task
  ├─ 4. return job_id
  ▼
Cloud Tasks
  │
  │ POST /tasks/infer   (background) 
  | Command: gcloud tasks queues create oral-infer-queue --location=asia-east1
  ▼
Cloud Run (Worker endpoint)
  ├─ load image from GCS
  ├─ run bbox / seg inference
  ├─ save result to GCS / Firestore
  └─ update job status = DONE

## 資料結構設計

Firestore（Job 狀態）
jobs/{job_id} {
  "status": "PENDING" | "RUNNING" | "DONE" | "FAILED",
  "task_type": "bbox" | "seg",
  "input_image": "gs://oral-images/uploads/xxx.png",
  "result_path": "gs://oral-images/outputs/xxx.json",
  "created_at": "...",
  "updated_at": "..."
}

## Async inference = 雲端任務排程 + 狀態機

## Step 1：新增 async API（Client 呼叫的）
- 收 request
- 存 image
- enqueue 任務

## Step 2: Cloud Tasks Worker Endpoint（真正 inference）
- 真正跑模型的地方
- command: gcloud tasks queues create oral-infer-queue --location=asia-east1

## Step 3：查詢結果 API（Client 輪詢）

1) Pipeline 設計：一個 Job → 一個 Task → 同時產出 bbox + seg

流程

1. Client POST /infer/async_all 上傳單張圖片
2. Cloud Run：

- 圖片存到 GCS：images/uploads/{job_id}.png
- Firestore 建 job：status=PENDING
- enqueue Cloud Task：打到 /tasks/infer_all（同一個 task 做 bbox+seg）
- 回傳 job_id

3. Cloud Task 觸發 Cloud Run worker endpoint /tasks/infer_all

- Firestore status=RUNNING
- 從 GCS 下載圖片
- 同時跑 bbox + seg
- 結果寫回 GCS（JSON + overlay PNG 可選）
- Firestore status=DONE + result paths

4. Client GET /infer/status/<job_id> 看進度/取結果路徑

'''
Firestore Job schema（建議）

jobs/{job_id}：

{
  "status": "PENDING|RUNNING|DONE|FAILED",
  "input_image": "gs://<bucket>/images/uploads/<job_id>.png",
  "bbox_result_json": "gs://<bucket>/outputs/<job_id>_bbox.json",
  "seg_result_json": "gs://<bucket>/outputs/<job_id>_seg.json",
  "overlay_png": "gs://<bucket>/outputs/<job_id>_overlay.png",
  "error": "...",
  "created_at": "...",
  "updated_at": "..."
}
'''

2) Cloud Tasks Retry / Rate limit 設計

# A) Queue rate limit（吞吐與併發控制）

max-dispatches-per-second：每秒最多派送幾個 task（QPS）
max-concurrent-dispatches：同時最多幾個 task 在跑

# 初始化 queue
gcloud tasks queues create oral-infer-queue \
  --location=asia-east1 \
  --max-dispatches-per-second=2 \
  --max-concurrent-dispatches=4

# 更新 queue
gcloud tasks queues update oral-infer-queue \
  --location=asia-east1 \
  --max-dispatches-per-second=2 \
  --max-concurrent-dispatches=4

# B) Retry config（失敗重試策略）

max-attempts：最多嘗試次數（含第一次）
min-backoff：最小退避時間
max-backoff：最大退避時間
max-doublings：退避倍增次數（指數退避）

gcloud tasks queues update oral-infer-queue \
  --location=asia-east1 \
  --max-attempts=10 \
  --min-backoff=5s \
  --max-backoff=300s \
  --max-doublings=5

# 資料流說明（IRB 必備）

## 1) 影像上傳

醫師透過 LINE 或 Web 上傳影像
影像 直接存入 GCS
不在前端或 API server 長期保存

## 2) 非同步 AI 推論

系統建立 推論任務（Job ID）
Cloud Tasks 排程推論
避免同時大量請求導致系統不穩定

## 3) AI 分析結果

產出：
Bounding Box（病灶位置）
Segmentation Mask（病灶區域）
結果以檔案形式存於 GCS
Supabase 僅存 索引與 metadata

## 4) 通知與查詢

Firebase 即時通知推論完成
醫師可隨時查詢歷史案例

# 資料安全與隱私設計（醫院最在意）
## 1) 資料安全原則
- 最小權限原則（Least Privilege）
- AI 服務無法存取病患身分資訊
- 使用 Service Account 控管存取

## 2) 資料分離設計
類型        儲存位置    備註
原始影像	GCS	      僅限後端存取
AI 結果	GCS	      不含個資
病例資料	Supabase	可控存取
即時狀態	Firebase	不存影像

## 3) 可稽核性（IRB 加分項）

- 每筆推論有 Job ID、時間戳記、模型版本
- 可回溯：使用哪個模型、哪次推論產生結果
- 符合：IRB 研究追蹤需求、醫院內部審核流程

# 系統擴充性

## 可擴充方向

多模型（不同癌別）
多院區部署
模型版本 A/B test
GPU scale up / down

## 成本控制

非同步推論避免浪費資源
只有需要時才啟動推論
GCS 儲存成本低、可分級保存

# Build & Run

## Frontend Part



## Backend Part

## 1) Build Docker
docker build -t oral-dino-api .
## 2) Run Docker 
* Typical use
```
docker run -p 5000:5000 oral-dino-api
```
* Volume (For production case)
```
docker run -p 5000:5000 \
  -v $(pwd)/checkpoints:/app/checkpoints \
  oral-dino-api
```
* Cloud Storage (GCS): container 啟動時下載 -> 適合 Cloud Run / K8s

# Deployment

## Frontend Part

# 方案A: Cloud Run
https://frontend.run.app/result

# 方案B: Firebase Hosting（最適合 LIFF）

## 部署流程
```
npm run build
firebase init hosting
firebase deploy --only hosting
```
最終網址: https://your-project.web.app/result?job_id=abc123 or https://your-project.firebaseapp.com/result

## Backend Part

# 測試部署
LINE → ngrok → localhost:3000/api/line

# 正式部署
```
gcloud run deploy oral-dino-flask \
  --source . \
  --region asia-east1 \
  --allow-unauthenticated
```
執行完之後 Cloud Run 會給你一個 URL，例如： https://oral-dino-api-abc123-uc.a.run.app
然後你在 LINE 模組的環境變數 設定： AI_INFER_API=https://oral-dino-api-abc123-uc.a.run.app

## 重要事項
# 1) 權限設定

Flask AI API：僅允許 LINE backend service account
LINE backend：對 LINE 平台開放

# 2) 權責分際

【LINE Backend（Node.js）】
- /api/line (基本路由)
- 寫 Firestore job
- 呼叫 AI API
- LINE reply / push

【AI Backend（Flask / Cloud Run）】
- /infer/async_all
- bbox + seg inference
- 更新 Firestore job

【Firebase Hosting + LIFF（前端）】
- /result
- 讀 Firestore
- 顯示 bbox + seg

元件               能不能寫這個 route   原因
Firebase Hosting	❌ 不行	          只能放靜態檔案
Firebase Functions (HTTP)	✅ 可以	  可處理 webhook
Cloud Run（Node.js）	✅ 可以	      完整後端
