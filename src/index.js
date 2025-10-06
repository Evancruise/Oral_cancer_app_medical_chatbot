import express from "express";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

import cors from 'cors';
import helmet from "helmet";
import cookieParser from 'cookie-parser';

import expressLayouts from "express-ejs-layouts";
import session from "express-session";

import i18next from "i18next";
import i18nextMiddleware from "i18next-http-middleware";
import Backend from "i18next-fs-backend";

import { homepage } from "#controllers/auth.controller.js";

import authRoutes from "#routes/auth.routes.js";
import userRoutes from "#routes/user.routes.js";

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

i18next
    .use(Backend) 
    .use(i18nextMiddleware.LanguageDetector)
    .init({
        fallbackLng: "en",
        preload: ["en", "zh"],
        backend: {
            loadPath: "./src/locale/{{lng}}/translation.json"
        },
        detection: {
            order: ["querystring", "cookie", "header"],
            caches: ["cookie"]
        }
    });
app.use(i18nextMiddleware.handle(i18next));

app.use(cors());
app.use(
  helmet({
    frameguard: false, // 允許 iframe (必要)
    contentSecurityPolicy: false, // 關閉 CSP 限制 (必要)
    crossOriginEmbedderPolicy: false, // 防止 COEP 封鎖 (建議)
  })
);

app.use(helmet.xssFilter());
app.use(helmet.noSniff());
app.use(helmet.hidePoweredBy());

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use(session({
    secret: process.env.SESSION_SECRET || 'default_secret',
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 30 * 60 * 1000 } // 在生產環境中使用安全 cookie
}));

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));

app.use(expressLayouts);
app.set("layout", "base");

// app.use("/bootstrap", express.static(path.join(process.cwd(), "node_modules/bootstrap/dist")));
app.use('/bootstrap', express.static('node_modules/bootstrap/dist'));
app.use('/static', express.static('node_modules/bootstrap/dist'));
app.use("/static", express.static(path.join(__dirname, "public")));

app.get("/", homepage);

app.use('/api/auth', authRoutes);
app.use("/api/users", userRoutes);

app.listen(process.env.PORT || 7860, "0.0.0.0", () =>
  console.log(`🚀 Server running on port ${process.env.PORT || 7860}`)
);
