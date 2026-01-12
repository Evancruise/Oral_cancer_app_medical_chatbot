import express from "express";
import * as line from "@line/bot-sdk";
import axios from "axios";
import OpenAI from "openai";
import FormData from "form-data";
import admin from "firebase-admin";
import functions from "firebase-functions";
import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
// import { getLineConfig } from "./line_modules.js";
import { buildFlexProcessing, buildFlexDone, buildFlexDoneWithHero } from "./flex_modules.js";
import { getAIResponse } from "./openai_modules.js";
import * as logger from "firebase-functions/logger";

let openai = null;
let db = null;

const config = functions.config();
const secrets = {
  lineToken: config.line.channel_access_token,
  lineSecret: config.line.channel_secret,
  openaiKey: config.line.openai_api_key,
  aiInferAPI: config.line.ai_infer_api
};

const middlewareConfig = { channelSecret: secrets.lineSecret };
const router = express.Router();

router.post(
    "/",
    line.middleware(middlewareConfig),
    async (req, res) => {
        // res.sendStatus(200);

        const client = new line.messagingApi.MessagingApiClient({
            channelAccessToken: secrets.lineToken,
        });

        const events = req.body.events || [];

        for (const event of events) {

            console.log("LINE event channelId:", event?.source?.userId);

            console.log("LINE event:", {
                userId: event.source?.userId,
                type: event.type,
                timestamp: event.timestamp,
            });

            if (event.type !== "message") continue;

            const { replyToken } = event;
            const userId = event.source?.userId;

            if (!userId || !replyToken) continue;

            // cold start
            verifyLineToken(secrets.lineToken)
            .then(info => {
                console.log("LINE Bot verified:", info.basicId, info.displayName);
            })
            .catch(err => {
                console.error("LINE token verification failed");
            });

            // Case 1: 圖片訊息 (AI 推論)
            if (event.message.type === "image") {
                try {
                    // 下載圖片
                    const imgRes = await axios.get(
                        `https://api-data.line.me/v2/bot/message/${event.message.id}/content`,
                        {
                            headers: {
                                Authorization: `Bearer ${secrets.lineToken}`,
                            },
                            responseType: "arraybuffer",
                        }
                    );

                    console.log("img size:", imgRes.data.length);

                    // 呼叫 AI inference API
                    const form = new FormData();
                    form.append("image", Buffer.from(imgRes.data), {
                        filename: "upload.png",
                        contentType: "image/png",
                    });

                    const aiRes = await axios.post(
                        // `${secrets.aiInferAPI}/infer/async_all`,
                        `${secrets.aiInferAPI}/infer/async`,
                        form,
                        {
                            headers: form.getHeaders(),
                            timeout: 60000
                        }
                    );

                    const { job_id } = aiRes.data;

                    db = getAdminDB();

                    // 建立 Firestore job (狀態機)
                    await db.collection("jobs").doc(job_id).set({
                        job_id,
                        line_user_id: userId,
                        status: "PENDING",
                        notified: false,
                        created_at: admin.firestore.FieldValue.serverTimestamp(),
                        updated_at: admin.firestore.FieldValue.serverTimestamp(),
                    });

                    // 回 LINE (帶 Firebase Hosting 結果圖)
                    const resultUrl = `https://oral-cancer-line-fronted-web.web.app/?job_id=${job_id}`;

                    await client.replyMessage({
                        replyToken,
                        messages: [
                            /*
                            {
                                type: "text",
                                text:
                                `🧠 已收到影像，AI 分析中。完成後會主動通知你。\n👉 分析結果頁：${resultUrl}`,
                            },
                            */
                            buildFlexProcessing({ jobId: job_id, resultUrl })
                        ],
                    });                    
                } catch (err) {
                   console.error("Image inference error: ", err);
                   await client.replyMessage({
                       replyToken,
                       messages: [{ type: "text", text: "影像處理失敗，請稍後再試"}],
                   });
                }
                continue;
            }

            if (event.message.type === "text") {
                const userMessage = event.message.text.trim();
                openai = getOpenAI();

                try {
                    // 調用 OpenAI 進行對話，並使用通知 function tool
                    const aiResponse = await getAIResponse(openai, userMessage);

                    console.log("aiResponse:", aiResponse);

                    console.log(
                        "LINE token length:",
                        secrets.lineToken?.length
                    );

                    console.log(
                        "Using LINE token prefix:",
                        secrets.lineToken.slice(0, 10)
                    );

                    // 回覆訊息給使用者
                    await client.replyMessage({
                        replyToken: replyToken,
                        messages: [{
                            type: 'text',
                            text: aiResponse
                        }],
                    });

                    console.log('成功回覆訊息');
                } catch (error) {
                    console.error('處理 AI 回應時發生錯誤:', error);
                    await client.replyMessage({
                        replyToken: replyToken,
                        messages: [{
                            type: 'text',
                            text: '抱歉，我現在有點忙，請稍後再試'
                        }]
                    });
                }
            }

            return res.sendStatus(200);
        }
    }
);

export async function callFlaskRefreshAPI(jobId) {
    const res = await axios.post(
        `${secrets.aiInferAPI}/infer/refresh_signed_url`,
        { job_id: jobId },
        { timeout: 10000 }
    );

    return res.data;
}

export function getOpenAI() {

    if (!global.openaiClient) {
        global.openaiClient = new OpenAI({
            apiKey: secrets.openaiKey,
        });
    }

    return global.openaiClient;
}

/*
 * Periodic updating url function for GCS
 */
export const refreshSignedUrl = onSchedule(
    "every 10 minutes",
    async () => {
        const now = new Date();

        const snapshot = await db
            .collection("jobs")
            .where("status", "==", "DONE")
            .where("url_expire_at", "<", new Date(now.getTime() + 5 * 60 * 1000))
            .get();
        
        for (const doc of snapshot.docs) {
            const job = doc.date();
            const { signed_url, expire_at } = await callFlaskRefreshAPI(job.overlay_gcs_path);

            await doc.ref.update({
                overlay_signed_url: signed_url,
                overlay_url_expire_at: new Date(expire_at),
            });
        }
    }
);

/*
 * Event-triggerred Line Propagate function
 */
export const notifyJobDone = onDocumentUpdated(
    "jobs/{jobId}",
    async (event) => {
        const before = event.data.before.data();
        const after = event.data.after.data();
        const jobId = event.params.jobId;
        
        logger.info(`!before || !after`);
        if (!before || !after) return;

        // 只處理 DONE / FAILED
        logger.info(`DONE / FAILED case`);
        if (!["DONE", "FAILED"].includes(after.status)) {
            return;
        }

        // 防止重複通知
        logger.info(`repetitive propagation`);
        if (after.notified === true) {
            logger.info(`[notifyDone] Job ${jobId} already notified`);
            return;
        }

        // 必要欄位檢查
        logger.info(`after.line_user_id check`);
        if (!after.line_user_id) {
            logger.error(`[notifyJobDone] Missing line_user_id for job ${jobId}`);
            return;
        }

        logger.info(`Showing flex message to imply status`);
        const resultUrl = `https://oral-cancer-line-fronted-web.web.app/?job_id=${jobId}`;

        logger.info(`[notifyJobDone] Ready to push LINE`, {
            jobId,
            status: after.status
        });

        try {
            // ---- DONE case ----
            if (after.status === "DONE") {
                const summary = after.summary || {};
                const overlayUrl = after.overlay_png;

                const flexMessage = overlayUrl 
                  ? buildFlexDoneWithHero({
                        jobId,
                        resultUrl,
                        summary,
                        signedOverlayUrl: overlayUrl
                    })
                  : buildFlexDone({
                    jobId,
                    resultUrl,
                    summary
                  });
                
                await client.pushMessage({
                    to: after.line_user_id,
                    messages: [flexMessage],
                });

                logger.info(`[notifyJobDone] DONE push sent for job ${jobId}`);
            }

            // ---- FAILED case ----
            if (after.status === "FAILED") {
                await client.pushMessage({
                    to: after.line_user_id,
                    messages: [
                        {
                            type: "text",
                            text: `⚠️ AI 分析失敗\n請稍後重新嘗試，或聯絡管理人員。`
                        }
                    ],
                });

                logger.warn(`[notifyJobDone] FAILED push sent for job ${jobId}`);
            }

            // ---- 標記已通知 (idempotency) ----
            await event.data.after.ref.update({
                notified: true,
                notified_at: new Date()
            });
        } catch (err) {
            logger.error(
                `[notifyJobDone] Push failed for job ${jobId}`,
                err
            );
        }
    }
);

export function getAdminDB() {
    if (!admin.apps.length) {
        admin.initializeApp();
    }
    
    console.log("Node Firestore project:", admin.app().options.projectId);
    return admin.firestore();
}

async function verifyLineToken(token) {
  const res = await axios.get(
    "https://api.line.me/v2/bot/info",
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );
  return res.data;
}

export default router;