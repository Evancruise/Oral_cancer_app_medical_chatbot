import express from 'express';
import path from 'path';
import { lang_get,
         loginPage,
         homepage,
         processing,
         generate_qr,
         register,
         request,
         resend,
         verify,
         verify_register,
         changepwd,
         verify_changepwd,
         signup,
         signin,
         signout,
         dashboard,
         guideline,
         appointments,
         update_appointment,
         record,
         new_record,
         edit_record,
         recycle_bin,
         recycle_record,
         record_search,
         export_data,
         account_management,
         edit_account,
         apply_account_setting,
         apply_system_setting,
         quickchangepwd,
         verify_quick_changepwd,
         rebind_page,
         rebind_qr,
         scan_result,
         temp_upload,
         analyze,
         get_inference_status,
         chatbot,
         reset,
         new_account,
         privacy_setting,
         save_privacy_setting,
         update_appointment_status,
         web_setting,
         user_setting,
         tracking,
         education,
         // webhook_login_event,
         link_line_account,
         webhook_entry,
         login_line} from '#controllers/auth.controller.js';

// import { handleUpload } from "#services/upload.service.js";
import multer from "multer";
import i18next from "i18next";
import i18nextMiddleware from "i18next-http-middleware";
import Backend from "i18next-fs-backend";
import { middleware, Client } from "@line/bot-sdk";

i18next
  .use(Backend)
  .use(i18nextMiddleware.LanguageDetector)
  .init({
    fallbackLng: "en",
    preload: ["en", "zh-TW"],
    backend: {
      loadPath: "./locale/{{lng}}/translation.json",
    },
  });

const router = express.Router();
const upload = multer();

const config = {
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    channelSecret: process.env.LINE_CHANNEL_SECRET,
};
const lineClient = new Client(config);

console.log(`[auth.route.js] process.cwd(): ${process.cwd()}`);

router.use(express.json()); // OK，但要在 multer routes 之後

router.use("/tmp", express.static(path.join(process.cwd(), "../tmp")));

router.get("/lang/:lng", lang_get);

router.get("/register", register);
router.get("/loginPage", loginPage);
router.get("/generate_qr", generate_qr);
router.get("/homepage", homepage);
router.post("/processing", processing);

router.post("/request", request);
router.post("/resend", resend);

router.get("/verify", verify);
router.post("/verify_register", verify_register);

router.get("/changepwd", changepwd);
router.post("/verify_changepwd", verify_changepwd);

router.post("/sign-up", signup);
router.post("/sign-in", signin);
router.get("/sign-out", signout);

router.get("/dashboard", dashboard);
router.get("/guideline", guideline);
router.get("/appointments", appointments);
router.post("/update_appointment", update_appointment);
router.post("/update_appointment_status", update_appointment_status);
router.get("/education", education);

router.get("/tracking", tracking);

router.get("/privacy", privacy_setting);
router.post("/save_privacy_setting", save_privacy_setting);
router.get("/web_setting", web_setting);
router.get("/user_setting", user_setting);

router.get("/record", record);
router.post("/temp_upload", temp_upload);
router.post("/new_record", new_record);
router.post("/edit_record", edit_record);
router.post("/analyze", analyze);
router.get("/get_inference_status/:task_id", get_inference_status);

router.get("/recycle_bin", recycle_bin);
router.post("/recycle_record", recycle_record);

router.get("/record_search", record_search);
router.post("/export_data", upload.none(), export_data);

router.get("/account_management", account_management);
router.post("/new_account", upload.none(), new_account);
router.post("/edit_account", upload.none(), edit_account);
router.post("/apply_account_setting", apply_account_setting);
router.post("/apply_system_setting", apply_system_setting);
router.post("/reset", upload.none(), reset);

router.get("/quick_changepwd", quickchangepwd);
router.post("/verify_quick_changepwd", verify_quick_changepwd);

router.get("/rebind_page", rebind_page);
router.get("/rebind-qr", rebind_qr);
router.post("/scan_result", scan_result);

router.post("/chatbot", chatbot);

router.post("/line/link-user", link_line_account);
router.post("/line/webhook", middleware(config), webhook_entry);
router.post("/line/login_line", login_line);

export default router;