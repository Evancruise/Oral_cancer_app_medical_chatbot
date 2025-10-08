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
         recycle_record} from '#controllers/auth.controller.js';

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
router.post("/new_record", new_record);
router.post("/edit_record", edit_record);

router.get("/recycle_bin", recycle_bin);
router.post("/recycle_record", recycle_record);

export default router;