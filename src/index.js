import express from "express";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

import cors from 'cors';
import helmet from "helmet";
import cookieParser from 'cookie-parser';
import session from "express-session";

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

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
app.set("views", path.join(__dirname, "../views"));
app.use(express.static(path.join(__dirname, "../public")));

app.get("/", (req, res) => {
  res.render("login", { title: "Oral Cancer Webapp" });
});

app.listen(process.env.PORT || 7860, "0.0.0.0", () =>
  console.log(`🚀 Server running on port ${process.env.PORT || 7860}`)
);
