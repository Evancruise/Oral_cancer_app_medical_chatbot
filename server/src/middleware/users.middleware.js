import jwt from "jsonwebtoken";
import { body, param } from "express-validator";
import { updateUserSchema, userIdSchema } from "#validations/users.validation.js";

export function generateToken(user) {
  return jwt.sign(
    { id: user.id, name: user.name },
    process.env.JWT_SECRET,
    { expiresIn: "30m" }   // 30 分鐘過期
  );
};

// 驗證 middleware
export const validateUpdateUser = (req, res, next) => {
  // 1. 檢查 id (params)
  console.log("Check id");
  const idCheck = userIdSchema.safeParse(req.params);
  if (!idCheck.success) {
    return res.status(400).json({
      error: "Invalid ID",
      details: idCheck.error.format(),
    });
  }

  // 2. 檢查 body (更新資料)
  console.log("Check body");
  const bodyCheck = updateUserSchema.safeParse(req.body);
  if (!bodyCheck.success) {
    return res.status(400).json({
      error: "Validation failed",
      details: bodyCheck.error.format(),
    });
  }

  // 3. 把驗證後的結果存回 req
  console.log("Retrieve result to req");
  req.params.id = idCheck.data.id; // 已轉成 number
  req.body = bodyCheck.data;

  next();
};

export const authenticateToken = (req, res, next) => {
  let token = req.cookies?.token;

  if (!token) return res.status(401).json({ error: "No token provided" });

  console.log("🔍 Raw token from cookie:", token, "Type:", typeof token);

  if (!token && req.headers.authorization?.startsWith("Bearer ")) {
    token = req.headers.authorization.split(" ")[1];
  }

  if (!token) {
    return res.status(401).json({ error: "No token provided" });
  }

  console.log(`🔍 typeof token: ${typeof token}`);
  console.log(`🔍 token value: ${JSON.stringify(token)}`);

  console.log(`Verify with: ${process.env.JWT_SECRET}`);
  console.log(`VERIFY secret length: ${process.env.JWT_SECRET.length}`);
  console.log(`VERIFY secret hex: ${Buffer.from(process.env.JWT_SECRET).toString("hex")}`);

  /*
  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) return res.status(401).json({ message: "登入已過期，請重新登入" });
    req.user = decoded;
    next();
  });
  */

  try {
    jwt.verify(token.trim(), process.env.JWT_SECRET, (err, decoded) => {
    if (err) return res.status(401).json({ message: "登入已過期，請重新登入" });
        req.user = decoded;
        console.log("✅ Verified user:", decoded);
    });
    next();
  } catch (err) {
    console.error("❌ JWT verify error:", err.message);
    return res.status(403).json({ error: "Invalid or expired token" });
  }
};

/*
export const authMiddleware = (req, res, next) {
  let token = req.cookies?.token;

  if (!token) return res.status(401).json({ error: "No token provided" });

  jwt.verify(token.trim(), process.env.JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: "Invalid or expired token" });
      req.user = user;
    next();
  });
};
*/

export const authorizeRoles = (...roles) => {
  return (req, res, next) => {
    console.log(`User role in token: ${req.user?.role}, Required roles: ${roles}`);

    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Forbidden: insufficient role" });
    }

    next();
  };
};