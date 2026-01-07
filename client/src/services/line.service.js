import crypto from "crypto";
import axios from "axios";

const {
    LINE_CHANNEL_SECRET,
    LINE_CHANNEL_ACCESS_TOKEN,
    AI_INFER_API, // Cloud Run URL, e.g., https://oral-dino-api-xxx.run.app
} = process.env;

/**
 * Verify LINE signature
 */
export function verifyLineSignature(req) {
    const signature = req.headers["x-line-signature"];
    const body = req.rawBody;

    const hash = crypto
      .createHmac("sha256", LINE_CHANNEL_SECRET)
      .update(body)
      .digest("base64");
    
    return hash === signature;
}

export async function pollInferenceDoneJobs({
  db,
  pushMessage,
  getSignedUrl,
  liffId,
  frontendBaseUrl
}) {
  const snapshot = await db
    .collection("jobs")
    .where("status", "==", "DONE")
    .where("notified", "==", false)
    .limit(10)
    .get();

  for (const doc of snapshot.docs) {
    const job = doc.data();

    try {
      await handleInferenceDone({
        job,
        pushMessage,
        db,
        getSignedUrl,
        liffId,
        frontendBaseUrl
      });
    } catch (err) {
      console.error("Notify failed:", job.job_id, err);
    }
  }
}

export async function handleInferenceDone({
  job,
  pushMessage,
  db,
  getSignedUrl,
  liffId,
  frontendBaseUrl
}) {
  if (job.notified) return;
  if (!job.line_user_id) {
    console.error("No line_user_id");
    return;
  }

  const summary = job.summary;
  if (!summary) {
    console.error("No summary in job");
    return;
  }

  // 產生短效 Signed URL（例如 10 分鐘）
  const signedOverlayUrl = await getSignedUrl(job.overlay_png);

  const jobId = job.job_id;

  const messages = [
    {
      type: "text",
      text:
      `✅ AI 分析完成
      🔍 初步判讀結果：
      • 疑似病灶：${summary.has_lesion ? "有" : "未發現"}
      • 病灶數量：${summary.num_boxes}
      • 最高信心分數：${summary.max_score.toFixed(2)}

      ⚠️ 本結果僅供輔助參考`
    },
    {
      type: "image",
      originalContentUrl: signedOverlayUrl,
      previewImageUrl: signedOverlayUrl
    },
    {
      type: "template",
      altText: "查看完整結果",
      template: {
        type: "buttons",
        text: "查看完整分析結果",
        actions: [
          {
            type: "uri",
            label: "開啟結果頁",
            uri: `https://liff.line.me/${liffId}?job_id=${jobId}`
          }
        ]
      }
    }
  ];

  await pushMessage(job.line_user_id, messages);

  await db.collection("jobs").doc(jobId).update({
    notified: true,
    notified_at: new Date()
  });
}

/**
 * Reply message to LINE
 */
export async function replyMessage(replyToken, messages) {
    await axios.post(
        "https://api.line.me/v2/bot/message/reply",
        {
            replyToken: replyToken,
            messages: messages,
        },
        {
            headers: {
                Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
                "Content-Type": "application/json",
            },
        }
    );
}

/**
 * Push message (for async result)
 */
export async function pushMessage(userId, messages) {
    await axios.post(
        "https://api.line.me/v2/bot/message/push",
        {
            to: userId,
            messages,
        },
        {
            headers: {
                Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
                "Content-Type": "application/json",
            },
        }
    );
}