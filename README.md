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

# Android Layout

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

# Backend (Model pipeline)

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
