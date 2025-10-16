import { v4 as uuidv4 } from "uuid";
import QRCode from "qrcode";
import bcrypt from 'bcrypt';
import jwt from "jsonwebtoken";
import sgMail from "@sendgrid/mail";
import crypto from "crypto";
import { DateTime } from "luxon";
import { fileURLToPath } from "url";

import fs from "fs";
import path from "path";
import multer from "multer";
import ExcelJS from "exceljs";

import { config, default_config } from "#config/config.js";
import { createUser, createRegister } from "#services/auth.service.js";
import { getRegister, updateRegister } from "#services/register.service.js";
import { updateUserPassword, updateUserTableFromRegister, 
         getUser, getAllUsers, updateUser, deleteUser, getTempUser } from "#services/user.service.js";
import { getRecord, createRecord, updateRecord, updateRecordStatus, deleteRecord, getAllRecords,
         getDiscardRecord, deleteDiscardRecord, recoverRecord} from "#services/record.service.js";

import { signupSchema, signinSchema } from "#validations/auth.validation.js";
// import { generateToken } from "#middleware/users.middleware.js";
import { movefiles, deletefiles } from "#utils/func.js";

import { removeUserTable, createUsersTable } from "#services/user.service.js";
import { removeRegisterTable, createRegisterTable } from "#services/register.service.js";

console.log(`process.cwd(): ${process.cwd()}`);

const configRoot_dir = "../tmp/config";
const uploadRoot_dir = "../tmp/public";

const uploadDir = path.join(process.cwd(), `${uploadRoot_dir}/uploads`);
const uploadDir_gb = path.join(process.cwd(), `${uploadRoot_dir}/uploads_gb`);
const config_dir = path.join(process.cwd(), configRoot_dir);
let configPath = path.join(process.cwd(), `${configRoot_dir}/settings.json`);

const storage_temp = multer.diskStorage({ // cb(null, tempDir)
  destination: (req, file, cb) => {
    const { patient_id } = req.query;

    if (!patient_id) {return cb(new Error("Missing patient_id"));}

    const patientDir = path.join(uploadDir, patient_id);
    fs.mkdirSync(patientDir, { recursive: true });
    cb(null, patientDir);
  },
  filename: (req, file, cb) => {
    try {
      const { patient_id, code } = req.query;  // <-- 注意是 req.query
      
      if (!patient_id || !code) {
        return cb(new Error("Missing patient_id or code"));
      }

      // const ext = path.extname(file.originalname);
      const safePatientId = patient_id.replace("-", "_") || "unknown";
      const safeCode = code || "x";
      const prefix = safePatientId + "-" + safeCode;

      const patientDir = path.join(uploadDir, patient_id);
      const filename = `${safePatientId}-${safeCode}-${file.originalname}`;
      const filepath = path.join(uploadDir, patient_id, filename);

      const files = fs.readdirSync(patientDir);

      for (const file of files) {
        if (file.startsWith(prefix)) {
          const targetPath = path.join(patientDir, file);
          fs.unlinkSync(targetPath);
          console.log(`🗑️ Delete old file (prefix match): ${targetPath}`);
        }
      }

      /*
      if (fs.existsSync(filepath)) {
        fs.unlinkSync(filepath);
        console.log(`Delete old file: ${filepath}`);
      }
      */

      cb(null, filename);
    } catch (err) {
      cb(err);
    }
  }
});

const storage_upload = multer.diskStorage({
  destination: (req, file, cb) => {
    // 假設前端有傳 patient_id
    const patientId = req.body.patient_id || "unknown";

    // 動態建立子資料夾
    const uploadDir_sub = path.join(uploadDir, patientId);
    fs.mkdirSync(uploadDir_sub, { recursive: true }); // 若不存在則建立

    cb(null, uploadDir_sub);
  },
  filename: (req, file, cb) => {
    try {
      const { patient_id } = req.query;
      const match = file.fieldname.match(/\d+/);
      const code = match ? match[0] : "x"; // 預設為 x，避免 undefined

      const safePatientId = patient_id.replace("-", "_") || "unknown";
      const safeCode = code || "x";
      // const prefix = safePatientId + "-" + safeCode;

      const filename = `${safePatientId}-${safeCode}-${file.originalname}`;
      cb(null, filename);
    } catch (err) {
      cb(err);
    }
  }
});

const storage_upload_gb = multer.diskStorage({
  destination: (req, file, cb) => {
    // 假設前端有傳 patient_id
    const patientId = req.body.patient_id || "unknown";

    // 動態建立子資料夾
    const uploadDir_sub = path.join(uploadDir_gb, patientId);
    fs.mkdirSync(uploadDir_sub, { recursive: true }); // 若不存在則建立

    cb(null, uploadDir_sub);
  },
  filename: (req, file, cb) => {
    try {
      const { patient_id } = req.query;
      const match = file.fieldname.match(/\d+/);
      const code = match ? match[0] : "x"; // 預設為 x，避免 undefined

      const safePatientId = patient_id.replace("-", "_") || "unknown";
      const safeCode = code || "x";
      // const prefix = safePatientId + "-" + safeCode;

      const filename = `${safePatientId}-${safeCode}-${file.originalname}`;
      cb(null, filename);
    } catch (err) {
      cb(err);
    }
  }
});

const upload_temp = multer({ storage: storage_temp });
const upload = multer({ storage: storage_upload });
const upload_gb = multer({ storage: storage_upload_gb });

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

export const lang_get = (req, res) => {
  res.json({
    uploaded: req.t("record.already_upload"),
    infer_again_msg: req.t("record.infer_again_msg"),
    close_msg: req.t("rebind_account.close_msg"),
    open_msg: req.t("rebind_account.open_msg")
  });
};

export const homepage = async (req, res) => {
    res.render("homePage", { layout: false });
};

export const processing = async (req, res) => {
    const body = req.body;
    const login_role = body.login_role;
    return res.status(201).json({ layout: false, login_role: login_role, success: true, redirect: `/api/auth/loginPage?login_role=${login_role}` });
};

export const register = async (req, res) => {
    res.render("register", { layout: false });
};

export const loginPage = async (req, res) => {
    let login_role = req?.query.login_role;
    let name = "", email = "";

    if (login_role === "professor") {
        name = process.env.NAME;
        email = process.env.ACCOUNT;
    }

    res.render("loginPage", { layout: false, login_role: login_role, name: name, email: email });
};

function generateSecureSixDigitCode() {
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  return (array[0] % 1000000).toString().padStart(6, "0");
}

export const signup = async (req, res, next) => {
    try {

      console.log("🔍 signup req.body =", req.body);

      const validationResult = signupSchema.safeParse(req.body);

      console.log("validationResult = ", validationResult);

      if (!validationResult.success) {
        return res.status(400).json({
          success: false,
          error: "Validation failed",
          details: validationResult.error.format(),
        });
      }

      const { name, email, password, role } = validationResult.data;

      console.log(`req.body.password: ${req.body.password}`);
      console.log(`req.body.password_2: ${req.body.password_2}`);

      if (req.body.password !== req.body.password_2) {
          return res.status(401).json({ 
              success: false,
              error: "Invalid credentials",
              message: "Password not the same",
          });
      }

      const user = await createUser({ name, email, password, role });
      console.log("name, email, password, role:", name, email, password, role);

      console.log(`Signing with: ${process.env.JWT_SECRET}`);

      const token = jwt.sign(
        { id: user.id, email: user.email, password: user.password, role: user.role },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN },
      );

      console.log(`token: ${token}`);

      res.cookie("token", token, {
        httpOnly: true,
        // secure: process.env.NODE_ENV === "development",
        secure: true,    // 建議上線時開啟
        sameSite: "strict",
        path: "/",
      });

      console.log(`✅ User registered: ${email}`);

      return res.status(201).json({
        success: true,
        message: "User registered successfully",
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          password: user.passowrd,
          role: user.role,
        },
      });
    } catch (e) {
      console.error("Signup error:", e);
      return res.status(409).json({ error: "Email already exists" });
    }
};

export const signin = async (req, res, next) => {

  console.log(`sign triggerred!`);

  try {

    console.log(`req.body: ${JSON.stringify(req.body)}`);

    const validationResult = signinSchema.safeParse(req.body);

    if (!validationResult.success) {
      return res.status(400).json({
        error: "Validation failed",
        details: validationResult.error.format(),
      });
    }

    const { name, email, password } = validationResult.data;

    console.log(`email: ${email}`);

    const user = await getUser("email", email);
    const login_role = req.body.login_role;

    if (!user) {
      console.log();
      return res.status(401).json({ success: false, error: "Invalid credentials", message: "User not found" });
    }

    if (name !== user.name) {
      return res.status(401).json({ success: false, error: "Invalid credentials", message: "Wrong name" });
    }

    if (email !== user.email) {
      return res.status(401).json({ success: false, error: "Invalid credentials", message: "Wrong email" });
    }

    console.log(`password: ${password}`);
    console.log(`user.password: ${user.password}`);

    /*
    const check_allowed_loggin = await check_user_login("name", user.name);

    if (!check_allowed_loggin) {
        return res.status(403).json({ success: false, message: "Account locked. Try again later." });
    }
    */

    console.log(`new Date(user.allowed_loggin_at): ${new Date(user.allowed_loggin_at)} | new Date(): ${new Date()}`);
  
    if (new Date(user.allowed_loggin_at) > new Date()) {

      const unlockTime = DateTime.fromJSDate(user.allowed_loggin_at)
                               .setZone(user.timezone || "UTC")
                               .toFormat("yyyy-MM-dd HH:mm:ss");

      return res.status(403).json({
          error: "Account locked. Try again later.",
          message: `Account locked until ${unlockTime} (${user.timezone})`,
      });
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
        // await updateUserPassword(false, "name", user.name);
        return res.status(401).json({ success: false, message: `Wrong password. Please login again (remaining times: ${user.retry_times})` });
    } else {
        // await updateUserPassword(true, "name", user.name);
    }

    console.log(`Signing with: ${process.env.JWT_SECRET}`);

    console.log(`SIGN secret length: ${process.env.JWT_SECRET.length}`);
    console.log(`SIGN secret hex: ${Buffer.from(process.env.JWT_SECRET).toString("hex")}`);

    const token = jwt.sign(
      { id: user.id, name: user.name, email: user.email, password: user.password, role: user.role, login_role: login_role },
      process.env.JWT_SECRET,
      { expiresIn: config.expireTime },
    );

    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production", // 本地 false，上線 true
      sameSite: process.env.NODE_ENV === "production" ? "strict" : "lax",
      path: '/',
    });

    console.log(`✅ secure: ${process.env.NODE_ENV === "production"}`);
    console.log(`✅ sameSite: ${process.env.NODE_ENV === "production" ? "strict" : "lax"}`);
    console.log(`✅ User logged in: ${email}`);
    console.log(`req.t: ${req.t}`);
    
    return res.status(200).json({
      success: true,
      message: "Login successful",
      t: req.t,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        token: token,
      },
    });
  } catch (e) {
    console.error("Signin error", e);
    return res.status(400).json({
      success: false, 
      message: `Login Failed ${e.message}`});
  }
};

function priority_from_role(role) {
  let priority = -1;

  if (role === "tester") {
    priority = 3;
  } else if (role === "resource manager") {
    priority = 2;
  } else if (role === "system manager") {
    priority = 1;
  }
  console.log(`priority = ${priority}`);
  return priority;
};

// dashboard 首頁
export const dashboard = (req, res) => {
  try {
    const token = req.query.token;  // 從 cookie 拿 token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    console.log(`token: ${token}`);

    if (!token) {
      if (!decoded) {
        return res.redirect(`/api/auth/homepage`);
      }
      return res.redirect(`/api/auth/loginPage?login_role=${decoded.login_role}`); // 沒有 token 回登入頁
    }

    console.log(`decoded: ${JSON.stringify(decoded)}`);
    console.log(`decoded.name: ${decoded.name}`);
    console.log(`decoded.login_role: ${decoded.login_role}`);
    console.log(`req.t: ${req.t}`);

    res.render("dashboard", { name: decoded.name, t: req.t, path: "/api/auth/dashboard", priority: priority_from_role(decoded.role), token: token, layout: "base" });
  } catch (err) {
    console.error("JWT 驗證失敗:", err);
    return res.redirect(`/api/auth/homepage`);
  }
};

function formatDateTime(date) {
    if (!(date instanceof Date)) {date = new Date(date);}
    const iso = date.toISOString();
    const [day, time] = iso.split("T");
    return `${day} ${time.split(".")[0]}`;
}

export const record = async (req, res) => {
  //try {
    const token = req.query.token;  // 從 cookie 拿 token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (!token) {
      if (!decoded) {
        return res.redirect(`/api/auth/homepage`);
      }
      return res.redirect(`/api/auth/loginPage?login_role=${decoded.login_role}`); // 沒有 token 回登入頁
    }
    
    console.log(`decoded: ${JSON.stringify(decoded)}`);
    console.log(`decoded.name: ${decoded.name}`);

    const record = await getRecord("name", decoded.name);
    
    let length = 0;

    console.log(`record: ${JSON.stringify(record)}`);

    let grouped = {};

    if (record) {
        // 1. 排序 (依 created_at 從新到舊)
        record.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        console.log(`record (sorted): ${JSON.stringify(record)}`);

        // 假設 record 是陣列
        length = Object.keys(record).length;
        
        // 2. 分組 (key = YYYY-MM-DD)
        grouped = record.reduce((acc, item) => {
          console.log(`item.created_at: ${item.created_at}`);

          const dateKey = DateTime.fromJSDate(item.created_at)
                               .setZone(item.timezone || "UTC")
                               .toFormat("yyyy-MM-dd");

          // const dateKey = item.created_at.toISOString().split("T")[0] // Date → YYYY-MM-DD
          console.log(`dateKey: ${dateKey}`);

          if (!acc[dateKey]) {
            acc[dateKey] = [];
          }
          acc[dateKey].push(item);
          return acc;
        }, {});
        console.log(`grouped: ${JSON.stringify(grouped)}`);
    }

    console.log(`patient_id: ${decoded.id}-${length}`);
    console.log(`new_patient_id: ${decoded.id}-${length+1}`);

    return res.status(201).render("record", 
    { layout: "base", 
      grouped_records: grouped, 
      priority: priority_from_role(decoded.role), 
      path: "/api/auth/record", 
      id: decoded.id, 
      patient_id: `${decoded.id}-${length}`,
      new_patient_id: `${decoded.id}-${length+1}`,
      name: decoded.name,
      token: token, 
      t: req.t,
      formatDateTime });
  //} catch (err) {
  //  console.error("Internal error");
  //  return res.redirect("/api/auth/homepage");
  //}
};

export const temp_upload = [
    upload_temp.single("file"),
    async (req, res) => {
      try {
        const file = req.file;

        if (!file) {return res.status(400).json({ success: false, message: "No file uploaded" });}

        const tempPath = file.path.replace(/\\/g, "/");

        // console.log(`patient_id: ${patient_id}, code: ${code}`);
        console.log("📸 Temp uploaded:", tempPath);
        console.log("File saved at:", file.path);

        const filename = path.basename(tempPath);

        return res.status(201).json({ success: true, filename: filename });
      } catch (err) {
        console.error("temp_upload error:", err);
        return res.status(500).json({ success: false, message: "Server error" });
      }
    }
];

export const new_record = [
  upload.any(),  // multer 處理 multipart/form-data
  async (req, res) => {
    const body = req.body;
    const files = req.files;
    // generateToken(body);

    console.log("req.headers:", req.headers);
    console.log("body:", body);
    console.log("files:", JSON.stringify(files, null, 2));

    const token = body.token;
    if (!token) {
      return res.redirect("/api/auth/homepage");
    }

    const action = body.action;  
    const patientId = body.patient_id;

    // 確保 patient_id 資料夾存在
    //const uploadDir = path.join(process.cwd(), "public", "uploads", patientId);
    //if (!fs.existsSync(uploadDir)) {
    //  fs.mkdirSync(uploadDir, { recursive: true });
    //}

    // 儲存檔案到 patient_id 資料夾
    //for (const file of files) {
    //  const targetPath = path.join(uploadDir, file.originalname);
    //  fs.renameSync(file.path, targetPath);
    //}

    let newRecord = null;

    if (action === "create") {
      /* 
      update current new add user file into records table from body
      */
      newRecord = await createRecord(body);

      // TODO: 把 files 存到資料夾，例如 uploads/{patient_id}/
      return res.status(200).json({
        layout: false,
        success: true,
        redirect: `/api/auth/record?token=${token}`,
        message: "Create new record successfully",
        patient_id: patientId,
        // files: files.map(f => ({ field: f.fieldname, name: f.originalname }))
      });
    } else if (action === "infer") {
      /* 
      update current new add user file into records table from body
      */
      newRecord = await createRecord(body);

      return res.status(200).json({
        layout: false,
        success: true,
        redirect: `/api/auth/record?token=${token}`,
        message: "inference complete"
      });
    } else if (action === "check_result") {
        return res.status(200).json({
          success: true,
          message: "檢查結果完成",
          patient_id: patientId,
          redirect: `/api/auth/record?token=${token}`,
          // files: savedFiles,
        });
    } else {
        return res.status(400).json({
          layout: false,
          success: false,
          message: "unknown action"
        });
    }
  }
];

export const edit_record = [
  upload.any(),
  async (req, res) => {
    const body = req.body;
    const files = req.files;
    // generateToken(body);

    console.log("req.headers:", req.headers);
    console.log("body:", body);
    console.log("files:", JSON.stringify(files, null, 2));

    const token = body.token;
    if (!token) {
      return res.redirect("/api/auth/homepage");
    }

    const action = body.action;
    const patientId = body.patient_id;

    console.log("patientId:", patientId);

    const uploadDir_id = `${uploadDir}/${patientId}`;
    const uploadDir_gb_id = `${uploadDir_gb}/${patientId}`;

    console.log(`action: ${action}`);
    console.log(`uploadDir: ${uploadDir_id}`);
    console.log(`uploadDir_gb_id: ${uploadDir_gb_id}`);

    if (!fs.existsSync(uploadDir_id)) {
      fs.mkdirSync(uploadDir_id, { recursive: true });
    }

    if (action === "save") {
        // const savedFiles = [];

        // for (const file of files) {
        //   const targetPath = path.join(uploadDir, file.originalname);
        //   fs.renameSync(file.path, targetPath);
        //   savedFiles.push(`/uploads/${patientId}/${file.originalname}`);
        // }

        // 儲存檔案到 patient_id 資料夾
        const imgUpdates = {};
        for (let i = 1; i <= 8; i++) {
          const fieldName = `pic${i}_2`;
          const file = files.find(f => f.fieldname === fieldName);
          console.log(`body[pic${i}_2]=`, body[`pic${i}_2`]);

          if (file) {
            // 有新檔 → 搬移到 patient_id 資料夾
            const filename = body[`pic${i}_2`];
            const newPath = path.join(uploadDir_id, filename/*file.originalname*/);
            // await fs.promises.rename(file.path, newPath);

            // 存 DB 用的相對路徑 (假設 uploads 在 public/static 底下)
            // const relativePath = path.relative("public", newPath).replace(/\\/g, "/");
            imgUpdates[fieldName] = newPath.replace(/\\/g, "/"); // "/" + relativePath;
          } else {
            // 沒新檔 → 用 hidden input 傳來的舊路徑
            imgUpdates[fieldName] = body[`pic${i}_2`] || null;
          }
        }

        console.log("imgUpdates:", imgUpdates);
    
        const editRecord = await updateRecord(body, imgUpdates);

        // TODO: 把 files 存到資料夾，例如 uploads/{patient_id}/
        return res.status(200).json({
          layout: false,
          success: true,
          redirect: `/api/auth/record?token=${token}`,
          message: "Edit new record successfully",
          event: action,
          patient_id: patientId,
          files: files.map(f => ({ field: f.fieldname, name: f.originalname }))
        });
    } else if (action === "delete") {
        const delete_record = await deleteRecord(body);

        console.log(`delete_record: ${JSON.stringify(delete_record)}`);

        if (!fs.existsSync(uploadDir_gb_id)) {
          fs.mkdirSync(uploadDir_gb_id, { recursive: true });
        }

        console.log(`uploadDir: ${uploadDir_id} ${fs.existsSync(uploadDir_id)}`);
        console.log(`uploadDir_gb: ${uploadDir_gb_id} ${fs.existsSync(uploadDir_gb_id)}`);

        if (fs.existsSync(uploadDir_gb_id)) {
          // move the files from folder with gb to that with original ones
          const moveOk = await movefiles(uploadDir_id, uploadDir_gb_id);
          if (moveOk === false) {
            return res.status(401).json({ success: false, message: "Files transfer failed" });
          }
        }

        // TODO: 把 files 存到資料夾，例如 uploads/{patient_id}/
        return res.status(200).json({
          layout: false,
          success: true,
          redirect: `/api/auth/record?token=${token}`,
          message: "Delete record successfully",
          event: action,
          patient_id: patientId
        });
    } else if (action === "infer") {
        return res.status(200).json({
          layout: false,
          success: true,
          redirect: `/api/auth/record?token=${token}`,
          message: "Begin inferencing",
          event: action,
          patient_id: patientId
        });
    }
  }
];

export const analyze = [
  upload.any(),
  async (req, res) => {

      console.log("🧾 Received fields:", Object.keys(req.body));
      const token = req.body.token;

    //try {
      const formData = new FormData();
      formData.append("patient_id", String(req.body.patient_id));

      const logEntries = [];
      logEntries.push(["patient_id", req.body.patient_id]);

      for (let i = 1; i <= 8; i++) {
        const imgPath = req.body[`pic${i}`];
        if (imgPath && fs.existsSync(imgPath)) {
          const absPath = path.resolve(imgPath);
          console.log(`✅ Appending file: ${absPath}`);
          formData.append(`pic${i}`, fs.createReadStream(absPath));
        } else {
          console.log(`⚠️ File not found or empty: pic${i}`);
        }
      }

      // 手動列印出所有 append 的內容
      console.log("📦 Sending to Flask:");
      for (const [key, value] of logEntries) {
        console.log(`  ${key}:`, value?.path || value?.name || value);
      }

      const response = await fetch(`${process.env.FLASK_API_URL}/api/predict`, {
        method: "POST",
        body: formData,
      });

      const result = await response.json();

      console.log("result:", result);

      if (result.status === "ok") {
        return res.status(201).json({ success: true, message: "Inference started", task_id: result.task_id, patient_id: result.patient_id, redirect: `/api/auth/record?token=${token}` });
      } else {
        return res.status(401).json({ success: false, message: "Failed to start inference" });
      }

    //} catch (err) {
    //  console.error("Error starting inference");
    //  return res.status(500).json({ success: false, message: "Server error" });
    //}
  }
]; 

export const get_inference_status = async (req, res) => {
    const { task_id } = req.params;
    console.log(`Fetch get_inference_status...`);

    //try {
      const response = await fetch(`${process.env.FLASK_API_URL}/api/status/${task_id}`);
      const result = await response.json();

      console.log(`[get_inference_status] result=${JSON.stringify(result)}`);

      if (result && result.status === "completed") {
        console.log(`Inference complete for task_id: ${task_id}`);
        const updated = await updateRecordStatus(result.patient_id, "status", "completed");
      }

      return res.status(200).json(result);
    //} catch (err) {
    //  console.error("Error getting inference status:", err);
    //  res.status(500).json({ success: false, message: "Unable to get status" });
    //}
};

export const chatbot = async (req, res) => {
    const userMsg = req.body.message;

    // 模擬回應 (日後可以串接 Flask + LangChain)
    console.log("[Chatbot] User:", userMsg);
    
    const mockReply = `AI 助理回覆：已收到「${userMsg}」，將分析相關口腔資訊。`;
    
    res.json({ reply: mockReply });
};

export const record_search = async (req, res) => {
  try {
    const token = req.query.token;  // 從 cookie 拿 token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (!token) {
      if (!decoded) {
        return res.redirect(`/api/auth/homepage`);
      }
      return res.redirect(`/api/auth/loginPage?login_role=${decoded.login_role}`); // 沒有 token 回登入頁
    }

    let grouped = {};

    const allRecords = await getAllRecords();

    console.log(`decoded: ${JSON.stringify(decoded)}`);
    console.log(`decoded.role: ${decoded.role}`);

    console.log(`allRecords: ${JSON.stringify(allRecords)}`);

    let length = 0;

    if (allRecords) {
        // 1. 排序 (依 created_at 從新到舊)
        allRecords.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

        // 假設 record 是陣列
        length = Object.keys(allRecords).length;

        // 2. 分組 (key = YYYY-MM-DD)
        grouped = allRecords.reduce((acc, item) => {
          console.log(`item.created_at: ${item.created_at}`);
          const dateKey = item.created_at.toISOString().split("T")[0]; // Date → YYYY-MM-DD
          console.log(`dateKey: ${dateKey}`);

          if (!acc[dateKey]) {
            acc[dateKey] = [];
          }
          acc[dateKey].push(item);
          return acc;
        }, {});
        console.log(`grouped: ${JSON.stringify(grouped)}`);
    }

    return res.status(201).render("record_search", 
    { layout: "base",  
      grouped_records: grouped, 
      today_date: (new Date()).toISOString().split("T")[0],
      priority: priority_from_role(decoded.role), 
      path: "/api/auth/record_search", 
      t: req.t,
      token: token });
  } catch (err) {
    console.error(`record_search failed!`);
    return res.redirect("/api/auth/homepage");
  }
};

export const export_data = async (req, res) => {
    try {
        console.log(`export_data req.body: ${JSON.stringify(req.body)}`);
        const rows = JSON.parse(req.body.tableData || "[]");

        if (!rows.length) {
            return res.status(400).json({ success: false, message: "No data to export" });  
        }

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Records');

        worksheet.columns = [
          { header: "影像案例編號", key: "patient_id", width: 20 },
          { header: "建立日期", key: "created_at", width: 15 },
          { header: "上傳日期", key: "updated_at", width: 15 },
          { header: "上傳人員", key: "name", width: 15 },
          { header: "分析狀態", key: "status", width: 15 },
          { header: "備註", key: "notes", width: 30 }
        ];

        // 加入資料
        rows.forEach((r) => worksheet.addRow(r));

        // 設定回應 headers → 讓瀏覽器自動下載
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", "attachment; filename=records.xlsx");

        // 把 workbook 寫到 response stream
        await workbook.xlsx.write(res);
        res.end();
    } catch (e) {
        console.error("export_data error:", e);
        return res.status(500).json({ success: false, message: "Export data failed" });
    }
};

export const account_management = async (req, res) => {
    //try {
      const token = req.query.token;  // 從 cookie 拿 token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      
      console.log(`decoded: ${JSON.stringify(decoded)}`);
      console.log(`decoded.role: ${decoded.role}`);
      console.log(`token: ${token}`);

      if (!token) {
        if (!decoded) {
          return res.redirect(`/api/auth/homepage`);
        }
        return res.redirect(`/api/auth/loginPage?login_role=${decoded.login_role}`); // 沒有 token 回登入頁
      }

      const allUsers = await getAllUsers();
      console.log(`allUsers: ${JSON.stringify(allUsers)}`);

      let length = 0;

      let grouped = {};

      if (allUsers) {
          // 1. 排序 (依 created_at 從新到舊)
          allUsers.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

          // 假設 record 是陣列
          length = Object.keys(allUsers).length;

          // 2. 分組 (key = YYYY-MM-DD)
          grouped = allUsers.reduce((acc, item) => {
            const dateName = item.name;
            console.log(`dateName: ${dateName}`);

            if (!acc[dateName]) {
              acc[dateName] = [];
            }
            acc[dateName].push(item);
            return acc;
          }, {});
          console.log(`grouped: ${JSON.stringify(grouped)}`);
      }

      console.log(`config: ${JSON.stringify(config)}`);
      let fileContent = null;
      let cur_config = null;
      
      if (fs.existsSync(configPath)) {
          fileContent = fs.readFileSync(configPath, "utf-8");
          cur_config = JSON.parse(fileContent);
      }

      return res.status(201).render("account_management", 
      { layout: "base",  
        grouped_accounts: grouped, 
        today_date: (new Date()).toISOString().split("T")[0],
        priority: priority_from_role(decoded.role), 
        path: "/api/auth/account_management", 
        token: token,
        t: req.t,
        config: cur_config});
    //} catch(err) {
    //  console.log("account_management error: ", err.message);
    //  return res.redirect("/api/auth/homepage");
    //}
};

export const new_account = async (req, res) => {
  // try {
    console.log("new_account event triggerred!");

    const body = req.body;

    const token = body.token;  

    console.log(`token: ${token}`);

    const { name, email, password, role, unit, notes } = body;

    console.log("body:", body);

    const user = await createUser({ name, email, password, role, unit, notes });
    
    console.log(`user: ${JSON.stringify(user)}`);
    console.log(`redirect: /api/auth/account_management?token=${token}`);

    return res.status(201).json({ success: true, message: "Create new account successfully", redirect: `/api/auth/account_management?token=${token}` });
  // } catch (e) {
  //  console.error("new_account error:", e);
  //  return res.status(409).json({ success: false, message: "Email already exists" });
  //}
};

export const edit_account = async (req, res) => {
  // try {  
    const body = req.body;
    
    console.log("body:", body);

    const token = body.token;

    console.log("token:", token);

    // generateToken(body);

    const action = body.action;

    if (action === "save") {
        const user = await updateUser("name", body.name, body);
        console.log(`user: ${JSON.stringify(user)}`);
        return res.status(201).json({ success: true, message: "Edit account successfully", redirect: `/api/auth/account_management?token=${token}` });
    } else if (action === "delete") {
        const user = await deleteUser("name", body.name);
        console.log(`user: ${JSON.stringify(user)}`);
        return res.status(201).json({ success: true, message: "Delete account successfully", redirect: `/api/auth/account_management?token=${token}` });
    }
  // } catch (e) {
  //  console.error("edit_account error:", e);
  //  return res.status(409).json({ success: false, message: "Edit account failed" });
  // }
};

export const apply_account_setting = async (req, res) => {
    try {  
        const body = req.body;
        const token = body.token;
        const action = body.action;

        console.log("body:", body);
        // generateToken(body);

        if (action === "save") {
          
            let oldConfig = {};

            if (!fs.existsSync(config_dir)) {
                fs.mkdirSync(config_dir, { recursive: true });
            } else if (fs.existsSync(configPath)) {
                const raw = fs.readFileSync(configPath, "utf-8");
                oldConfig = JSON.parse(raw);
            }

            const newConfig = { ...oldConfig, ...body, updated_at: new Date().toISOString() };
            
            fs.writeFileSync(configPath, JSON.stringify(newConfig, null, 2), "utf-8");

            return res.status(201).json({ success: true, message: "Update system setting successfully", redirect: `/api/auth/account_management?token=${token}` });
        } else if (action === "reset") {
            fs.writeFileSync(configPath, JSON.stringify(default_config, null, 2));
            return res.status(201).json({ success: true, message: "Reset system setting successfully", redirect: `/api/auth/account_management?token=${token}` });
        } else if (action === "init") {
            removeUserTable();    
            createUsersTable();
            removeRegisterTable();
            createRegisterTable();
            return res.status(201).json({ success: true, message: "Init system setting successfully", redirect: `/api/auth/account_management?token=${token}` });
        }
    } catch (e) {
        console.error("apply_account_setting error:", e);
        return res.status(409).json({ success: false, message: "Apply account setting failed" });
    }
};

export const sys_import = async (req, res) => {
    
  try{

    const fileContent = req.file.buffer.toString("utf-8");
    const settings = JSON.parse(fileContent);
    const token = req.body.token;

    console.log("匯入設定:", settings);

    fs.writeFileSync(configPath, JSON.stringify(settings, null, 2));

    return res.status(201).json({ success: true, message: "匯入檔案成功", redirect: `/api/auth/account_management?token=${token}` });
  } catch (err) {
    return res.status(401).json({ success: false, message: `sys_import err: ${err.message}`, redirect: "/api/auth/homepage" });
  }
};

export const reset = async (req, res) => {
    const token = req.body.token;
    console.log(`token: ${token}`);
    fs.writeFileSync(configPath, JSON.stringify(default_config, null, 2));
    return res.status(201).json({ success: true, message: "Reset system setting successfully", redirect: `/api/auth/account_management?token=${token}` });
};

export const sys_export = async (req, res) => {
  try {  
    
    let oldConfig = {};

    if (!fs.existsSync(config_dir)) {
        fs.mkdirSync(config_dir, { recursive: true });

        const newConfig = { ...oldConfig, ...config, updated_at: new Date().toISOString() };

        console.log(`newConfig: ${JSON.stringify(newConfig)}`);

        fs.writeFileSync(configPath, JSON.stringify(newConfig, null, 2), "utf-8");

    } else {
        const old_raw = fs.readFileSync(configPath, "utf-8");
        oldConfig = JSON.parse(old_raw);
    }

    const raw = fs.readFileSync(configPath, "utf-8");
    const jsonStr = JSON.parse(raw);

    // 設定 response header 讓瀏覽器觸發下載
    res.setHeader("Content-Disposition", "attachment; filename=settings.json");
    res.setHeader("Content-Type", "application/json");
    res.send(jsonStr);
  } catch (err) {
    console.error(`sys_export error: $(err.message)`);
    return res.status(401).json({ "success": false, "message": err.message });
  }
};

export const apply_system_setting = async (req, res) => {
    try {  
        const body = req.body;
        const token = body.token;
        const action = body.action;
        
        const updateInform = req.body.update_inform === "on";

        if (action === "save") {

            let oldConfig = {};

            if (!fs.existsSync(config_dir)) {
                fs.mkdirSync(config_dir, { recursive: true });
            } else {
                const raw = fs.readFileSync(configPath, "utf-8");
                oldConfig = JSON.parse(raw);
            }

            const newConfig = { ...oldConfig, ...body, updated_at: new Date().toISOString() };

            console.log(`newConfig: ${JSON.stringify(newConfig)}`);

            fs.writeFileSync(configPath, JSON.stringify(newConfig, null, 2), "utf-8");
    
            return res.status(201).json({ success: true, message: "Apply system setting successfully", redirect: `/api/auth/account_management?token=${token}` });
        } else if (action === "reset") {
            fs.writeFileSync(configPath, JSON.stringify(default_config, null, 2));
            return res.status(201).json({ success: true, message: "Reset system setting successfully", redirect: `/api/auth/account_management?token=${token}` });
        } else if (action === "backup") {

            let oldConfig = {};

            if (!fs.existsSync(config_dir)) {
                fs.mkdirSync(config_dir, { recursive: true });
            } else if (fs.existsSync(configPath)) {
                const raw = fs.readFileSync(configPath, "utf-8");
                oldConfig = JSON.parse(raw);
            }

            const newConfig = { ...oldConfig, ...body, updated_at: new Date().toISOString() };

            console.log(`newConfig: ${JSON.stringify(newConfig)}`);

            fs.writeFileSync(configPath, JSON.stringify(newConfig, null, 2), "utf-8");

            const jsonStr = JSON.stringify(newConfig, null, 2);

            // 設定 response header 讓瀏覽器觸發下載
            res.setHeader("Content-Disposition", "attachment; filename=settings.json");
            res.setHeader("Content-Type", "application/json");
            res.send(jsonStr);

        } else if (action === "recover") {

            const fileContent = fs.readFileSync(configPath, "utf-8");
          
            if (!fs.existsSync(configPath)) {
                return res.json({ success: false, message: "No config file found" });
            }

            const settings = JSON.parse(fileContent);

            console.log("匯入設定:", settings);

            fs.writeFileSync(configPath, JSON.stringify(settings, null, 2));

            return res.status(201).json({ success: true, redirect: `/api/auth/account_management?token=${token}` });
        }

    } catch (e) {
        console.error("apply_system_setting error:", e);
        return res.status(409).json({ success: false, message: "Apply system setting failed" });
    }
};

export const recycle_bin = async (req, res) => {
    try {
        const token = req.query.token;  // 從 cookie 拿 token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        if (!token) {
          if (!decoded) {
            return res.redirect(`/api/auth/homepage`);
          }
          return res.redirect(`/api/auth/loginPage?login_role=${decoded.login_role}`); // 沒有 token 回登入頁
        }

        console.log(`decoded: ${JSON.stringify(decoded)}`);
        console.log(`decoded.name: ${decoded.name}`);

        const record = await getDiscardRecord("name", decoded.name);
        let length = 0;

        console.log(`record: ${JSON.stringify(record)}`);

        let grouped = {};

        if (record) {
            // 1. 排序 (依 created_at 從新到舊)
            record.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

            // 假設 record 是陣列
            length = Object.keys(record).length;

            // 2. 分組 (key = YYYY-MM-DD)
            grouped = record.reduce((acc, item) => {
              console.log(`item.created_at: ${item.created_at}`);
              const dateKey = item.created_at.toISOString().split("T")[0]; // Date → YYYY-MM-DD
              console.log(`dateKey: ${dateKey}`);

              if (!acc[dateKey]) {
                acc[dateKey] = [];
              }
              acc[dateKey].push(item);
              return acc;
            }, {});
            console.log(`grouped: ${JSON.stringify(grouped)}`);
        }

        return res.status(201).render("recycle_bin", 
        { layout: "base", 
          grouped_records: grouped, 
          priority: priority_from_role(decoded.role), 
          path: "/api/auth/recycle_bin", 
          id: decoded.id, 
          patient_id: `${decoded.id}-${length}`,
          name: decoded.name,
          token: token, 
          t: req.t,
          formatDateTime });
    } catch (err) {
        console.log("recycle bin error: ", err.message);
        return res.redirect("/api/auth/homepage");
    }
};

export const recycle_record = [
    upload_gb.any(), 
    async (req, res) => {
      try {
          const body = req.body;

          // generateToken(body);

          const files = req.files;

          let token = body.token;

          if (!token) {
            return res.redirect("/api/auth/homepage");
          }

          const action = body.action;
          const patientId = body.patient_id;
          const uploadDir_id = `${uploadDir}/${patientId}`;
          const uploadDir_gb_id = `${uploadDir_gb}/${patientId}`;          

          if (action === "resume") {

              if (!fs.existsSync(uploadDir_id)) {
                fs.mkdirSync(uploadDir_id, { recursive: true });
              }

              if (fs.existsSync(uploadDir_gb_id)) {
                // move the files from folder with gb to that with original ones
                const moveOk = await movefiles(uploadDir_gb_id, uploadDir_id);
                if (moveOk === false) {
                  return res.status(401).json({ success: false, message: "Files transfer failed" });
                }
              }
              
              const imgUpdates = {};
              // 儲存檔案到 patient_id 資料夾
              for (let i = 1; i <= 8; i++) {
                const fieldName = `pic${i}_2`;
                
                const file = files.find(f => f.fieldname === fieldName);
                console.log(`body[pic${i}_2]=`, body[`pic${i}_2`]);

                if (file) {

                  const filename = body[`pic${i}_2`];
                  const newPath = path.join(uploadDir_id, filename);

                  // 有新檔 → 搬移到 patient_id 資料夾
                  imgUpdates[fieldName] = newPath.replace(/\\/g, "/"); // "/" + relativePath;
                } else {
                  // 沒新檔 → 用 hidden input 傳來的舊路徑
                  imgUpdates[fieldName] = body[`pic${i}_2`] || null;
                }
              }
              
              // recover the info in database records_gb accordingly
              const record = await recoverRecord(body, imgUpdates);

              return res.status(201).json({ "success": true, "message": "Recover files successfully", redirect: `/api/auth/recycle_bin?token=${token}` });

          } else if (action === "delete") {
              
              if (fs.existsSync(uploadDir_gb_id)) {
                  // remove the files from folder with gb
                  await deletefiles(uploadDir_gb_id);
              }
              
              // remove the info in database records_gb accordingly
              const record = await deleteDiscardRecord(body);

              return res.status(201).json({ "success": true, "message": "Delete files successfully", redirect: `/api/auth/recycle_bin?token=${token}` });
          }
      } catch (err) {
          console.log("recycle bin error: ", err.message);
          return res.redirect("/api/auth/homepage");
      }
  }
];

export const signout = (req, res) => {
    res.clearCookie("token");
    res.clearCookie("Path");
    res.clearCookie("SameSite");
    console.log("✅ User signed out");
    res.status(200).render("homePage", { layout: false, message: "Logged out successfully" });
};

const send_email = async (email) => {
    //try {
        // 寄信
        const code = generateSecureSixDigitCode();
        const code_hash = await bcrypt.hash(code, 10);

        console.log(`code: ${code}`);
        console.log(`process.env.SENDGRID_API_KEY=${process.env.SENDGRID_API_KEY}`);
    
        await sgMail.send({
          from: process.env.MAIL_FROM,
          to: email,
          subject: "Verify email from Oral cancer template",
          html: `<div style="background:#f3f6fb;font-family:Arial,sans-serif;padding:30px;">
                  <div style="max-width:600px;margin:auto;background:#fff;border-radius:10px;padding:28px;box-shadow:0 6px 20px rgba(0,0,0,.06)">
                    <div style="text-align:center;padding-bottom:18px">
                      <h2 style="margin:0;color:#0b3b4a">Oral-AI 驗證碼</h2>
                    </div>
                    <p style="color:#333;font-size:15px;">您好，請於 10 分鐘內輸入以下驗證碼：</p>
                    <div style="text-align:center;margin:20px;">
                      <span style="font-size:28px;font-weight:700;letter-spacing:5px;background:#f8fbff;padding:12px 20px;border-radius:6px;display:inline-block;color:#0b5f7a;font-family:'Courier New',monospace;">
                        ${code}
                      </span>
                    </div>
                    <p style="color:#777;font-size:13px;text-align:center;">若非本人操作請忽略此信。</p>
                  </div>
                </div>`,
        });

        console.log(`code: ${code}`);
        console.log(`[send_email] code_hash: ${code_hash}`);
        return code_hash;
    //} catch (err) {
        //return null;
    //}
};

export const request = async (req, res) => {

  //try {
    const { name, email } = req.body;

    const token = jwt.sign(
        { email, name }, 
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN }
    );
    
    const register = await createRegister({ name, email });
    const code_hash = await send_email(email);

    /*
    // 寄信
    const code = generateSecureSixDigitCode();
    const code_hash = await bcrypt.hash(code, 10);

    console.info(`process.env.SENDGRID_API_KEY=${process.env.SENDGRID_API_KEY}`);
    
    await sgMail.send({
      from: process.env.MAIL_FROM,
      to: email,
      subject: "Verify email from Oral cancer template",
      html: `<p>Your Oral cancer app verification code is ${code}</p>`,
    });

    console.info(`code: ${code}`);
    */

    return res.status(201).json({ success: true, layout: false, message: "Verification email sent", redirect: `/api/auth/verify?name=${name}&email=${email}&code_hash=${code_hash}&token=${token}` });
  //} catch (err) {
  //  return res.status(401).json({ success: false, message: err.message });
  //}    
};

export const generate_qr = async (req, res) => {
    const qr_token = uuidv4();
    
    const url = `${req.protocol}://${req.get("host")}/api/auth/scan_result?qrContent=${qr_token}`;
    const expired_at = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 分鐘有效
    //const new_user = await createTempUser({ qr_token, expired_at });

    const qrImage = await QRCode.toDataURL(url);

    return res.status(201).json({
        qr_token,
        qrImage
    });
};

export const scan_result = async (req, res) => {
    try {
      const { qrContent } = req.query;

      const record = await getTempUser(qrContent);
      
      if (!record) {
          return res.status(400).json({ success: false, message: "無效的 QR Code" });
      }

      if (record.is_used) {
          return res.status(400).json({ success: false, message: "QR Code 已被使用" });
      }

      if (Date.now() > new Date(record.expired_at).getTime()) {
          return res.status(400).json({ success: false, message: "QR Code 已過期" });
      }

      // record.is_used = true;
      // const updated = await markQrUsed(qrContent);

      const token = jwt.sign(
        { qr_token: qrContent }, 
        process.env.JWT_SECRET,
        { expiresIn: config.expireTime }
      );
      
      /*
      const ws = activeSockets.get(qrContent);
      if (ws && ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ type: "authenticated", token }));
          activeSockets.delete(qrContent);
          console.info(`📡 WebSocket通知已發送 (${qrContent})`);
      }
      */
      // await redis_publisher.publish("qr_auth_notifications", JSON.stringify({ qr_token: qrContent, token }));

      res.cookie("token", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        path: '/',
      });

      // res.render("dashboard", { name: "customer", t: req.t, path: "/api/auth/dashboard", priority: priority_from_role("tester"), layout: "layout" });

      if (req.headers.accept?.includes("application/json")) {
        // 如果是 API 呼叫（手機 App）
        return res.json({ success: true, message: "登入成功", redirect: "/api/auth/dashboard", token });
      } else {
        // 如果是瀏覽器掃描
        res.cookie("token", token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "strict",
          path: "/",
        });
        
        res.render("dashboard", { 
          name: "customer", 
          t: req.t, 
          path: "/api/auth/dashboard", 
          priority: priority_from_role("tester"), 
          layout: "base" 
        });
      }

    } catch (err) {
      console.error("Scan result error:", err);
      res.status(500).json({ success: false, message: "伺服器錯誤" });
    }
};

export const verify = async(req, res) => {
    return res.status(201).render("verify", { layout: false, name: req.query.name, email: req.query.email, code_hash: req.query.code_hash, token: req.query.token });
};

export const verify_register = async (req, res) => {
    try {
        const token = req.body.token;
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        console.log(`decoded: ${JSON.stringify(decoded)}`);

        if (req.body.email !== decoded.email) {
          return res.status(401).json({ success: true, message: "Wrong email" });
        }

        const name = decoded.name;
        const email = decoded.email;
        const register = await getRegister("email", email);
        
        console.log(`register: ${JSON.stringify(register)}`);

        console.log(`req.body.code: ${req.body.code}`);
        console.log(`req.body.code_hash: ${req.body.code_hash}`);

        const id = register.id;
        let updated = null;
        const validCode = await bcrypt.compare(req.body.code, req.body.code_hash);

        if (!validCode) {
              return res.status(401).json({ 
              success: false,
              error: "Invalid credentials",
              message: "Code not correct",
          });
        }

        if (register && register.status === "pending") {
            // check code verification
            // req.body.code
            // update status into user database
            register.status = "complete";
            updated = updateRegister("id", id, register);
            updateUserTableFromRegister(id, name);
        }

        return res.status(200).json({ success: true, message: "Verify register complete", redirect: `/api/auth/changepwd?name=${name}&email=${email}` });
    } catch (err) {
        console.error("verify_register error:", err);
        return res.status(401).json({ success: false, message: err.message });
    }
};

export const quickchangepwd = (req, res) => {
  try {
    const token = req.query.token;  // 從 cookie 拿 token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (!token) {
      if (!decoded) {
        return res.redirect(`/api/auth/homepage`);
      }
      return res.redirect(`/api/auth/loginPage?login_role=${decoded.login_role}`); // 沒有 token 回登入頁
    }

    return res.status(200).render(
        "quick_changepwd", { 
            path: "/api/auth/quick_changepwd", 
            priority: priority_from_role(decoded.role), 
            layout: "base", 
            name: decoded.name,
            email: decoded.email,
            token: token,
            t: req.t });
  } catch (err) {
    console.error("quickchangepwd error:", err.message);
    return res.redirect("/api/auth/homepage");
  }
};

export const verify_quick_changepwd = async (req, res) => {
  try {
    const user = await getUser("name", req.body.name);
    const id = user.id;

    const token = req.body.token;

    if (!token) {
      return res.redirect("/api/auth/homepage"); // 沒有 token 回登入頁
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    console.log(`req.body: ${JSON.stringify(req.body)}`);
    console.log(`decoded: ${JSON.stringify(decoded)}`);

    const validPassword = await bcrypt.compare(req.body.old_password, decoded.password);

    if (!validPassword) {
      return res.status(401).json({ 
          success: false,
          error: "Invalid credentials",
          message: "Password not correct",
      });
    }

    if (req.body.password !== req.body.new_password) {
      return res.status(401).json({ 
          success: false,
          error: "Invalid credentials",
          message: "New password not the same",
      });
    }

    const updated = updateUser("id", id, req.body);

    return res.status(200).json({ 
        success: true, 
        layout: "layout", 
        path: "/api/auth/quick_changepwd", 
        message: "Verify changepwd success!" 
    });
  } catch (err) {
    return res.status(400).json({
        success: false, 
        layout: "layout",
        path: "/api/auth/quick_changepwd",
        error: "Validation failed",
        message: "User id not the same (by name/email)",
    });
  }
};

export const resend = async (req, res) => {
  try {
    const { name, email, token } = req.body;

    console.log(`name: ${name}`);
    console.log(`email: ${email}`);
    console.log(`token: ${token}`);

    const code_hash = await send_email(email);

    console.log(`[resend] code_hash: ${code_hash}`);

    return res.status(201).json({ success: true, layout: false, message: "Verification email sent", redirect: `/api/auth/verify?name=${name}&email=${email}&code_hash=${code_hash}&token=${token}` });
  } catch (err) {
    return res.status(401).json({ success: false, message: err.message });
  }    
};

export const changepwd = (req, res) => {
    console.log(`body: ${JSON.stringify(req.query)}`);
    return res.status(200).render("changepwd", { layout: false, name: req.query.name, email: req.query.email });
};

export const verify_changepwd = async (req, res) => {

    console.log(`req.body: ${JSON.stringify(req.body)}`);

    const userIdByName = await getUser("name", req.body.name);
    const userIdByEmail = await getUser("email", req.body.email);

    console.log(`userIdByName: ${JSON.stringify(userIdByName)}`);
    console.log(`userIdByEmail: ${JSON.stringify(userIdByEmail)}`);

    if (!userIdByName || !userIdByEmail) {
      return res.status(400).json({
          success: false,
          error: "Validation failed",
          message: "User not found",
      });
    }

    const id = userIdByEmail.id;

    if (userIdByEmail.id !== userIdByName.id) {
      return res.status(400).json({
          success: false,
          error: "Validation failed",
          message: "User id not the same (by name/email)",
      });
    }

    if (req.body.new_password !== req.body.password) {
      return res.status(401).json({ 
          success: false,
          error: "Invalid credentials",
          message: "Password not the same",
      });
    }

    const updated = updateUser("id", id, req.body);

    return res.status(200).json({ success: true, layout: false, message: "Verify changepwd success!", redirect: `/api/auth/loginPage?login_role=${userIdByEmail.login_role}` });
};

export const rebind_page = async (req, res) => {
    try {
        const token = req.query.token;
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        if (!token) {
          if (!decoded) {
            return res.redirect(`/api/auth/homepage`);
          }
          return res.redirect(`/api/auth/loginPage?login_role=${decoded.login_role}`); // 沒有 token 回登入頁
        }

        console.log(`decoded: ${JSON.stringify(decoded)}`);
        console.log(`decoded.role: ${decoded.role}`);

        return res.status(201).render("rebind_page", { layout: "base", priority: priority_from_role(decoded.role), path: "/api/auth/rebind_page", token: token, t: req.t });
    } catch (err) {
        console.log(`rebind_page error: `, err.message);
        return res.redirect("/api/auth/homepage");
    }
};

export const rebind_qr = async (req, res) => {
    try {
      const qr_token = uuidv4();
      const qrImage = await QRCode.toDataURL(qr_token);

      const img = qrImage.replace(/^data:image\/png;base64,/, "");
      const imgBuffer = Buffer.from(img, "base64");
      res.setHeader("Content-Type", "image/png");
      res.send(imgBuffer);
    } catch (e) {
      res.status(500).send("QR code generation failed");
    }
};

/*
export const check_has_login = async (req, res) => {
    try {
        const { qr_token } = req.params;
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.flushHeaders();

        redis_subscriber.on("message", (ch, msg) => {
            const { qr_token: t, token } = JSON.parse(msg);
            if (t === qr_token) {res.write(`data: ${token}\n\n`);}
        });
        
    } catch (err) {
        console.error("❌ Status check error:", err);
        return res.status(500).json({ success: false, message: "伺服器錯誤" });
    }
};
*/

/*
export const stream_fallback = async (req, res) => {
    const { qr_token } = req.params;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.flushHeaders();

    console.log(`👂 SSE 連線建立 (${qr_token})`);

    const handler = (channel, message) => {
      if (channel === "qr_auth_notifications") {
        const data = JSON.parse(message);
        if (data.qr_token === qr_token) {
          res.write(`data: ${JSON.stringify(data)}\n\n`);
          redis_subscriber.removeListener("message", handler);
        }
      }
    };

    redis_subscriber.on("message", handler);

    req.on("close", () => {
      redis_subscriber.removeListener("message", handler);
      res.end();
      console.log(`SSE 關閉 (${qr_token})`);
    });
};
*/