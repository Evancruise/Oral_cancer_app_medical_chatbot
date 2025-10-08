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
         temp_upload} from '#controllers/auth.controller.js';

import multer from "multer";
import i18next from "i18next";
import i18nextMiddleware from "i18next-http-middleware";
import Backend from "i18next-fs-backend";

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

router.use("/static", express.static(path.join(process.cwd(), "public")));
router.use("/static", express.static(path.join(process.cwd(), "tmp")));

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

router.get("/record", record);
router.post("/temp_upload", temp_upload);
router.post("/new_record", new_record);
router.post("/edit_record", edit_record);

router.get("/recycle_bin", recycle_bin);
router.post("/recycle_record", recycle_record);

router.get("/record_search", record_search);
router.post("/export_data", upload.none(), export_data);

router.get("/account_management", account_management);
router.post("/edit_account", upload.none(), edit_account);
router.post("/apply_account_setting", upload.none(), apply_account_setting);
router.post("/apply_system_setting", upload.none(), apply_system_setting);

router.get("/quick_changepwd", quickchangepwd);
router.post("/verify_quick_changepwd", verify_quick_changepwd);

router.get("/rebind_page", rebind_page);
router.get("/rebind-qr", rebind_qr);
router.post("/scan_result", scan_result);

export default router;