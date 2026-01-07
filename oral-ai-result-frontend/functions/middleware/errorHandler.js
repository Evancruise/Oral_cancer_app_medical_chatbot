/**
 * 錯誤處理 Middleware
 * 統一處理應用程式錯誤
 */

/**
 * 自訂錯誤類別
 */
export class AppError extends Error {
  constructor(message, statusCode = 500, code = null) {
    super(message);
    this.statusCode = statusCode;
    this.code = code || `ERR_${statusCode}`;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * 非同步錯誤處理包裝器
 * 自動捕獲 async 函數的錯誤並傳遞給錯誤處理 middleware
 */
export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * 全域錯誤處理 Middleware
 * 必須放在所有路由之後
 */
export function errorHandler(err, req, res, next) {
  // 如果是自訂錯誤，使用其狀態碼和訊息
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      error: err.code,
      message: err.message,
      ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
    });
  }

  // JWT 錯誤
  if (err.name === "JsonWebTokenError") {
    return res.status(401).json({
      error: "INVALID_TOKEN",
      message: "無效的 token",
    });
  }

  if (err.name === "TokenExpiredError") {
    return res.status(401).json({
      error: "EXPIRED_TOKEN",
      message: "Token 已過期",
    });
  }

  // 驗證錯誤（例如 express-validator）
  if (err.name === "ValidationError") {
    return res.status(400).json({
      error: "VALIDATION_ERROR",
      message: err.message,
      details: err.errors,
    });
  }

  // Firestore 錯誤
  if (err.code?.startsWith("firestore/")) {
    return res.status(500).json({
      error: "DATABASE_ERROR",
      message: "資料庫操作失敗",
      ...(process.env.NODE_ENV === "development" && { details: err.message }),
    });
  }

  // 預設錯誤處理
  console.error("Unhandled error:", err);
  
  const statusCode = err.statusCode || err.status || 500;
  const message = err.message || "內部伺服器錯誤";

  res.status(statusCode).json({
    error: "INTERNAL_SERVER_ERROR",
    message: process.env.NODE_ENV === "production" 
      ? "發生未預期的錯誤" 
      : message,
    ...(process.env.NODE_ENV === "development" && {
      stack: err.stack,
      details: err,
    }),
  });
}

/**
 * 404 處理 Middleware
 * 必須放在所有路由之後，錯誤處理之前
 */
export function notFoundHandler(req, res, next) {
  res.status(404).json({
    error: "NOT_FOUND",
    message: `找不到路徑: ${req.method} ${req.path}`,
  });
}

