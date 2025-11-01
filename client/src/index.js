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
import registerRoutes from "#routes/register.routes.js";
import recordRoutes from "#routes/record.routes.js";
import appointmentRoutes from "#routes/appointment.routes.js";

import { removeUserTable } from "#services/user.service.js";
import { createUsersTable } from "#services/auth.service.js";
import { removeRegisterTable } from "#services/register.service.js";
import { createRegisterTable } from "#services/auth.service.js";
import { createAppointmentTable, removeAppointmentTable } from "#services/appointment.service.js";

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

await removeUserTable();
await removeRegisterTable();
await removeAppointmentTable();
await createUsersTable();
await createRegisterTable();
await createAppointmentTable();

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
app.use("/static", express.static(path.join(__dirname, "tmp")));
app.use("/static", express.static(path.join(__dirname, "public")));

app.use((req, res, next) => {
  res.locals.token = req.session.token;
  res.locals.name = req.session.userName;
  res.locals.t = req.t;
  next();
});

app.get("/", homepage);

app.use('/api/auth', authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/registers", registerRoutes);
app.use("/api/records", recordRoutes);
app.use("/api/appointments", appointmentRoutes);

app.listen(process.env.PORT || 7860, "0.0.0.0", () =>
  console.log(`🚀 Server running on port ${process.env.PORT || 7860}`)
);
