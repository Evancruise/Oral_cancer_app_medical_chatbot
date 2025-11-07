import fs from "fs";
import path from "path";
import multer from "multer";
import { Storage } from "@google-cloud/storage";
import dotenv from "dotenv";

dotenv.config();

// ======================
// 基本設定
// ======================
const __dirname = path.resolve();
const localUploadDir = path.join(__dirname, "client/tmp/public/uploads");

// 確保本地目錄存在
if (process.env.NODE_ENV === "development") {
  fs.mkdirSync(localUploadDir, { recursive: true });
}

// Cloud Storage 初始化（生產環境用）
const storage = new Storage({
  projectId: process.env.GCP_PROJECT_ID,
});
const bucket = storage.bucket(process.env.GCS_BUCKET_NAME);

// Multer 暫存上傳位置（本地暫存或 /tmp）
const upload = multer({
  dest: process.env.NODE_ENV === "development" ? localUploadDir : "/tmp",
});

// ======================
// Express Handler
// ======================
export const temp_upload = [
  upload.single("file"),

  async (req, res) => {
    try {
      const file = req.file;
      const patientId = req.body.patient_id || "unknown";
      const code = req.body.code || "x";

      if (!file) {
        return res.status(400).json({ success: false, message: "No file uploaded" });
      }

      // ============================================
      // 開發環境：存本地 (client/tmp/public/uploads)
      // ============================================
      if (process.env.NODE_ENV === "development") {
        const filename = `${patientId}_${code}_${file.originalname}`;
        const localPath = path.join(localUploadDir, filename);
        fs.renameSync(file.path, localPath);
        console.log(`📂 [LOCAL UPLOAD] Saved at ${localPath}`);

        return res.json({
          success: true,
          env: "development",
          filename,
          temp_path: `/tmp/public/uploads/${filename}`,
        });
      }

      // ============================================
      // 生產環境：上傳到 GCS Bucket
      // ============================================
      const destPath = `uploads/${patientId}/${code}_${file.originalname}`;
      await bucket.upload(file.path, {
        destination: destPath,
        metadata: {
          cacheControl: "public, max-age=31536000",
        },
      });

      const publicUrl = `https://storage.googleapis.com/${process.env.GCS_BUCKET_NAME}/${destPath}`;
      console.log(`☁️ [GCS UPLOAD] ${publicUrl}`);

      return res.json({
        success: true,
        env: "production",
        filename: file.originalname,
        temp_path: publicUrl,
      });

    } catch (err) {
      console.error("❌ Upload error:", err);
      res.status(500).json({ success: false, message: err.message });
    }
  },
];
