// src/config/socketManager.js
import { WebSocketServer } from "ws";
import { redis_publisher, redis_subscriber } from "#config/redisclient.js";
import logger from "./logger.js";

// 使用 Map 儲存 <token, ws> 對應關係
export const activeSockets = new Map();

export function initWebSocket(server) {
    const wss = new WebSocketServer({ server });

    // 訂閱 Redis 頻道
    redis_subscriber.subscribe("qr_auth_notifications", (err) => {
        if (err) logger.error("❌ Redis subscribe failed:", err);
    });

    // 收到 Redis 訊息 → 向本機 WS 廣播
    redis_subscriber.on("message", (channel, message) => {
        if (channel === "qr_auth_notifications") {
        const { qr_token, token } = JSON.parse(message);
        const ws = activeSockets.get(qr_token);
        if (ws && ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({ type: "authenticated", token }));
            activeSockets.delete(qr_token);
            logger.info(`📡 Redis broadcast delivered to WS (${qr_token})`);
        }
        }
    });

    // 處理 WS 連線
    wss.on("connection", (ws) => {
        ws.on("message", (msg) => {
        try {
            const data = JSON.parse(msg.toString());
            if (data.type === "register") {
            activeSockets.set(data.qr_token, ws);
            logger.info(`🔗 WS registered: ${data.qr_token}`);
            }
        } catch (err) {
            logger.error("⚠️ WS message parse error:", err);
        }
        });

        ws.on("close", () => {
        for (const [token, socket] of activeSockets.entries()) {
            if (socket === ws) activeSockets.delete(token);
        }
        });
    });

    logger.info("✅ WebSocket server initialized");
    return wss;
}
