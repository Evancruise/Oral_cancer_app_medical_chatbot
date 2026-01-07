/**
 * 速率限制 Middleware
 * 使用簡單的記憶體快取或 Firestore 來追蹤請求頻率
 */

import admin from "firebase-admin";

// 記憶體快取（適合單一實例，不適合多實例部署）
const requestCache = new Map();

/**
 * 簡單的記憶體速率限制器
 * @param {Object} options 設定選項
 * @param {number} options.windowMs 時間窗口（毫秒），預設 1 分鐘
 * @param {number} options.maxRequests 時間窗口內最大請求數，預設 60
 * @param {Function} options.keyGenerator 產生唯一 key 的函數，預設使用 IP
 */
export function createRateLimiter(options = {}) {
  const {
    windowMs = 60 * 1000, // 1 分鐘
    maxRequests = 60,
    keyGenerator = (req) => req.ip || req.headers["x-forwarded-for"] || "unknown",
  } = options;

  return async (req, res, next) => {
    const key = keyGenerator(req);
    const now = Date.now();

    // 清理過期的記錄
    for (const [k, data] of requestCache.entries()) {
      if (now - data.windowStart > windowMs) {
        requestCache.delete(k);
      }
    }

    // 取得或建立該 key 的記錄
    let record = requestCache.get(key);

    if (!record || now - record.windowStart > windowMs) {
      // 新的時間窗口
      record = {
        windowStart: now,
        count: 0,
      };
      requestCache.set(key, record);
    }

    record.count++;

    // 檢查是否超過限制
    if (record.count > maxRequests) {
      const retryAfter = Math.ceil((windowMs - (now - record.windowStart)) / 1000);
      
      res.status(429).json({
        error: "Too Many Requests",
        message: `請求過於頻繁，請在 ${retryAfter} 秒後再試`,
        retryAfter,
      });
      return;
    }

    // 設定回應標頭
    res.setHeader("X-RateLimit-Limit", maxRequests);
    res.setHeader("X-RateLimit-Remaining", Math.max(0, maxRequests - record.count));
    res.setHeader("X-RateLimit-Reset", new Date(record.windowStart + windowMs).toISOString());

    next();
  };
}

/**
 * 基於 Firestore 的分散式速率限制器（適合多實例部署）
 * @param {Object} options 設定選項
 * @param {number} options.windowMs 時間窗口（毫秒）
 * @param {number} options.maxRequests 最大請求數
 * @param {Function} options.keyGenerator 產生唯一 key 的函數
 * @param {admin.firestore.Firestore} options.db Firestore 實例
 */
export function createFirestoreRateLimiter(options = {}) {
  const {
    windowMs = 60 * 1000,
    maxRequests = 60,
    keyGenerator = (req) => req.ip || req.headers["x-forwarded-for"] || "unknown",
    db,
  } = options;

  if (!db) {
    throw new Error("Firestore database instance is required");
  }

  const COLLECTION = "rate_limits";

  return async (req, res, next) => {
    const key = keyGenerator(req);
    const now = Date.now();
    const windowStart = Math.floor(now / windowMs) * windowMs; // 對齊到時間窗口
    const docId = `${key}_${windowStart}`;

    try {
      const docRef = db.collection(COLLECTION).doc(docId);
      const doc = await docRef.get();

      let count = 0;
      if (doc.exists) {
        const data = doc.data();
        count = data.count || 0;
      }

      if (count >= maxRequests) {
        const retryAfter = Math.ceil((windowStart + windowMs - now) / 1000);
        
        res.status(429).json({
          error: "Too Many Requests",
          message: `請求過於頻繁，請在 ${retryAfter} 秒後再試`,
          retryAfter,
        });
        return;
      }

      // 更新計數器
      await docRef.set(
        {
          count: admin.firestore.FieldValue.increment(1),
          windowStart,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      // 設定回應標頭
      res.setHeader("X-RateLimit-Limit", maxRequests);
      res.setHeader("X-RateLimit-Remaining", Math.max(0, maxRequests - count - 1));
      res.setHeader("X-RateLimit-Reset", new Date(windowStart + windowMs).toISOString());

      next();
    } catch (error) {
      console.error("Rate limiter error:", error);
      // 發生錯誤時允許通過（fail open）
      next();
    }
  };
}

