import express from "express";
import axios from "axios";
import FormData from "form-data";
import admin from "firebase-admin";
import { Storage } from "@google-cloud/storage";
import {
    liff_toppage,
    link_line_account,
    webhook_entry,
    login_line,
    lineMobileLogin,
    lineMobileCallback
} from "#controllers/api/line.controller.js";

admin.initializeApp();
const db = admin.firestore();

const storage = new Storage();
const router = express.Router();

const {
    LINE_CHANNEL_SECRET,
    LINE_CHANNEL_ACCESS_TOKEN,
    AI_INFER_API, // Cloud Run URL, e.g., https://oral-dino-api-xxx.run.app
} = process.env;

/**
 * 
 */
router.post("/webhook", (req, res) => {
  console.log("LINE webhook:", req.body);
  res.sendStatus(200);
});

router.post("/", async (req, res) => {
    // Verify signature
    if (!verifyLineSignature(req)) {
        return res.status(401).send("Invalid signature");
    }

    const event = req.body.events[0];
    const { type } = event;

    // Handle image message
    if (type === "message" && event.message.type === "image") {
        const userId = event.source.userId;
        const replyToken = event.replyToken;
        const messageId = event.message.id;

        // ---- download image from LINE ----
        const imgRes = await axios.get(
            `https://api-data.line.me/v2/bot/message/${messageId}/content`,
            {
                headers: {
                    Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
                },
                responseType: "arraybuffer",
            }
        );

        // ---- send image to AI inference API ----
        const form = new FormData();
        form.append("image", Buffer.from(imgRes.data), {
            filename: "upload.png",
            contentType: "image/png",
        });

        const aiRes = await axios.post(
            `${AI_INFER_API}/infer/async_all`,
            form,
            { headers: form.getHeaders() }
        );

        const { job_id } = aiRes.data;
        
        await db.collection("jobs").doc(job_id).set({
          job_id,
          line_user_id: userId,              // ⭐ 非常重要
          status: "PENDING",
          input_image: null,                 // AI 端補
          notified: false,
          created_at: admin.firestore.FieldValue.serverTimestamp(),
          updated_at: admin.firestore.FieldValue.serverTimestamp(),
        });

        // ---- immediate reply ----
        await replyMessage(replyToken, [
            {
                type: "text",
                text: `AI 分析中，請稍後...`,
            }
        ]);

        return res.sendStatus(200);
    }

    // fallback
    res.sendStatus(200);
});

router.get("/:jobId", async (req, res) => {
    const { jobId } = req.params;

    const doc = await db.collection("jobs").doc(jobId).get();
    if (!doc.exists) {
      return res.status(404).json({ error: "Job not found" });
    }

    const job = doc.data();

    if (job.status !== "DONE") {
      return res.json({
        status: job.status,
        message: "AI 分析尚未完成",
      });
    }

    return res.json({
      status: "DONE",
      bbox_result: job.bbox_result_json,
      seg_result: job.seg_result_json,
      overlay_png: job.overlay_png,
    });
});

export async function getSignedUrl(gcsPath) {
  const [bucketName, ...rest] = gcsPath.replace("gs://", "").split("/");
  const filePath = rest.join("/");

  const [url] = await storage
    .bucket(bucketName)
    .file(filePath)
    .getSignedUrl({
      version: "v4",
      action: "read",
      expires: Date.now() + 10 * 60 * 1000 // 10 分鐘
    });

  return url;
}

router.post("/link-user", 
  /*
    #swagger.tags = ['LINE']
    #swagger.summary = 'Link LINE account'
    #swagger.description = 'Link a LINE account to the authenticated user using Authorization Bearer token'

    #swagger.security = [{
      "bearerAuth": []
    }]

    #swagger.requestBody = {
      required: true,
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              display_name: {
                type: "string",
                example: "Evan Chang"
              }
            }
          }
        }
      }
    }

    #swagger.responses[200] = {
      description: "LINE account linked successfully",
      schema: {
        success: true,
        message: "LINE account linked successfully",
        data: {
          user_id: "12345",
          display_name: "Evan Chang"
        }
      }
    }

    #swagger.responses[401] = {
      description: "Unauthorized - missing token",
      schema: { success: false, message: "Unauthorized - missing user info" }
    }

    #swagger.responses[500] = {
      description: "Failed to link LINE account",
      schema: { success: false, message: "Failed to link LINE account" }
    }
  */
  link_line_account
);

router.get("/liff_toppage", 
  /*
    #swagger.tags = ['LINE']
    #swagger.summary = 'Load LIFF App Configuration'
    #swagger.description = 'Returns LIFF ID and login URL for LINE login / LIFF page access.'
    
    #swagger.responses[200] = {
      description: "LIFF configuration loaded successfully",
      schema: {
        success: true,
        message: "LIFF configuration loaded successfully",
        data: {
          liffId: "1657123456-abcXYZ",
          loginUrl: "https://liff.line.me/1657123456-abcXYZ"
        }
      }
    }

    #swagger.responses[500] = {
      description: "LIFF ID missing or configuration error",
      schema: {
        success: false,
        message: "Failed to load LIFF config",
        error: "LIFF ID not configured"
      }
    }
  */
  liff_toppage
);

router.post("/webhook", 
  /*
    #swagger.tags = ['LINE']
    #swagger.summary = 'LINE Webhook endpoint'
    #swagger.description = '接收來自 LINE Messaging API 的 Webhook 事件 (push / reply)。當收到 "menu" 訊息時，回傳 LIFF Flex Message。此 endpoint 無法使用 Postman 主動測試，需透過 LINE Webhook 驅動。'

    #swagger.requestBody = {
      required: true,
      content: {
        "application/json": {
          schema: {
            type: 'object',
            properties: {
              events: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    replyToken: { type: 'string', example: 'f4b18d6b8d934fd58084f220b2c2ab30' },
                    type: { type: 'string', example: 'message' },
                    source: {
                      type: 'object',
                      example: { userId: 'U1234567890', type: 'user' }
                    },
                    message: {
                      type: 'object',
                      properties: {
                        type: { type: 'string', example: 'text' },
                        text: { type: 'string', example: 'menu' }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }

    #swagger.responses[200] = {
      description: 'Webhook processed successfully',
      schema: {
        success: true,
        message: 'Webhook processed'
      }
    }

    #swagger.responses[500] = {
      description: 'Failed to process webhook',
      schema: {
        success: false,
        message: 'Webhook processing failed',
        error: 'Detailed error message'
      }
    }
  */
  webhook_entry
);

router.post("/login_line", 
  /*
    #swagger.tags = ['LINE']
    #swagger.summary = 'LINE Login (Create or Login User via LINE)'
    #swagger.description = '使用 line_user_id 執行 LINE 登入。若為新使用者則自動建立，否則直接回傳 JWT 與使用者資料。'

    #swagger.requestBody = {
      required: true,
      content: {
        "application/json": {
          schema: {
            type: 'object',
            properties: {
              name: { type: 'string', example: 'Evan Lin' },
              line_user_id: { type: 'string', example: 'Ua123456789abcd' }
            }
          }
        }
      }
    }

    #swagger.responses[200] = {
      description: 'LINE login successful',
      schema: {
        success: true,
        message: 'LINE login successful',
        data: {
          token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
          user: {
            id: 17,
            name: 'Evan Lin',
            email: 'Ua123456789abcd@line-login.local',
            login_role: 'tester',
            provider: 'line'
          },
          nextAction: {
            type: 'navigate',
            path: '/dashboard'
          }
        }
      }
    }

    #swagger.responses[400] = {
      description: 'Missing line_user_id',
      schema: { success: false, message: 'Missing line_user_id' }
    }

    #swagger.responses[500] = {
      description: 'Server error during LINE login',
      schema: { success: false, message: 'LINE login failed', error: 'error message' }
    }
  */
  login_line
);

router.get("/mobile/login", lineMobileLogin);
router.get("/mobile/callback", lineMobileCallback);

export default router;