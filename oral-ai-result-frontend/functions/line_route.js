import express from "express";
import * as line from "@line/bot-sdk";
import axios from "axios";
import OpenAI from "openai";
import FormData from "form-data";
import admin from "firebase-admin";
import functions from "firebase-functions";
import { getLineConfig } from "./line_modules.js";
import { buildFlexProcessing } from "./flex_modules.js";
import { getAIResponse } from "./openai_modules.js";

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
        res.sendStatus(200);
        
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
                        // `${process.env.AI_INFER_API}/infer/async_all`,
                        `${secrets.aiInferAPI}/infer/async_all`,
                        form,
                        { headers: form.getHeaders()}
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
                            {
                                type: "text",
                                text:
                                `🧠 已收到影像，AI 分析中…
                                完成後會主動通知你。
                                👉 分析結果頁：
                                ${resultUrl}
                                `,
                            },
                            // buildFlexProcessing({ jobId: job_id, resultUrl })
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
        }
    }
);

export function getOpenAI() {

    if (!global.openaiClient) {
        global.openaiClient = new OpenAI({
            apiKey: secrets.openaiKey,
        });
    }

    return global.openaiClient;
}

export function getAdminDB() {
    if (!admin.apps.length) {
        admin.initializeApp();
    }
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