import express from "express";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import expressLayouts from "express-ejs-layouts";
import session from "express-session";

import i18next from "i18next";
import i18nextMiddleware from "i18next-http-middleware";
import Backend from "i18next-fs-backend";

import { homepage } from "#controllers/auth.controller.js";

import authRoutes from "#routes/auth.routes.js";
import userRoutes from "#routes/user.routes.js";
import registerRoutes from "#routes/register.routes.js";
import recordRoutes from "#routes/record.routes.js";
import appointmentRoutes from "#routes/appointment.routes.js";

import { removeUserTable } from "#services/user.service.js";
import { createUsersTable } from "#services/auth.service.js";
import { removeRegisterTable } from "#services/register.service.js";
import { createRegisterTable } from "#services/auth.service.js";
import { createAppointmentTable, removeAppointmentTable } from "#services/appointment.service.js";
import {
  createDiscardRecordTable,
  createRecordTable,
  removeDiscardRecordTable,
  removeRecordTable,
} from "#services/record.service.js";

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// =============================================
// 🔧 自動建立資料表（僅限開發模式）
// =============================================
if (process.env.NODE_ENV !== "production") {
  await removeUserTable();
  await removeRegisterTable();
  await removeRecordTable();
  await removeDiscardRecordTable();
  await removeAppointmentTable();
  await createUsersTable();
  await createRegisterTable();
  await createRecordTable();
  await createDiscardRecordTable();
  await createAppointmentTable();
}

const app = express();

// =============================================
// 🌐 i18next 國際化設定
// =============================================
i18next
  .use(Backend)
  .use(i18nextMiddleware.LanguageDetector)
  .init({
    fallbackLng: "en",
    preload: ["en", "zh"],
    backend: { loadPath: "./src/locale/{{lng}}/translation.json" },
    detection: { order: ["querystring", "cookie", "header"], caches: ["cookie"] },
  });
app.use(i18nextMiddleware.handle(i18next));

// =============================================
// 🛡️ Helmet + CORS 設定
// =============================================
const allowedOrigins =
  process.env.NODE_ENV === "production"
    ? [
        "https://your-domain.web.app",   // ← 改成你的正式前端網址
        "https://your-cloudrun-url.a.run.app",
      ]
    : ["http://localhost:5000", "http://127.0.0.1:5000"];

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE"],
  })
);

app.use(
  helmet({
    frameguard: false,
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  })
);

app.use(helmet.xssFilter());
app.use(helmet.noSniff());
app.use(helmet.hidePoweredBy());

// =============================================
// 🍪 Session & Parser
// =============================================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(
  session({
    secret: process.env.SESSION_SECRET || "default_secret",
    resave: false,
    saveUninitialized: true,
    cookie: {
      maxAge: 30 * 60 * 1000,
      secure: process.env.NODE_ENV === "production", // ⚙️ 部署時啟用 https secure
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    },
  })
);

// =============================================
// 🧱 EJS Template & Layout
// =============================================
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
// app.use(express.static(path.join(__dirname, "public")));
app.use(expressLayouts);
app.set("layout", "base");

// =============================================
// 📁 Static Routes（順序非常重要）
// =============================================

// ✅ 上傳圖片：允許 fetch() 與 <img src> 同時存取
app.use("/tmp/public", cors(), express.static(path.join(__dirname, "../tmp/public")));

// ✅ Bootstrap 資源
app.use("/bootstrap", express.static(path.join(process.cwd(), "node_modules/bootstrap/dist")));

// ✅ 公用靜態檔（css, js, images）
app.use("/static", express.static(path.join(__dirname, "public")));

// =============================================
// 🌍 全域變數注入到 EJS
// =============================================
app.use((req, res, next) => {
  res.locals.token = req.session.token;
  res.locals.name = req.session.userName;
  res.locals.t = req.t;
  next();
});

// =============================================
// 🚀 路由設定
// =============================================
app.get("/", homepage);
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/registers", registerRoutes);
app.use("/api/records", recordRoutes);
app.use("/api/appointments", appointmentRoutes);

// =============================================
// 🖥️ 啟動伺服器
// =============================================
const PORT = process.env.PORT || 7860;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV}`);
  console.log(`📂 Public uploads served at /tmp/public`);
});
