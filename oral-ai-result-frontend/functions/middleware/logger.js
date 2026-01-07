/**
 * 日誌記錄 Middleware
 * 記錄請求資訊和回應時間
 */

/**
 * 請求日誌 Middleware
 * 記錄每個請求的基本資訊
 */
export function requestLogger(options = {}) {
  const {
    logLevel = "info", // info, debug, warn, error
    includeBody = false,
    includeHeaders = false,
    skipPaths = [], // 跳過記錄的路徑
  } = options;

  return (req, res, next) => {
    // 跳過特定路徑
    if (skipPaths.some(path => req.path.startsWith(path))) {
      return next();
    }

    const startTime = Date.now();
    const requestId = req.headers["x-request-id"] || generateRequestId();

    // 將 requestId 附加到請求物件，方便後續使用
    req.requestId = requestId;
    res.setHeader("X-Request-ID", requestId);

    // 記錄請求資訊
    const logData = {
      requestId,
      method: req.method,
      path: req.path,
      ip: req.ip || req.headers["x-forwarded-for"] || "unknown",
      userAgent: req.headers["user-agent"],
      timestamp: new Date().toISOString(),
    };

    if (includeHeaders) {
      logData.headers = req.headers;
    }

    if (includeBody && req.body) {
      // 過濾敏感資訊
      const sanitizedBody = sanitizeBody(req.body);
      logData.body = sanitizedBody;
    }

    console.log(`[${logLevel.toUpperCase()}] Request:`, JSON.stringify(logData, null, 2));

    // 記錄回應時間
    res.on("finish", () => {
      const duration = Date.now() - startTime;
      const logData = {
        requestId,
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        duration: `${duration}ms`,
        timestamp: new Date().toISOString(),
      };

      const level = res.statusCode >= 400 ? "error" : "info";
      console.log(`[${level.toUpperCase()}] Response:`, JSON.stringify(logData, null, 2));
    });

    next();
  };
}

/**
 * 錯誤日誌 Middleware
 * 記錄錯誤資訊
 */
export function errorLogger(err, req, res, next) {
  const logData = {
    requestId: req.requestId || "unknown",
    method: req.method,
    path: req.path,
    error: {
      name: err.name,
      message: err.message,
      stack: err.stack,
    },
    timestamp: new Date().toISOString(),
  };

  console.error("[ERROR] Error Log:", JSON.stringify(logData, null, 2));
  
  // 繼續傳遞錯誤給錯誤處理 middleware
  next(err);
}

/**
 * 產生唯一的 Request ID
 */
function generateRequestId() {
  return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * 清理請求 body 中的敏感資訊
 */
function sanitizeBody(body) {
  if (!body || typeof body !== "object") {
    return body;
  }

  const sensitiveFields = ["password", "token", "secret", "apiKey", "authorization"];
  const sanitized = { ...body };

  for (const field of sensitiveFields) {
    if (sanitized[field]) {
      sanitized[field] = "***REDACTED***";
    }
  }

  return sanitized;
}

