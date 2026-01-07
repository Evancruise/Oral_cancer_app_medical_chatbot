/**
 * 認證 Middleware
 * 支援 JWT 和 OAuth 驗證
 */

import jwt from "jsonwebtoken";

/**
 * JWT 驗證 Middleware
 * @param {Object} options 設定選項
 * @param {string} options.secret JWT Secret（從環境變數或 Firebase Secrets 取得）
 * @param {boolean} options.required 是否必須驗證（預設 true）
 */
export function createJwtAuth(options = {}) {
  const {
    secret = process.env.JWT_SECRET,
    required = true,
  } = options;

  if (!secret) {
    throw new Error("JWT_SECRET is required");
  }

  return (req, res, next) => {
    // 從 Header 取得 Token
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      if (required) {
        return res.status(401).json({
          error: "Unauthorized",
          message: "缺少或無效的 Authorization token",
        });
      }
      // 非必需時，允許通過但標記為未認證
      req.user = null;
      req.isAuthenticated = false;
      return next();
    }

    const token = authHeader.substring(7); // 移除 "Bearer " 前綴

    try {
      // 驗證 JWT
      const decoded = jwt.verify(token, secret);
      req.user = decoded;
      req.isAuthenticated = true;
      next();
    } catch (error) {
      if (error.name === "TokenExpiredError") {
        return res.status(401).json({
          error: "Unauthorized",
          message: "Token 已過期",
        });
      }
      
      if (error.name === "JsonWebTokenError") {
        return res.status(401).json({
          error: "Unauthorized",
          message: "無效的 Token",
        });
      }

      console.error("JWT verification error:", error);
      return res.status(500).json({
        error: "Internal Server Error",
        message: "驗證過程中發生錯誤",
      });
    }
  };
}

/**
 * OAuth 2.0 驗證 Middleware（簡化版）
 * 實際使用時需要根據你的 OAuth Provider 調整
 * @param {Object} options 設定選項
 */
export function createOAuthAuth(options = {}) {
  const {
    provider = "google", // google, github, etc.
    clientId = process.env.OAUTH_CLIENT_ID,
    required = true,
  } = options;

  return async (req, res, next) => {
    const token = req.headers.authorization?.substring(7);

    if (!token) {
      if (required) {
        return res.status(401).json({
          error: "Unauthorized",
          message: "缺少 OAuth token",
        });
      }
      req.user = null;
      req.isAuthenticated = false;
      return next();
    }

    try {
      // 這裡應該呼叫 OAuth Provider 的 API 來驗證 token
      // 範例：Google OAuth
      if (provider === "google") {
        // const response = await fetch(`https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=${token}`);
        // const data = await response.json();
        // if (data.error) throw new Error(data.error);
        // req.user = { id: data.user_id, email: data.email };
      }

      // 其他 Provider 的實作...
      
      req.isAuthenticated = true;
      next();
    } catch (error) {
      console.error("OAuth verification error:", error);
      if (required) {
        return res.status(401).json({
          error: "Unauthorized",
          message: "OAuth token 驗證失敗",
        });
      }
      req.user = null;
      req.isAuthenticated = false;
      next();
    }
  };
}

/**
 * API Key 驗證 Middleware
 * @param {Object} options 設定選項
 * @param {string|string[]} options.apiKeys 允許的 API Keys
 * @param {string} options.headerName Header 名稱，預設 "x-api-key"
 */
export function createApiKeyAuth(options = {}) {
  const {
    apiKeys = process.env.API_KEYS?.split(",") || [],
    headerName = "x-api-key",
  } = options;

  if (!apiKeys || apiKeys.length === 0) {
    throw new Error("API keys are required");
  }

  const validKeys = new Set(apiKeys.map(key => key.trim()));

  return (req, res, next) => {
    const apiKey = req.headers[headerName] || req.headers[headerName.toLowerCase()];

    if (!apiKey || !validKeys.has(apiKey)) {
      return res.status(401).json({
        error: "Unauthorized",
        message: "無效的 API Key",
      });
    }

    req.apiKey = apiKey;
    next();
  };
}

/**
 * 角色權限檢查 Middleware
 * @param {string|string[]} allowedRoles 允許的角色
 */
export function requireRole(allowedRoles) {
  const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];

  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        error: "Unauthorized",
        message: "需要先進行身份驗證",
      });
    }

    const userRole = req.user.role || req.user.roles?.[0];
    
    if (!roles.includes(userRole)) {
      return res.status(403).json({
        error: "Forbidden",
        message: "權限不足",
      });
    }

    next();
  };
}

