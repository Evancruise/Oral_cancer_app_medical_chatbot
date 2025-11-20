import { v4 as uuidv4 } from "uuid";
import QRCode from "qrcode";
import bcrypt from 'bcrypt';
import jwt from "jsonwebtoken";
import sgMail from "@sendgrid/mail";
import crypto from "crypto";
import { DateTime } from "luxon";
import { fileURLToPath } from "url";
import { Storage } from "@google-cloud/storage";

import fs from "fs";
import path from "path";
import multer from "multer";
import ExcelJS from "exceljs";

import { config, default_config } from "#config/config.js";
import { createUser, createRegister } from "#services/auth.service.js";
import { getRegister, updateRegister } from "#services/register.service.js";
import { updateUserPassword, updateUserTableFromRegister, updateUserGroup, 
         getUser, getAllUsers, updateUser, deleteUser, getTempUser } from "#services/user.service.js";
import { getRecord, createRecord, updateRecord, updateRecordIndividual, deleteRecord, getAllRecords,
         getDiscardRecord, deleteDiscardRecord, recoverRecord} from "#services/record.service.js";

import { signupSchema, signinSchema } from "#validations/auth.validation.js";
// import { generateToken } from "#middleware/users.middleware.js";
import { movefiles, deletefiles, deleteFilesByPrefix, deletefile } from "#utils/func.js";
import { successResponse, errorResponse } from "#utils/responses.js";

import { removeUserTable, createUsersTable } from "#services/user.service.js";
import { removeRegisterTable, createRegisterTable } from "#services/register.service.js";
import { createAppointment, deleteAppoint, getAppointment, updateAppointment, updateAppointmentStatus } from "#src/services/appointment.service.js";

console.log(`process.cwd(): ${process.cwd()}`);

const configRoot_dir = "/tmp/config";
const uploadRoot_dir = "/tmp/public";

const uploadDir = path.join(uploadRoot_dir, "uploads");
const uploadDir_gb = path.join(uploadRoot_dir, "uploads_gb");

const config_dir = configRoot_dir;
let configPath = path.join(configRoot_dir, "settings.json");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const storage_gcs = new Storage();
const bucket = storage_gcs.bucket(process.env.GCS_IMAGE_BUCKET || "Oral-images");

export async function download_from_gcs(gcsPath, localPath) {
    if (!gcsPath.startsWith("gs://")) {
      throw new Error("Invalid GCS path. Must start with gs://");
    }

    const parts = gcsPath.replace("gs://", "").split("/");
    const bucketName = parts.shift();
    const blobName = parts.join("/");

    const bucket = storage_gcs.bucket(bucketName);
    const file = bucket.file(blobName);

    await fs.promises.mkdir(path.dirname(localPath), { recursive: true });
    await file.download({ destination: localPath });

    console.log(`Downloaded GCS → ${localPath}`);
    return localPath;
}

async function countSubFolders(prefix) {
  const options = {
    prefix: prefix.endsWith("/") ? prefix : prefix + "/",
    delimeter: "/",
  };

  const [files, apiResponse] = await bucket.getFiles(options);

  const prefixes = apiResponse.prefixes || [];

  console.log("Subfolders:", prefixes);
  console.log("Count:", prefixes.length);

  return {"prefixes": prefixes, "count": prefixes.length};
}

async function countFilesInFolder(folderPath) {
  const [files] = await bucket.getFiles({
    prefix: folderPath.endsWith("/") ? folderPath : folderPath + "/",
  });

  return files.length;
}

const storage_upload = multer.diskStorage({
  destination: async (req, file, cb) => {

    const { patient_id, code } = req.query || req.body;

    console.log(`patient_id: ${patient_id}`);
    console.log(`code: ${code}`);

    if (!patient_id) {return cb(new Error("Missing patient_id"));}

    const patientDir = path.join(uploadDir, patient_id);
    //const patientDir_gb = path.join(uploadDir_gb, patient_id);
    
    //console.log(`建立 ${patientDir} 資料夾`);
    //await fs.mkdirSync(patientDir, { recursive: true });
    //console.log(`建立 ${patientDir_gb} 資料夾`);
    //await fs.mkdirSync(patientDir_gb, { recursive: true });

    cb(null, patientDir);
  },
  filename: async (req, file, cb) => {
    try {
      const { patient_id, code } = req.query || req.body;
      
      console.log(`patient_id: ${patient_id}`);
      console.log(`code: ${code}`);

      if (!patient_id) {
        return cb(new Error("Missing patient_id or code"));
      }

      // const ext = path.extname(file.originalname);
      const safePatientId = patient_id.replace("-", "_") || "unknown";
      const safeCode = code || "x";
      const prefix = safePatientId + "-" + safeCode;

      const patientDir = path.join(uploadDir, patient_id);
      const filename = `${safePatientId}-${safeCode}-${file.originalname}`;
      const filepath = path.join(uploadDir, patient_id, filename);

      console.log(`patientDir: ${patientDir}`);

      const files = fs.existsSync(patientDir) ? fs.readdirSync(patientDir) : [];

      console.log(`files: ${files}`);

      for (const file of files) {
        await deletefile(file);

        /*
        console.log(`file: ${file}, prefix: ${prefix}`);

        if (file.startsWith(prefix)) {
          const targetPath = path.join(patientDir, file);
          fs.unlinkSync(targetPath);
          console.log(`🗑️ Delete old file (prefix match): ${targetPath}`);
        }
        */
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

/*
const storage_upload = multer.diskStorage({
  destination: (req, file, cb) => {
    const patientId = req.query?.patient_id || "unknown";
    req.patientId = patientId;  // ✅ 存起來讓 filename 能用
    const uploadDir_sub = path.join(uploadDir, patientId);
    fs.mkdirSync(uploadDir_sub, { recursive: true });
    cb(null, uploadDir_sub);
  },
  filename: (req, file, cb) => {
    try {
      const patient_id = req.patientId || "unknown";
      const match = file.fieldname.match(/\d+/);
      const code = match ? match[0] : "x"; // 預設為 x，避免 undefined

      console.log(`patient_id: ${patient_id}`);

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
*/

const storage_analyze = multer.diskStorage({
  destination: (req, file, cb) => {
    const patient_id = req.body?.patient_id || "unknown";
    
    const uploadDir_sub = path.join(uploadDir_gb, patient_id);
    fs.mkdirSync(uploadDir_sub, { recursive: true });

    cb(null, uploadDir_sub);
  },
  filename: (req, file, cb) => {
    
    const patient_id = req.query?.patient_id || "unknown";
    console.log(`patient_id: ${patient_id}`);

    const filename = file.originalname;
    cb(null, filename);
  }
});

const storage_upload_gb = multer.diskStorage({
  destination: (req, file, cb) => {
    const patientId = req.body?.patient_id || "unknown";
    
    const uploadDir_sub = path.join(uploadDir_gb, patientId);
    fs.mkdirSync(uploadDir_sub, { recursive: true });

    cb(null, uploadDir_sub);
  },
  filename: (req, file, cb) => {
    try {
      const patient_id = req.patientId || "unknown";
      const match = file.fieldname.match(/\d+/);
      const code = match ? match[0] : "x";

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

/*
const upload_temp = multer({
  storage: storage_temp,
  limits: { fileSize: 50 * 1024 * 1024 },
  dest: "/tmp",
});
*/

const upload = multer({ storage: storage_upload });
const upload_analyze = multer({ storage: storage_analyze });
const upload_gb = multer({ storage: storage_upload_gb });

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const safeMoveFile = async (srcPath, destPath, patient_id, code) => {
  console.log(`destPath: ${destPath}`);

  const parts = destPath.split(/[/\\]/);
  const filename = parts[parts.length - 1];
  const fileCode = filename.split("_")[1];

  console.log(`fileCode: ${fileCode}, code: ${code}`);

  const dir = path.dirname(destPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  //try {
    const destDir = path.dirname(destPath);
    const files = fs.existsSync(destDir) ? fs.readdirSync(destDir) : [];
    
    console.log(`files: ${files}`);

    for (const file of files) {
      const filePath = path.join(destDir, file);
      console.log(`file: ${file}`);

      if (fs.existsSync(filePath) && file.startsWith(`${patient_id}_${code}_`)) {
        await deletefile(filePath);
      }
    }

    fs.renameSync(srcPath, destPath);
    console.log(`✅ 檔案已移動到 ${destPath}`);
  //} catch (err) {
  //  console.error(`❌ 移動檔案失敗: ${srcPath} → ${destPath}`, err);
  //}
};

export const cloud_upload = async (req, res) => {
  try {
    const { file } = req;
    const patient_id = req.query.patient_id;
    const destPath = `uploads/${patient_id}/${file.originalname}`;

    await buildCheckFunction.upload(file.path, { destination: destPath });
    const publicUrl = `https://storage.googleapis.com/oral-cancer-uploads/${destPath}`;

    return successResponse(res, "File uploaded successfully", { url: publicUrl });
  } catch (err) {
    return errorResponse(res, "Cloud upload failed", err.message, 500);
  }
};

export const lang_get = (req, res) => {
  res.json({
    uploaded: req.t("record.already_upload"),
    infer_again_msg: req.t("record.infer_again_msg"),
    close_msg: req.t("rebind_account.close_msg"),
    open_msg: req.t("rebind_account.open_msg")
  });
};

export const load_images_from_gcs = async () => {
    if (process.env.NODE_ENV === "production") {
       const { prefixes, count } = await countSubFolders("uploads");

       console.log(`[load_images_from_gcs] GCS folder: ${prefixes} (count: ${count})`);

       let local_images = "";

       for (const gcs_folder of prefixes) {
          for (let i = 1; i <= 8; i++) {
              local_file = `tmp/public/uploads/${gcs_folder}/${i}.jpg`;
              gcs_file = `uploads/${gcs_folder}/${i}.jpg`;

              download_from_gcs(gcs_uri, local_file);
              local_images.append(local_file);
          }
       }
    }
}

export const homepage = async (req, res) => {
  try {
    await load_images_from_gcs();
    return successResponse(res, "Homepage loaded", {
      imagesLoaded: true,
      message: "Welcome to Oral Cancer App API"
    });
  } catch(err) {
    return errorResponse(res, "Failed to load homepage", err.message, 500);
  }
};

/**
 * @swagger
 * /api/auth/processing:
 *   post:
 *     tags: [Auth]
 *     summary: Process login role before redirecting
 *     description: Accepts login_role in the body and returns redirect URL for loginPage.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - login_role
 *             properties:
 *               login_role:
 *                 type: string
 *                 example: "doctor"
 *     responses:
 *       200:
 *         description: Login role processed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Processing login role
 *                 data:
 *                   type: object
 *                   properties:
 *                     login_role:
 *                       type: string
 *                       example: doctor
 *                     redirect:
 *                       type: string
 *                       example: /api/auth/loginPage?login_role=doctor
 */
export const processing = async (req, res) => {
  const { login_role } = req.body;
  return successResponse(res, "Processing login role", {
    login_role,
    redirect: `/api/auth/loginPage?login_role=${login_role}`,
  });
};

/**
 * @swagger
 * /api/auth/register:
 *   get:
 *     tags: [Auth]
 *     summary: Load registration page configuration
 *     description: Returns required input fields and nextAction for registration flow.
 *     responses:
 *       200:
 *         description: Registration config loaded successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Register page data loaded
 *                 data:
 *                   type: object
 *                   properties:
 *                     fields:
 *                       type: array
 *                       items:
 *                         type: string
 *                       example: ["name", "email", "password", "confirm_password"]
 *                     nextAction:
 *                       type: object
 *                       properties:
 *                         type:
 *                           type: string
 *                           example: submit
 *                         path:
 *                           type: string
 *                           example: /api/auth/sign-up
 *       500:
 *         description: Failed to load registration config
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: Failed to load registration config
 *                 error:
 *                   type: string
 *                   example: Internal server error
 */
export const register = async (req, res) => {
  try {
    return successResponse(res, "Register page data loaded", {
      fields: ["name", "email", "password", "confirm_password"],
      nextAction: {
        type: "submit",
        path: "/api/auth/sign-up"
      }
    });
  } catch (error) {
    return errorResponse(res, "Failed to load registration config", error.message, 500);
  }
};

/**
 * @swagger
 * /api/auth/loginPage:
 *   get:
 *     tags: [Auth]
 *     summary: Load login page configuration
 *     description: Returns role-based default login info such as name and email.
 *     parameters:
 *       - in: query
 *         name: login_role
 *         required: false
 *         schema:
 *           type: string
 *           example: professor
 *         description: Optional. Determines if default login values should be pre-filled.
 *     responses:
 *       200:
 *         description: Login page config loaded successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Login page data
 *                 data:
 *                   type: object
 *                   properties:
 *                     login_role:
 *                       type: string
 *                       example: professor
 *                     name:
 *                       type: string
 *                       example: Dr. Smith
 *                     email:
 *                       type: string
 *                       example: dr.smith@example.com
 *       500:
 *         description: Failed to load login page config
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: Failed to load login page data
 *                 error:
 *                   type: string
 *                   example: Internal server error
 */
export const loginPage = async (req, res) => {
  try {  
    let login_role = req?.query.login_role;
    let name = "", email = "";

    if (login_role === "professor") {
        name = process.env.NAME;
        email = process.env.ACCOUNT;
    }

    return successResponse(res, "Login page data", {
      login_role, 
      name,
      email
    });
  } catch(err) {
    return errorResponse(res, "Failed to load login page data", err.message, 500);
  }
};

function generateSecureSixDigitCode() {
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  return (array[0] % 1000000).toString().padStart(6, "0");
}

/**
 * @swagger
 * /api/auth/sign-up:
 *   post:
 *     tags: [Auth]
 *     summary: Register new user
 *     description: Create a new user account
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *               role:
 *                 type: string
 *     responses:
 *       201:
 *         description: Register successful
 *       409:
 *         description: Email already exists
 */
export const signup = async (req, res) => {
  try {
    const validationResult = signupSchema.safeParse(req.body);

    if (!validationResult.success) {
      return errorResponse(res, "Validation failed", validationResult.error.format(), 400);
    }

    const { name, email, password, role } = validationResult.data;

    if (req.body.password !== req.body.password_2) {
      return errorResponse(res, "Passwords do not match", {}, 401);
    }

    const user = await createUser({ name, email, password, role });

    const token = jwt.sign(
      { id: user.id, name: user.name, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN }
    );

    return successResponse(res, "User registered successfully", {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    }, 201);

  } catch (err) {
    return errorResponse(res, "Email already exists", err.message, 409);
  }
};

/**
 * @swagger
 * /api/auth/sign-in:
 *   post:
 *     tags: [Auth]
 *     summary: User login
 *     description: Authenticate user and return JWT token
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *                 example: test@example.com
 *               password:
 *                 type: string
 *                 example: "123456"
 *     responses:
 *       200:
 *         description: Login success
 *       401:
 *         description: Invalid credentials
 */
export const signin = async (req, res) => {
  try {
    const validationResult = signinSchema.safeParse(req.body);

    if (!validationResult.success) {
      return errorResponse(res, "Validation failed", validationResult.error.format(), 400);
    }

    const { email, password } = validationResult.data;
    const user = await getUser("email", email);

    if (!user) {
      return errorResponse(res, "User not found", {}, 401);
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return errorResponse(res, "Wrong password", {}, 401);
    }

    const token = jwt.sign(
      { id: user.id, name: user.name, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: config.expireTime },
    );

    return successResponse(res, "Login successful", {
      token, 
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });

  } catch (e) {
    return errorResponse(res, "Login failed", e.message, 400);
  }
};

function priority_from_role(role) {
  let priority = 3;

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

/**
 * @swagger
 * /api/auth/dashboard
 *   get: 
 *     summary: Get user dashboard
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: token
 *         in: query
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Dashboard data loaded
 *       401:
 *         description: Unauthorized
 */
export const dashboard = async (req, res) => {
  try {
    const token = req.query.token;  // 從 cookie 拿 token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    console.log(`token: ${token}`);

    if (!token || !decoded) {
      return errorResponse(res, "Unauthorized - invalid token", {}, 401);
    }

    return successResponse(res, "Dashboard data loaded", {
      name: decoded.name,
      role: decoded.role,
      priority: priority_from_role(decoded.role),
      token,
    });
  } catch (err) {
    return errorResponse(res, "Invalid or expired token", err.message, 401);
  }
};

/**
 * @swagger
 * /api/auth/privacy:
 *   get:
 *     tags: [System]
 *     summary: Load user's privacy settings
 *     description: Validate JWT token and return the user's privacy configuration, role, and priority level.
 *     security:
 *       - bearerAuth: []  # 建議實際使用 Authorization Header，而非 query token
 *     parameters:
 *       - in: query
 *         name: token
 *         required: true
 *         schema:
 *           type: string
 *         description: JWT token (Not recommended, use Authorization header instead)
 *     responses:
 *       200:
 *         description: Privacy settings loaded successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Privacy settings loaded
 *                 data:
 *                   type: object
 *                   properties:
 *                     name:
 *                       type: string
 *                       example: John Doe
 *                     role:
 *                       type: string
 *                       example: doctor
 *                     token:
 *                       type: string
 *                       example: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
 *                     priority:
 *                       type: number
 *                       example: 2
 *       401:
 *         description: Unauthorized or missing token
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: Unauthorized or missing token
 *       500:
 *         description: Failed to load privacy settings
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: Failed to load privacy settings
 *                 error:
 *                   type: string
 *                   example: Internal server error
 */
export const privacy_setting = async (req, res) => {
  try {
    const token = req.query.token;
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (!token || !decoded) {
      return errorResponse(res, "Unauthorized or missing token", {}, 401);
    }

    return successResponse(res, "Privacy settings loaded", {
      name: decoded.name,
      role: decoded.role,
      token,
      priority: priority_from_role(decoded.role),
    });
  } catch (err) {
    console.error(err);
    return errorResponse(res, "Failed to load privacy settings", err.message, 500);
  }
};

/**
 * @swagger
 * /api/auth/privacy:
 *   post:
 *     tags: [System]
 *     summary: Save or update user's privacy settings
 *     description: Update privacy preferences for the authenticated user. Only allowed fields will be updated.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               shareAnalysis:
 *                 type: boolean
 *                 example: true
 *               allowResearch:
 *                 type: boolean
 *                 example: false
 *               notifyResult:
 *                 type: boolean
 *                 example: true
 *               notifyReminder:
 *                 type: boolean
 *                 example: false
 *     responses:
 *       200:
 *         description: Privacy settings updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Privacy settings saved successfully
 *                 data:
 *                   type: object
 *                   properties:
 *                     userId:
 *                       type: string
 *                       example: "64b123ac987f"
 *                     updatedFields:
 *                       type: object
 *                       example:
 *                         shareAnalysis: true
 *                         allowResearch: false
 *                         notifyResult: true
 *                         notifyReminder: false
 *                     nextAction:
 *                       type: object
 *                       properties:
 *                         type:
 *                           type: string
 *                           example: stay
 *       400:
 *         description: Failed to update privacy settings
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: Failed to update privacy settings
 *       401:
 *         description: Unauthorized user
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: Unauthorized user
 *       500:
 *         description: Server error while saving privacy settings
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: Unable to save privacy settings
 *                 error:
 *                   type: string
 *                   example: Internal server error
 */
export const save_privacy_setting = async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return errorResponse(res, "Unauthorized user", {}, 401);
    }

    const allowedFields = ["shareAnalysis", "allowResearch", "notifyResult", "notifyReminder"];
    const updateData = {};

    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) {
        updateData[field] = req.body[field];
      }
    });

    const updated = await updateUserGroup(allowedFields, { id: userId }, updateData);

    if (!updated || updated.length === 0) {
      return errorResponse(res, "Failed to update privacy settings", {}, 400);
    }

    return successResponse(res, "Privacy settings saved successfully", {
      userId,
      updatedFields: updateData,
      nextAction: { type: "stay" }
    });
  } catch (err) {
    console.error("save_privacy_setting error:", err);
    return errorResponse(res, "Unable to save privacy settings", err.message, 500);
  }
};

/**
 * @swagger
 * /api/auth/web_setting:
 *   get:
 *     tags: [System]
 *     summary: Retrieve web configuration and user info
 *     description: Loads current web configuration file and returns user details, role priority, and token.
 *     parameters:
 *       - in: query
 *         name: token
 *         required: true
 *         description: JWT authentication token (⚠ 建議改為 Authorization header)
 *         schema:
 *           type: string
 *           example: eyJhbGciOiJIUzI1NiIsInR...
 *     responses:
 *       200:
 *         description: Web settings loaded successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Web settings loaded successfully
 *                 data:
 *                   type: object
 *                   properties:
 *                     name:
 *                       type: string
 *                       example: Dr. Alice Chen
 *                     role:
 *                       type: string
 *                       example: admin
 *                     priority:
 *                       type: number
 *                       example: 1
 *                     token:
 *                       type: string
 *                       example: eyJhbGciOiJIUzI1NiIsInR...
 *                     config:
 *                       type: object
 *                       example:
 *                         siteTitle: Oral Cancer Management Platform
 *                         logoUrl: "/images/logo.png"
 *                         enableChatbot: true
 *                         maintenanceMode: false
 *       401:
 *         description: Missing token or unauthorized user
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: Missing token
 *       500:
 *         description: Failed to load web settings due to server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: Failed to load web settings
 *                 error:
 *                   type: string
 *                   example: Internal server error
 */
export const web_setting = async (req, res) => {
  try {
    const token = req.query.token;

    if (!token) {
      return errorResponse(res, "Missing token", {}, 401);
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    let cur_config = null;
    if (fs.existsSync(configPath)) {
      const fileContent = fs.readFileSync(configPath, "utf-8");
      cur_config = JSON.parse(fileContent);
    }

    console.log(`[web_setting] cur_config =`, cur_config);

    return successResponse(res, "Web settings loaded successfully", {
      name: decoded.name,
      role: decoded.role,
      priority: priority_from_role(decoded.role),
      token,
      config: cur_config,
    });
  } catch (err) {
    console.error(err);
    return errorResponse(res, "Failed to load web settings", err.message, 500);
  }
};

/**
 * @swagger
 * /api/auth/guideline:
 *   get:
 *     tags: [System]
 *     summary: Load system usage guideline
 *     description: Returns basic user information extracted from token and guideline access authorization.
 *     parameters:
 *       - in: query
 *         name: token
 *         required: true
 *         description: JWT authentication token (suggest using Authorization header instead)
 *         schema:
 *           type: string
 *           example: eyJhbGciOiJIUzI1NiIsInR...
 *     responses:
 *       200:
 *         description: Guideline successfully loaded
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Guideline loaded
 *                 data:
 *                   type: object
 *                   properties:
 *                     name:
 *                       type: string
 *                       example: Dr. Alice Chen
 *                     role:
 *                       type: string
 *                       example: doctor
 *                     token:
 *                       type: string
 *                       example: eyJhbGciOiJIUzI1NiIsInR...
 *       401:
 *         description: Missing or invalid token
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: Unauthorized or missing token
 *       500:
 *         description: Failed to load guideline due to server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: Failed to load guideline
 *                 error:
 *                   type: string
 *                   example: Internal server error
 */
export const guideline = async (req, res) => {
  try {
    const token = req.query.token;
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    return successResponse(res, "Guideline loaded", {
      name: decoded.name,
      role: decoded.role,
      token
    });
  } catch (err) {
    console.error(err);
    return errorResponse(res, "Failed to load guideline", err.message, 500);
  }
};

/**
 * @swagger
 * /api/auth/education:
 *   get:
 *     tags: [System]
 *     summary: Load education and learning resources
 *     description: Returns authenticated user information and provides access to educational content.
 *     parameters:
 *       - in: query
 *         name: token
 *         required: true
 *         description: JWT authentication token (⚠ 建議改為 Authorization header 方式)
 *         schema:
 *           type: string
 *           example: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
 *     responses:
 *       200:
 *         description: Education content loaded successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Education content loaded
 *                 data:
 *                   type: object
 *                   properties:
 *                     name:
 *                       type: string
 *                       example: Dr. Alice Chen
 *                     role:
 *                       type: string
 *                       example: doctor
 *                     token:
 *                       type: string
 *                       example: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
 *       401:
 *         description: Missing or invalid token
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: Unauthorized or missing token
 *       500:
 *         description: Failed to load education content due to server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: Failed to load education
 *                 error:
 *                   type: string
 *                   example: Internal server error
 */
export const education = async (req, res) => {
  try {
    const token = req.query.token;
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    return successResponse(res, "Education content loaded", {
      name: decoded.name,
      role: decoded.role,
      token
    });
  } catch (err) {
    console.error(err);
    return errorResponse(res, "Failed to load education", err.message, 500);
  }
};

/**
 * @swagger
 * /api/auth/user_setting:
 *   get:
 *     tags: [User]
 *     summary: Load user settings
 *     description: Returns basic user information such as name, role, and token for authenticated user settings page.
 *     parameters:
 *       - in: query
 *         name: token
 *         required: true
 *         description: JWT authentication token (⚠ 建議改為 Authorization header)
 *         schema:
 *           type: string
 *           example: eyJhbGciOiJIUzI1NiIsInR5cCI6Ikp...
 *     responses:
 *       200:
 *         description: User settings loaded successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: User settings loaded
 *                 data:
 *                   type: object
 *                   properties:
 *                     name:
 *                       type: string
 *                       example: John Doe
 *                     role:
 *                       type: string
 *                       example: admin
 *                     token:
 *                       type: string
 *                       example: eyJhbGciOiJIUzI1NiIsInR5cCI6Ikp...
 *       401:
 *         description: Missing or unauthorized token
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: Unauthorized or missing token
 *       500:
 *         description: Failed to load user settings due to server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: Failed to load user settings
 *                 error:
 *                   type: string
 *                   example: Internal server error
 */
export const user_setting = async (req, res) => {
  try {
    const token = req.query.token;
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    return successResponse(res, "User settings loaded", {
      name: decoded.name,
      role: decoded.role,
      token
    });
  } catch (err) {
    console.error(err);
    return errorResponse(res, "Failed to load user settings", err.message, 500);
  }
};

/**
 * @swagger
 * route: /api/auth/appointments:
 *  get: 
 *   summary: Get user's appointments
 *   tags: [Appointment]
 *   security:
 *     - vearerAuth: []
 *   response:
 *     200:
 *      description: Successfully retrieved appointments
 *     401:
 *      description: Unauthorized
 */
export const appointments = async (req, res) => {
  try {
    const token = req.query.token;
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    console.log(`decoded: ${JSON.stringify(decoded)}`);

    const appointment = await getAppointment("name", decoded.name);
    let length = 0;

    console.log(`appointment: ${JSON.stringify(appointment)}`);

    let grouped = {};

    if (appointment) {
        // 1. 排序 (依 date 從新到舊)
        appointment.sort((a, b) => new Date(b.date) - new Date(a.date));

        // 假設 appointment 是陣列
        length = Object.keys(appointment).length;

        // 2. 分組 (key = YYYY-MM-DD)
        grouped = appointment.reduce((acc, item) => {
          console.log(`item.date: ${item.date}`);
          const dateKey = item.date.toISOString().split("T")[0]; // Date → YYYY-MM-DD
          console.log(`dateKey: ${dateKey}`);

          if (!acc[dateKey]) {
            acc[dateKey] = [];
          }
          acc[dateKey].push(item);
          return acc;
        }, {});
        console.log(`grouped: ${JSON.stringify(grouped)}`);
    }

    console.log(`priority_from_role(decoded.role): ${priority_from_role(decoded.role)}`);

    return successResponse(res, "Appointments retrieved", {
      count: grouped?.length || 0,
      appointments: grouped
    });

  } catch (err) {
    return errorResponse(res, "Failed to retrieve appointments", err.message, 500);
  }
};

/**
 * @swagger
 * /api/auth/update_appointment:
 *   post:
 *     tags: [Appointment]
 *     summary: Create, edit, or delete an appointment
 *     description: Handles appointment creation, modification, or deletion based on the `action` field.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - action
 *             properties:
 *               action:
 *                 type: string
 *                 enum: [create, edit, delete]
 *                 example: create
 *               appointment_id:
 *                 type: string
 *                 example: "apt_12345"
 *               patient_id:
 *                 type: string
 *                 example: "pat_98765"
 *               doctor_id:
 *                 type: string
 *                 example: "doc_67891"
 *               date:
 *                 type: string
 *                 format: date
 *                 example: "2025-02-17"
 *               time:
 *                 type: string
 *                 format: time
 *                 example: "09:30"
 *               status:
 *                 type: string
 *                 example: "scheduled"
 *               description:
 *                 type: string
 *                 example: "Routine oral cancer follow-up"
 *     responses:
 *       200:
 *         description: Appointment action completed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Appointment updated successfully
 *                 data:
 *                   type: object
 *                   properties:
 *                     action:
 *                       type: string
 *                       example: edit
 *       400:
 *         description: Unknown action or invalid data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: Unknown action
 *       401:
 *         description: Unauthorized user or missing token
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: Unauthorized
 *       500:
 *         description: Server error while processing request
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: Failed to update appointment
 *                 error:
 *                   type: string
 *                   example: Internal server error
 */
export const update_appointment = async (req, res) => {
  try {
    const { action } = req.body;
    const userId = req.user?.id;

    if (!userId) {
      return errorResponse(res, "Unauthorized", {}, 401);
    }

    if (action === "create") {
      await createAppointment(req.body);
      return successResponse(res, "Appointment created successfully", { action });
    }

    if (action === "edit") {
      await updateAppointment(req.body);
      return successResponse(res, "Appointment updated successfully", { action });
    }

    if (action === "delete") {
      await deleteAppoint(req.body);
      return successResponse(res, "Appointment deleted successfully", { action });
    }

    return errorResponse(res, "Unknown action", {}, 400);
    
  } catch (err) {
    return errorResponse(res, "Failed to update appointment", err.message, 500);
  }
};

/**
 * @swagger
 * /api/auth/tracking:
 *   get:
 *     tags: [Tracking]
 *     summary: Retrieve user tracking data
 *     description: Validates token and returns basic tracking-related user metadata such as name, email, and role.
 *     parameters:
 *       - in: query
 *         name: token
 *         required: true
 *         description: JWT authentication token (⚠ 建議改為 Authorization header)
 *         schema:
 *           type: string
 *           example: eyJhbGciOiJIUzI1NiIsInR5cCI6...
 *     responses:
 *       200:
 *         description: Tracking data successfully retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Tracking data retrieved
 *                 data:
 *                   type: object
 *                   properties:
 *                     name:
 *                       type: string
 *                       example: Dr. Alice Chen
 *                     email:
 *                       type: string
 *                       example: alice.chen@hospital.org
 *                     role:
 *                       type: string
 *                       example: doctor
 *                     priority:
 *                       type: number
 *                       example: 2
 *       401:
 *         description: Unauthorized or invalid token
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: Unauthorized
 *       500:
 *         description: Failed to load tracking data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: Tracking failed
 *                 error:
 *                   type: string
 *                   example: Internal server error
 */
export const tracking = async (req, res) => {
  try {
    const token = req.query.token;
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    console.log(`decoded: ${JSON.stringify(decoded)}`);

    if (!token || !decoded) {
      return errorResponse(res, "Unauthorized", {}, 401);
    }

    return successResponse(res, "Tracking data retrieved", {
      name: decoded.name,
      email: decoded.email,
      role: decoded.role,
      priority: priority_from_role(decoded.role),
    });
  } catch (err) {
    return errorResponse(res, "Tracking failed", err.message, 500);
  }
};

/**
 * @swagger
 * /api/auth/update_appointment_status:
 *   post:
 *     tags: [Appointment]
 *     summary: Confirm or cancel an existing appointment
 *     description: Updates the appointment status (confirm or cancel) for the authenticated user.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - action
 *               - date
 *             properties:
 *               action:
 *                 type: string
 *                 enum: [confirm, cancel]
 *                 example: confirm
 *               date:
 *                 type: string
 *                 example: "2025-02-18"
 *     responses:
 *       200:
 *         description: Appointment status updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Appointment confirmed
 *                 data:
 *                   type: object
 *                   properties:
 *                     action:
 *                       type: string
 *                       example: confirm
 *                     nextAction:
 *                       type: object
 *                       properties:
 *                         type:
 *                           type: string
 *                           example: navigate
 *                         path:
 *                           type: string
 *                           example: /api/auth/appointments
 *       401:
 *         description: Unauthorized or missing token
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: Unauthorized or missing token
 *       500:
 *         description: Failed to update appointment status due to server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: Error occurs when updating status
 *                 error:
 *                   type: string
 *                   example: Internal server error
 */
export const update_appointment_status = async (req, res) => {
  try {
    const { token, action, date } = req.body;
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (!token || !decoded) {
      return errorResponse(res, "Unauthorized or missing token", {}, 401);
    }

    const name = decoded.name;

    if (action === "confirm") {
      await updateAppointmentStatus(name, date, "checkin", "true");
      return successResponse(res, "Appointment confirmed", { redirect: `/api/auth/appointments?token=${token}` });
    } else if (action === "cancel") {
      await updateAppointmentStatus(name, date, "checkin", "false");
      return successResponse(res, "Appointment canceled", { redirect: `/api/auth/appointments?token=${token}` });
    }
  } catch (err) {
    return errorResponse(res, "Error occurs when updating status", {}, 500);
  }
};

/**
 * @swagger
 * /api/auth/record:
 *   get:
 *     tags: [Record]
 *     summary: Retrieve grouped medical records by date
 *     description: Returns all user records grouped by date (YYYY-MM-DD) and sorted from newest to oldest.
 *     parameters:
 *       - in: query
 *         name: token
 *         description: JWT authentication token (⚠ 建議使用 Authorization header)
 *         required: false
 *         schema:
 *           type: string
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Records retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Records retrieved
 *                 data:
 *                   type: object
 *                   properties:
 *                     totalGroups:
 *                       type: number
 *                       example: 3
 *                     records:
 *                       type: object
 *                       example:
 *                         2025-02-15:
 *                           - id: "rec_123"
 *                             patient_id: "pat_001"
 *                             created_at: "2025-02-15T08:30:00.000Z"
 *                             diagnosis: "Lesion observed"
 *                         2025-02-10:
 *                           - id: "rec_122"
 *                             patient_id: "pat_002"
 *                             created_at: "2025-02-10T14:20:00.000Z"
 *                             diagnosis: "Normal"
 *       401:
 *         description: Unauthorized or missing token
 *         content:
 *           application/json:
 *             schema:
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: Unauthorized or missing token
 *       500:
 *         description: Failed to retrieve records
 *         content:
 *           application/json:
 *             schema:
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: Failed to retrieve records
 *                 error:
 *                   type: string
 *                   example: Internal server error
 */
export const record = async (req, res) => {
  try {
    const token = req.query.token || req.headers.authorization?.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const recordList = await getRecord("name", decoded.name);

    await load_images_from_gcs();

    let grouped = {};

    if (recordList && Array.isArray(recordList)) {
      // 按日期排序（created_at 越新越前面）
      recordList.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

      grouped = recordList.reduce((acc, item) => {
        const dateKey = DateTime.fromJSDate(item.created_at)
          .setZone(item.timezone || "UTC")
          .toFormat("yyyy-MM-dd");

        if (!acc[dateKey]) acc[dateKey] = [];
        acc[dateKey].push(item);
        return acc;
      }, {});
    }

    return successResponse(res, "Records retrieved", {
      totalGroups: Object.keys(grouped).length,
      records: grouped
    });
  } catch (err) {
    return errorResponse(res, "Failed to retrieve records", err.message, 500);
  }
};

/*
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
*/

export const temp_upload = [
  upload.single("file"),
  async (req, res) => {
    try {
      const file = req.file;
      const body = req.body;

      console.log(`body: ${JSON.stringify(body)}`);
      
      const patientId = body.patient_id || "unknown";
      const code = body.code || "x";
      // const content_type = req.body.contentType;

      if (!file) {
        return errorResponse(res, "No file uploaded", {}, 400);
      }

      if (process.env.NODE_ENV === "development") {
        // ============================================
        // 開發環境：存本地 (client/tmp/public/uploads)
        // ============================================

        const localUploadDir = path.join(process.cwd(), `tmp/public/uploads/`);
        const filename = `${patientId}_${code}_${file.originalname}`;
        const localPath = path.join(localUploadDir, patientId, filename);
        //fs.renameSync(file.path, localPath);

        const uploaded_path = `tmp/public/uploads/${patientId}/${filename}`;

        await safeMoveFile(file.path, localPath, patientId, code);
        console.log(`📂 [LOCAL UPLOAD] Saved at ${localPath}`);

        return successResponse(res, "File uploaded", {
          url: uploaded_path,
          env: process.env.NODE_ENV
        });

      } else if (process.env.NODE_ENV === "production") {
        // ============================================
        // 生產環境：上傳到 GCS Bucket
        // ============================================
        const localUploadDir = "tmp/public/uploads";
        // const filename = `${patientId}_${code}_${file.originalname}`;
        const localPath = `${localUploadDir}/${patientId}/${code}.jpg`;
        
        //fs.renameSync(file.path, localPath);
        
        const destPath = `${localUploadDir}/${patientId}/${code}.jpg`;
        await safeMoveFile(file.path, destPath, patientId, code);
        console.log(`📂 [LOCAL UPLOAD] Saved at ${destPath}`);

        await bucket.upload(localPath, {
          destination: destPath,
          metadata: {
            cacheControl: "public, max-age=31536000",
          },
        });

        // fs.unlinkSync(file.path);

        const publicUrl = `https://storage.googleapis.com/${process.env.GCS_IMAGE_BUCKET}/${destPath}`;
        console.log(`☁️ [GCS UPLOAD] ${publicUrl}`);

        return successResponse(res, "File uploaded successfully", {
          url: uploaded_path,
          env: process.env.NODE_ENV
        });
        
      } else {
        return errorResponse(res, `Unsupported NODE_ENV: ${process.env.NODE_ENV}`, {}, 500);
      }

    } catch (err) {
      return errorResponse(res, "Upload failed", err.message, 500);
    }
  },
];

/**
 * @swagger
 * /api/auth/new_record:
 *   post:
 *     tags: [Record]
 *     summary: Create medical record
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object 
 *             properties:
 *               patient_id:
 *                 type: string
 *                 example: P12345
 *               action:
 *                 type: string
 *                 example: "create"
 *               pic1_2:
 *                 type: string
 *                 format: binary
 *               pic2_2:
 *                 type: string
 *                 format: binary
 *               pic3_2:
 *                 type: string
 *                 format: binary
 *               pic4_2:
 *                 type: string
 *                 format: binary
 *               pic5_2:
 *                 type: string
 *                 format: binary
 *               pic6_2:
 *                 type: string
 *                 format: binary
 *               pic7_2:
 *                 type: string
 *                 format: binary
 *               pic8_2:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Record created successfully
 *       400:
 *         description: Missing file uploads or invalid data
 */
export const new_record = [
  upload.any(),
  async (req, res) => {
    try {
      const { action, patient_id } = req.body;
      const userId = req.user?.id;

      if (!userId) {
        return errorResponse(res, "Unauthorized user_id", {}, 401);
      }

      if (!patient_id) {
        return errorResponse(res, "Missing patient_id", {}, 400);
      }

      let newRecord = null;

      if (action === "create" || action === "infer") {
        newRecord = await createRecord(req.body, process.env.NODE_ENV);

        if (!newRecord || newRecord.length === 0) {
          return errorResponse(res, "Please upload all required images", {}, 400);
        }

        return successResponse(res, action === "create" 
          ? "Record created successfully" 
          : "Inference requested", {
          patient_id,
          action
        });
      }

      if (action === "check_result") {
        return successResponse(res, "Check results completed", {
          patient_id,
          action
        });
      }

      return errorResponse(res, "Unknown action", {}, 400);

    } catch (err) {
      return errorResponse(res, "Error creating record", err.message, 500);
    }
  }
];

/**
 * @swagger
 * /api/auth/edit_record:
 *   post:
 *     tags: [Record]
 *     summary: Edit or delete medical record
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               record_id:
 *                 type: string
 *                 exanple: "12"
 *               action:
 *                 type: string
 *                 enum: [save, delete, infer]
 *                 example: "save"
 *               pic1_2:
 *                 type: string
 *                 format binary
 *               pic2_2:
 *                 type: string
 *                 format: binary
 *               pic3_2:
 *                 type: string
 *                 format: binary
 *               pic4_2:
 *                 type: string
 *                 format: binary
 *               pic5_2:
 *                 type: string
 *                 format: binary
 *               pic6_2:
 *                 type: string
 *                 format: binary
 *               pic7_2:
 *                 type: string
 *                 format: binary
 *               pic8_2:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Record updated successfully
 *       401:
 *         description: Unauthorized or file transfer failed
 */
export const edit_record = [
  upload.any(),
  async (req, res) => {
    try {
      const { action, patient_id } = req.body;
      const userId = req.user?.id;

      if (!userId) {
        return errorResponse(res, "Unauthorized", {}, 401);
      }

      if (!patient_id) {
        return errorResponse(res, "Missing patient_id", {}, 400);
      }

      const uploadDir_id = `${uploadDir}/${patient_id}`;
      const uploadDir_gb_id = `${uploadDir_gb}/${patient_id}`;

      if (!fs.existsSync(uploadDir_id)) {
        fs.mkdirSync(uploadDir_id, { recursive: true });
      }

      if (action === "save") {
        const imgUpdates = {};
        for (let i = 1; i <= 8; i++) {
          const field = `pic${i}_2`;
          const file = req.files.find(f => f.fieldname === field);

          imgUpdates[field] = file
            ? path.join(uploadDir_id, file.originalname).replace(/\\/g, "/")
            : req.body[field] || null;
        }

        await updateRecord(req.body, imgUpdates, process.env.NODE_ENV);

        return successResponse(res, "Record updated successfully", {
          patient_id,
          action: "save"
        });
      }

      if (action === "delete") {
        await deleteRecord(req.body);

        if (!fs.existsSync(uploadDir_gb_id)) {
          fs.mkdirSync(uploadDir_gb_id, { recursive: true });
        }

        await movefiles(uploadDir_id, uploadDir_gb_id);

        return successResponse(res, "Record moved to recycle bin", {
          patient_id,
          action: "delete"
        });
      }

      if (action === "infer") {
        return successResponse(res, "Inference started", {
          patient_id,
          action: "infer"
        });
      }

      return errorResponse(res, "Invalid action", {}, 400);

    } catch (err) {
      return errorResponse(res, "Error updating record", err.message, 500);
    }
  }
];

/**
 * @swagger
 * /api/auth/analyze:
 *   post:
 *     tags: [Record]
 *     summary: Perform model inference
 *     description: Send images to AI model for diagosis
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               record_id:
 *                 type: string
 *                 example: "13"
 *               ai_model:
 *                 type: string
 *                 example: "oral_cancer_ai"
 *     responses:
 *       200:
 *         description: Inference started
 *       400:
 *         description: Record not found or failed
 */
export const analyze = [
  upload_analyze.any(),
  async (req, res) => {
    try {
      console.log("🧾 Received fields:", Object.keys(req.body));
      console.log("Files received:", req.files);

      const { token, patient_id, notes } = req.body;
      const task_id = uuidv4();

      if (!patient_id) {
        return errorResponse(res, "Missing patient_id", {}, 400);
      }

      // Update DB: Attach task_id to the current record
      await updateRecordIndividual("patient_id", patient_id, "task_id", task_id);

      const formData = new FormData();
      formData.append("patient_id", String(patient_id));
      formData.append("notes", String(notes || ""));
      formData.append("task_id", String(task_id));

      const logEntries = [];

      for (let i = 1; i <= 8; i++) {
        const field = `pic${i}`;
        let filePath = null;

        // Multer Uploaded files (Local: development)
        if (process.env.NODE_ENV === "development") {
          const file = req.files.find(f => f.fieldname === field);
          if (file && fs.existsSync(file.path)) {
            filePath = file.path;
            formData.append(field, fs.createReadStream(filePath));
            logEntries.push([field, filePath]);
          }
        } 
        // GCS Files (Cloud: production)
        else if (process.env.NODE_ENV === "production") {
          const gcsPath = req.body[field];
          if (!gcsPath) continue;

          const tmpPath = `/tmp/${path.basename(gcsPath)}`;
          await bucket.file(gcsPath).download({ destination: tmpPath });

          if (fs.existsSync(tmpPath)) {
            formData.append(field, fs.createReadStream(tmpPath));
            logEntries.push([field, tmpPath]);
          }
        }
      }

      // Log uploaded files
      console.log("Sending to Flask:");
      for (const [key, value] of logEntries) {
        console.log(`  ${key}:`, value);
      }

      // AI 推論 API (Flask)
      const flaskResponse = await fetch(
        `${process.env.GOOGLE_FLASK_APP_URL}/api/predict`,
        { method: "POST", body: formData }
      );

      const result = await flaskResponse.json();
      console.log("result:", result);

      if (result?.status === "ok") {
        return successResponse(res, "Inference started", {
          task_id,
          patient_id: result.patient_id,
          nextAction: {
            type: "navigate",
            path: `/api/auth/get_inference_status/${task_id}`
          }
        });
      } else {
        return errorResponse(
          res,
          "Failed to start inference",
          result?.message || "AI service returned an error",
          500
        );
      }

    } catch (err) {
      console.error("Error starting inference:", err);
      return errorResponse(
        res,
        "Server error while starting inference",
        err.message,
        500
      );
    }
  }
];

/**
 * @swagger
 * /api/auth/get_inference_status/{task_id}
 *   get:
 *     tags: [Record]
 *     summary: Get AI inference status
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: task_id
 *         schema:
 *           type: string
 *         required: true
 *         example: "inference_abc_20250208"
 *     responses:
 *       200:
 *         description: Status returned successfully
 *       404:
 *         description: Task not found
 */
export const get_inference_status = async (req, res) => {
  try {
    const { task_id } = req.params;
    if (!task_id) {
      return errorResponse(res, "Missing task_id parameter", {}, 400);
    }

    console.log(`Fetching inference status for task_id: ${task_id}`);

    // 🔍 向 Flask API 查詢推論狀態
    const response = await fetch(`${process.env.GOOGLE_FLASK_APP_URL}/api/status/${task_id}`);
    
    if (!response.ok) {
      return errorResponse(
        res,
        `Failed to fetch inference status (HTTP ${response.status})`,
        {},
        response.status
      );
    }

    const result = await response.json();
    console.log(`[get_inference_status] result=${JSON.stringify(result)}`);

    // ✅ 若推論完成 → 更新資料庫狀態
    if (result?.status === "completed") {
      console.log(`Inference complete for task_id: ${task_id}`);
      await updateRecordIndividual("task_id", task_id, "status", "completed");
    }

    // 📌 統一成功回傳格式
    return successResponse(res, "Inference status retrieved", {
      task_id,
      status: result.status,
      progress: result.progress || null,
      message: result.message || null,
      completed_at: result.completed_at || null
    });

  } catch (err) {
    console.error("Error get_inference_status:", err);
    return errorResponse(
      res,
      "Unable to get inference status",
      err.message,
      500
    );
  }
};

/**
 * @swagger
 * /api/auth/chatbot:
 *   post:
 *     tags: [Chatbot]
 *     summary: Send a message to AI chatbot and get a reply
 *     description: Sends a user prompt to the external Flask-based AI chatbot and returns the chatbot's response.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - message
 *             properties:
 *               message:
 *                 type: string
 *                 example: What are the symptoms of oral cancer?
 *     responses:
 *       200:
 *         description: Successful AI response
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 reply:
 *                   type: string
 *                   example: Oral cancer symptoms may include white or red patches, sores, or lumps.
 *       400:
 *         description: Missing or invalid message
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 reply:
 *                   type: string
 *                   example: Invalid input. 'message' is required.
 *       500:
 *         description: Chatbot service error or Flask API failure
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 reply:
 *                   type: string
 *                   example: Error happened in chatbot
 */
export const chatbot = async (req, res) => {
  try {
    const prompt = req.body.message;

    if (!prompt) {
      return errorResponse(res, "Invalid input. 'message' is required.", {}, 400);
    }

    console.log(`prompt: ${prompt}`);

    const formData = new FormData();
    formData.append("prompt", prompt);

    const response = await fetch(`${process.env.GOOGLE_FLASK_APP_URL}/api/chatgpt`, {
      method: "POST",
      body: formData
    });

    const rawText = await response.text();
    console.log("🔍 Raw Response:", rawText);

    let data;
    try {
      data = JSON.parse(rawText);
    } catch (err) {
      return errorResponse(
        res,
        "Invalid response format from chatbot service",
        rawText,
        500
      );
    }

    if (data?.status === "ok") {
      return successResponse(res, "Chatbot reply received", {
        reply: data.reply
      });
    } else {
      return errorResponse(
        res,
        "Chatbot service returned an error",
        data || {},
        500
      );
    }
  } catch (err) {
    console.error("chatbot error:", err);
    return errorResponse(
      res,
      "Server error while processing chatbot response",
      err.message,
      500
    );
  }
};

/**
 * @swagger
 * /api/auth/record_search:
 *   get:
 *     tags: [Record]
 *     summary: Search and retrieve all records grouped by date
 *     description: Retrieves all records from the database, sorts them by creation date, groups them by date (YYYY-MM-DD), and returns metadata.
 *     parameters:
 *       - in: query
 *         name: token
 *         required: true
 *         description: JWT authentication token (⚠ 建議改為 Authorization header)
 *         schema:
 *           type: string
 *           example: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
 *     responses:
 *       200:
 *         description: Records successfully retrieved and grouped
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Record search results
 *                 data:
 *                   type: object
 *                   properties:
 *                     grouped_records:
 *                       type: object
 *                       additionalProperties:
 *                         type: array
 *                         items:
 *                           type: object
 *                           example:
 *                             id: "rec_123"
 *                             patient_id: "pat_456"
 *                             diagnosis: "Oral lesion"
 *                             created_at: "2025-02-15T08:30:00.000Z"
 *                     total:
 *                       type: number
 *                       example: 5
 *                     today_date:
 *                       type: string
 *                       example: "2025-02-18"
 *       401:
 *         description: Unauthorized or missing token
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: Unauthorized or missing token
 *       500:
 *         description: Failed to search records
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: Failed to search records
 *                 error:
 *                   type: string
 *                   example: Internal server error
 */
export const record_search = async (req, res) => {
  try {
    const token = req.query.token || req.headers.authorization?.split(" ")[1];
    if (!token) {
      return errorResponse(res, "Unauthorized or missing token", {}, 401);
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    let grouped = {};
    const allRecords = await getAllRecords();

    if (allRecords && Array.isArray(allRecords)) {
      // 排序 (created_at 新 → 舊)
      allRecords.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

      // 依日期分組
      grouped = allRecords.reduce((acc, item) => {
        const dateKey = new Date(item.created_at).toISOString().split("T")[0];
        if (!acc[dateKey]) acc[dateKey] = [];
        acc[dateKey].push(item);
        return acc;
      }, {});
    }

    return successResponse(res, "Record search results", {
      grouped_records: grouped,
      total: Object.keys(grouped).length,
      today_date: new Date().toISOString().split("T")[0],
    });

  } catch (err) {
    return errorResponse(res, "Failed to search records", err.message, 500);
  }
};

/**
 * @swagger
 * /api/auth/export_data:
 *   post:
 *     tags: [Record]
 *     summary: Export medical records to Excel file
 *     description: Accepts a tableData JSON array of records and returns an auto-generated Excel (.xlsx) file for download.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               tableData:
 *                 type: string
 *                 description: JSON stringified array of record objects
 *                 example: '[{"patient_id":"PAT001","created_at":"2025-02-01","updated_at":"2025-02-10","name":"Dr. Chen","status":"Completed","notes":"Lesion found"}]'
 *     responses:
 *       200:
 *         description: Excel file generated successfully
 *         content:
 *           application/vnd.openxmlformats-officedocument.spreadsheetml.sheet:
 *             schema:
 *               type: string
 *               format: binary
 *       400:
 *         description: No data provided for export
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: No data to export
 *       500:
 *         description: Failed to generate Excel file due to server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: Export data failed
 */
export const export_data = async (req, res) => {
  try {
    console.log(`export_data req.body: ${JSON.stringify(req.body)}`);

    const rows = JSON.parse(req.body.tableData || "[]");

    if (!rows.length) {
      return errorResponse(res, "No data to export", {}, 400);
    }

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Records");

    worksheet.columns = [
      { header: "影像案例編號", key: "patient_id", width: 20 },
      { header: "建立日期", key: "created_at", width: 15 },
      { header: "上傳日期", key: "updated_at", width: 15 },
      { header: "上傳人員", key: "name", width: 15 },
      { header: "分析狀態", key: "status", width: 15 },
      { header: "備註", key: "notes", width: 30 },
    ];

    rows.forEach((r) => worksheet.addRow(r));

    // 設定回應 Headers -> Excel 檔案下載
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", "attachment; filename=records.xlsx");

    await workbook.xlsx.write(res);
    res.end();

  } catch (e) {
    console.error("export_data error:", e);
    return errorResponse(res, "Export data failed", e.message, 500);
  }
};

/**
 * @swagger
 * /api/auth/account_management:
 *   get:
 *     tags: [Admin]
 *     summary: Retrieve account management data (Admin only)
 *     description: |
 *       Retrieves all user accounts, grouped by user name, sorted by creation date.
 *       Requires a valid JWT token in `Authorization` header or `token` query parameter.
 *     parameters:
 *       - in: query
 *         name: token
 *         required: true
 *         description: Bearer JWT Token for authentication
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Successfully retrieved account management data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Account management info
 *                 data:
 *                   type: object
 *                   properties:
 *                     total:
 *                       type: integer
 *                       example: 5
 *                     grouped_records:
 *                       type: object
 *                       additionalProperties:
 *                         type: array
 *                         items:
 *                           type: object
 *                           properties:
 *                             id:
 *                               type: string
 *                               example: "usr_001"
 *                             name:
 *                               type: string
 *                               example: "Dr. Chen"
 *                             email:
 *                               type: string
 *                               example: "dr.chen@hospital.com"
 *                             role:
 *                               type: string
 *                               example: "admin"
 *                             created_at:
 *                               type: string
 *                               example: "2025-02-01T08:30:00.000Z"
 *                     name:
 *                       type: string
 *                       example: "Admin User"
 *                     email:
 *                       type: string
 *                       example: "admin@mail.com"
 *                     role:
 *                       type: string
 *                       example: "admin"
 *                     today_date:
 *                       type: string
 *                       example: "2025-02-14"
 *       401:
 *         description: Unauthorized or invalid token
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: Unauthorized
 *       500:
 *         description: Server error while retrieving accounts
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: Failed to load account management data
 */
export const account_management = async (req, res) => {
    try {
      let token = req.query.token?.trim().replace(/^"|"$/g, "");  // 從 cookie 拿 token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

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

      return successResponse(res, "Account management info", {
        grouped_records: grouped,
        total: Object.keys(grouped).length,
        name: decoded.name,
        email: decoded.email,
        role: decoded.role,
        cur_config: cur_config,
        today_date: new Date().toISOString().split("T")[0],
      });
    } catch(err) {
      return errorResponse(res, "Unauthorized", err.message, 401);
    }
};

/**
 * @swagger
 * /api/auth/new_account:
 *   post:
 *     tags: [Account]
 *     summary: Create a new user account
 *     description: |
 *       Allows admin to create a new user account with role, unit, usage status and notes.
 *       Token is required for authentication.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - email
 *               - password
 *               - role
 *             properties:
 *               token:
 *                 type: string
 *                 description: JWT authentication token
 *                 example: eyJhbGciOiJIUzI1NiIsInR...
 *               name:
 *                 type: string
 *                 example: "Dr. Alice Chen"
 *               email:
 *                 type: string
 *                 example: "alice.chen@hospital.org"
 *               password:
 *                 type: string
 *                 example: "SecurePass123"
 *               role:
 *                 type: string
 *                 example: "tester"
 *               unit:
 *                 type: string
 *                 example: "Department of Oral Medicine"
 *               is_used:
 *                 type: boolean
 *                 example: true
 *               notes:
 *                 type: string
 *                 example: "Senior researcher account"
 *     responses:
 *       201:
 *         description: Account created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Create new account successfully
 *                 redirect:
 *                   type: string
 *                   example: /api/auth/account_management?token=eyJhbGci...
 *       409:
 *         description: Email already exists or duplicate account
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: Email already exists
 *       401:
 *         description: Unauthorized or missing token
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: Unauthorized or missing token
 *       500:
 *         description: Server error while creating account
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: Internal server error
 */
export const new_account = async (req, res) => {
  try {
    console.log("new_account event triggered!");

    const { token, name, email, password, unit, role, is_used, notes } = req.body;
    const normalizedToken = token?.replace(/^"|"$/g, "").trim();

    if (!normalizedToken) {
      return errorResponse(res, "Missing token", {}, 401);
    }

    // 建議你的驗證邏輯可以統一改為 Authorization Header
    // const decoded = jwt.verify(normalizedToken, process.env.JWT_SECRET);

    // 建立使用者
    const user = await createUser({ name, email, password, role, unit, is_used, notes });

    if (!user) {
      return errorResponse(res, "Failed to create new account", {}, 400);
    }

    return successResponse(res, "Create new account successfully", {
      user,
      nextAction: {
        type: "navigate",
        path: `/api/auth/account_management?token=${normalizedToken}`,
      }
    });

  } catch (e) {
    console.error("new_account error:", e);
    return errorResponse(res, "Email already exists or server error", e.message, 500);
  }
};

/**
 * @swagger
 * /api/auth/edit_account:
 *   post:
 *     tags: [Account]
 *     summary: Edit or delete a user account
 *     description: >
 *       Updates or deletes an account based on the `action` field.  
 *       Supports "save" for updating, and "delete" for removing the account.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - action
 *               - name
 *             properties:
 *               token:
 *                 type: string
 *                 example: eyJh...
 *               action:
 *                 type: string
 *                 enum: [save, delete]
 *                 example: save
 *               name:
 *                 type: string
 *                 example: "Alice Chen"
 *               email:
 *                 type: string
 *                 example: "alice.chen@hospital.org"
 *               role:
 *                 type: string
 *                 example: "admin"
 *               notes:
 *                 type: string
 *                 example: "Department supervisor"
 *     responses:
 *       200:
 *         description: Account updated or deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Edit account successfully
 *                 data:
 *                   type: object
 *                   example:
 *                     nextAction:
 *                       type: navigate
 *                       path: /api/auth/account_management
 *       400:
 *         description: Invalid or missing information
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Unauthorized or missing token
 *       500:
 *         description: Server error
 */
export const edit_account = async (req, res) => {
  try {
    const { token, action, name, ...updateData } = req.body;

    if (!token) {
      return errorResponse(res, "Missing token", {}, 401);
    }

    const normalizedToken = token.replace(/^"|"$/g, "").trim();

    if (!action || !name) {
      return errorResponse(res, "Missing required fields (action, name)", {}, 400);
    }

    console.log("Action:", action);
    console.log("Update Data:", updateData);

    let result;

    if (action === "save") {
      result = await updateUser("name", name, updateData);
      if (!result) {
        return errorResponse(res, "Failed to update account", {}, 400);
      }
      return successResponse(res, "Edit account successfully", {
        updatedUser: result,
        nextAction: { type: "navigate", path: "/api/auth/account_management" }
      });
    }

    if (action === "delete") {
      result = await deleteUser("name", name);
      return successResponse(res, "Delete account successfully", {
        deletedUser: result,
        nextAction: { type: "navigate", path: "/api/auth/account_management" }
      });
    }

    return errorResponse(res, "Unknown action", { action }, 400);

  } catch (err) {
    console.error("edit_account error:", err);
    return errorResponse(res, "Server error editing account", err.message, 500);
  }
};

/**
 * @swagger
 * /api/auth/apply_account_setting:
 *   post:
 *     tags: [Account]
 *     summary: Apply updates to account settings (save, reset, init)
 *     description: >
 *       Handles configuration file updates for account/system settings.  
 *       Support actions:  
 *       • `save` → Merge and store new configuration  
 *       • `reset` → Restore default settings  
 *       • `init` → Reinitialize database tables  
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - action
 *             properties:
 *               token:
 *                 type: string
 *                 example: eyJhb...
 *               action:
 *                 type: string
 *                 enum: [save, reset, init]
 *                 example: save
 *               name:
 *                 type: string
 *                 example: "admin"
 *               unit:
 *                 type: string
 *                 example: "Oncology Dept."
 *               system_theme:
 *                 type: string
 *                 example: "dark"
 *     responses:
 *       200:
 *         description: Setting applied successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Update account setting successfully
 *                 data:
 *                   type: object
 *                   example:
 *                     action: save
 *                     updatedConfig:
 *                       system_theme: dark
 *                       updated_at: 2025-01-20T10:24:18.123Z
 *                     nextAction:
 *                       type: navigate
 *                       path: /api/auth/web_setting
 *       400:
 *         description: Invalid input or missing data
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
export const apply_account_setting = async (req, res) => {
  try {
    const { token, action, ...configData } = req.body;
    console.log("body:", req.body);

    if (!token) {
      return errorResponse(res, "Missing token", {}, 401);
    }

    if (!action) {
      return errorResponse(res, "Missing required field: action", {}, 400);
    }

    let resultData = {};

    // SAVE CONFIG
    if (action === "save") {
      if (!fs.existsSync(config_dir)) {
        fs.mkdirSync(config_dir, { recursive: true });
      }

      let oldConfig = {};
      if (fs.existsSync(configPath)) {
        const raw = fs.readFileSync(configPath, "utf-8");
        oldConfig = JSON.parse(raw);
      }

      const newConfig = { ...oldConfig, ...configData, updated_at: new Date().toISOString() };
      fs.writeFileSync(configPath, JSON.stringify(newConfig, null, 2), "utf-8");

      resultData = { action, updatedConfig: newConfig };
      return successResponse(res, "Update account setting successfully", {
        ...resultData,
        nextAction: { type: "navigate", path: "/api/auth/web_setting" }
      });
    }

    // RESET CONFIG
    if (action === "reset") {
      fs.writeFileSync(configPath, JSON.stringify(default_config, null, 2));
      resultData = { action };
      return successResponse(res, "Reset account setting successfully", {
        ...resultData,
        nextAction: { type: "navigate", path: "/api/auth/web_setting" }
      });
    }

    // INIT DATABASE
    if (action === "init") {
      removeUserTable();
      createUsersTable();
      removeRegisterTable();
      createRegisterTable();

      resultData = { action };
      return successResponse(res, "Init account setting successfully", {
        ...resultData,
        nextAction: { type: "navigate", path: "/api/auth/web_setting" }
      });
    }

    return errorResponse(res, "Unknown action", { action }, 400);

  } catch (err) {
    console.error("apply_account_setting error:", err);
    return errorResponse(res, "Apply account setting failed", err.message, 500);
  }
};

/**
 * @swagger
 * /api/auth/sys_import:
 *   post:
 *     tags: [System]
 *     summary: Import system configuration file
 *     description: >
 *       Upload and apply system configuration via JSON file.  
 *       The request must use `multipart/form-data` with a file named `file`.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - file
 *               - token
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: JSON configuration file
 *               token:
 *                 type: string
 *                 example: eyJhbGciOiJIUzI1Ni...
 *     responses:
 *       200:
 *         description: Configuration imported successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Configuration imported successfully
 *                 data:
 *                   type: object
 *                   example:
 *                     updated_at: "2025-01-22T10:21:54.111Z"
 *                     nextAction:
 *                       type: navigate
 *                       path: /api/auth/web_setting
 *       400:
 *         description: Invalid file or JSON format
 *       401:
 *         description: Unauthorized or missing token
 *       500:
 *         description: Server error
 */
export const sys_import = async (req, res) => {
  try {
    if (!req.file) {
      return errorResponse(res, "No file uploaded", {}, 400);
    }

    const token = req.body.token?.trim();
    if (!token) {
      return errorResponse(res, "Missing token", {}, 401);
    }

    let settings;
    try {
      settings = JSON.parse(req.file.buffer.toString("utf-8"));
    } catch (err) {
      return errorResponse(res, "Invalid JSON format", err.message, 400);
    }

    console.log("Imported Settings:", settings);

    fs.writeFileSync(configPath, JSON.stringify(settings, null, 2));
    const updatedAt = new Date().toISOString();

    return successResponse(res, "Configuration imported successfully", {
      updated_at: updatedAt,
      nextAction: { type: "navigate", path: "/api/auth/web_setting" }
    });

  } catch (err) {
    console.error("sys_import error:", err);
    return errorResponse(res, "System import failed", err.message, 500);
  }
};

/**
 * @swagger
 * /api/auth/reset:
 *   post:
 *     tags: [System]
 *     summary: Reset system configuration to default
 *     description: >
 *       Restores the system configuration back to `default_config.json`.  
 *       Requires a valid authentication token in the request body.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - token
 *             properties:
 *               token:
 *                 type: string
 *                 example: eyJh...
 *     responses:
 *       201:
 *         description: System reset successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: System reset successfully
 *                 data:
 *                   type: object
 *                   example:
 *                     redirect: "/api/auth/web_setting?token=eyJh..."
 *       400:
 *         description: Missing or invalid token
 *       500:
 *         description: Server error occurred during reset
 */
export const reset = async (req, res) => {
  try {  
    const { token } = req.body;

    if (!token) {
      return errorResponse(res, "Missing token", {}, 400);
    }

    fs.writeFileSync(configPath, JSON.stringify(default_config, null, 2));
    
    return successResponse(res, "System reset successfully", {
      redirect: `/api/auth/web_setting?token=${token}`,
    }, 201);

  } catch (err) {
    return errorResponse(res, "Reset failed", err.message, 500);
  }
};


/**
 * @swagger
 * /api/auth/sys_export:
 *   get:
 *     tags: [System]
 *     summary: Export system configuration file
 *     description: >
 *       Exports the current system configuration as a downloadable JSON file.  
 *       Success response is a **file stream**, not JSON.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Configuration JSON file will be downloaded
 *         content:
 *           application/octet-stream:
 *             schema:
 *               type: string
 *               format: binary
 *       500:
 *         description: Failed to export configuration
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
export const sys_export = async (req, res) => {
  try {  
    let oldConfig = {};

    if (!fs.existsSync(config_dir)) {
      fs.mkdirSync(config_dir, { recursive: true });

      const newConfig = { ...oldConfig, ...config, updated_at: new Date().toISOString() };
      console.log(`newConfig: ${JSON.stringify(newConfig)}`);
      fs.writeFileSync(configPath, JSON.stringify(newConfig, null, 2), "utf-8");
    } 
    else {
      const old_raw = fs.readFileSync(configPath, "utf-8");
      oldConfig = JSON.parse(old_raw);
    }

    const raw = fs.readFileSync(configPath, "utf-8");
    const jsonStr = JSON.parse(raw);

    // 設定下載 response header
    res.setHeader("Content-Disposition", "attachment; filename=settings.json");
    res.setHeader("Content-Type", "application/json");

    // 直接返回 JSON 文件 (Download)
    return res.send(jsonStr);

  } catch (err) {
    return errorResponse(res, "Export failed", err.message, 500);
  }
};

/**
 * @swagger
 * /api/auth/system_setting:
 *   post:
 *     tags: [System]
 *     summary: Apply, reset, backup, or recover system settings
 *     description: >
 *       Handles multiple system setting management actions:  
 *       **save** (update settings),  
 *       **reset** (restore to default),  
 *       **backup** (export settings file),  
 *       **recover** (restore from file)  
 *       <br>  
 *       The `backup` action will trigger a file download, while others return JSON.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               token:
 *                 type: string
 *               action:
 *                 type: string
 *                 enum: [save, reset, backup, recover]
 *                 example: save
 *               settings:
 *                 type: object
 *                 description: Settings object (required when action = "save")
 *     responses:
 *       200:
 *         description: System settings successfully applied
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       401:
 *         description: Unauthorized or invalid token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       400:
 *         description: Invalid action or bad request
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Server error while applying settings
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
export const apply_system_setting = async (req, res) => {
  try {
    const { token, action, ...settings } = req.body;

    if (!action) {
      return errorResponse(res, "Invalid action", {}, 400);
    }

    // Save new settings
    if (action === "save") {
      let oldConfig = {};

      if (!fs.existsSync(config_dir)) {
        fs.mkdirSync(config_dir, { recursive: true });
      } else if (fs.existsSync(configPath)) {
        oldConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      }

      const newConfig = { ...oldConfig, ...settings, updated_at: new Date().toISOString() };
      fs.writeFileSync(configPath, JSON.stringify(newConfig, null, 2), "utf-8");

      return successResponse(res, "System setting applied", {
        redirect: `/api/auth/web_setting?token=${token}`,
      });
    }

    // Reset to default config
    if (action === "reset") {
      fs.writeFileSync(configPath, JSON.stringify(default_config, null, 2));
      return successResponse(res, "System reset", {
        redirect: `/api/auth/web_setting?token=${token}`,
      });
    }

    // Export settings as file
    if (action === "backup") {
      let oldConfig = {};

      if (!fs.existsSync(config_dir)) {
        fs.mkdirSync(config_dir, { recursive: true });
      }

      if (fs.existsSync(configPath)) {
        oldConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      }

      const newConfig = { ...oldConfig, ...settings, updated_at: new Date().toISOString() };
      fs.writeFileSync(configPath, JSON.stringify(newConfig, null, 2));

      res.setHeader("Content-Disposition", "attachment; filename=settings.json");
      res.setHeader("Content-Type", "application/json");
      return res.send(newConfig);
    }

    // Restore from current config file
    if (action === "recover") {
      if (!fs.existsSync(configPath)) {
        return errorResponse(res, "No config file found", {}, 404);
      }

      const settingsData = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      return successResponse(res, "System backup recovered", {
        settings: settingsData,
      });
    }

    return errorResponse(res, "Invalid action", {}, 400);

  } catch (err) {
    return errorResponse(res, "Failed to apply system settings", err.message, 500);
  }
};

/**
 * @swagger
 * /api/auth/recycle_bin:
 *   get:
 *     tags: [Record]
 *     summary: Retrieve discarded (deleted) records
 *     description: >
 *       Get all discarded records (moved to recycle bin) of the authenticated user,  
 *       grouped by date (YYYY-MM-DD) and sorted by newest first.
 *     parameters:
 *       - in: query
 *         name: token
 *         required: true
 *         schema:
 *           type: string
 *         description: JWT token obtained after login
 *     responses:
 *       200:
 *         description: Discarded records successfully retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     totalGroups:
 *                       type: integer
 *                     records:
 *                       type: object
 *                       additionalProperties:
 *                         type: array
 *                         items:
 *                           type: object
 *                           description: Record details
 *       401:
 *         description: Missing or invalid token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Failed to retrieve discarded records
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
export const recycle_bin = async (req, res) => {
  try {
    const token = req.query.token;
    if (!token) {
      return errorResponse(res, "Missing token", {}, 401);
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const record = await getDiscardRecord("name", decoded.name);
    let grouped = {};

    if (record && Array.isArray(record)) {
      // 1️⃣ Sort newest first
      record.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

      // 2️⃣ Group by date (YYYY-MM-DD)
      grouped = record.reduce((acc, item) => {
        const dateKey = item.created_at.toISOString().split("T")[0];
        if (!acc[dateKey]) acc[dateKey] = [];
        acc[dateKey].push(item);
        return acc;
      }, {});
    }

    return successResponse(res, "Discarded records retrieved", {
      totalGroups: Object.keys(grouped).length,
      records: grouped
    });

  } catch (err) {
    return errorResponse(res, "Failed to retrieve discarded records", err.message, 500);
  }
};

/**
 * @swagger
 * /api/auth/recycle_record:
 *   post:
 *     tags: [Record]
 *     summary: Restore or permanently delete record
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         multipart/form-data
 *           schema:
 *             type: object
 *             properties:
 *               record_id:
 *                 type: string
 *                 example: "10"
 *               patient_id:
 *                 type: string
 *                 example: "P12345"
 *               action:
 *                 type: string
 *                 example: "resume"
 *     responses:
 *       201:
 *         description: Record action completed
 *       400:
 *         description: Files transfer failed ot invalid id
 */
export const recycle_record = [
  upload_gb.any(),
  async (req, res) => {
    try {
      const { action, patient_id } = req.body;

      if (!action || !patient_id) {
        return errorResponse(res, "Missing required fields: action, patient_id", {}, 400);
      }

      const { id: userId } = req.user; // 從 Authorization header 解出
      const uploadDir_id = `${uploadDir}/${patient_id}`;
      const uploadDir_gb_id = `${uploadDir_gb}/${patient_id}`;

      if (action === "resume") {
        if (!fs.existsSync(uploadDir_id)) {
          fs.mkdirSync(uploadDir_id, { recursive: true });
        }

        if (fs.existsSync(uploadDir_gb_id)) {
          const moveOk = await movefiles(uploadDir_gb_id, uploadDir_id);
          if (!moveOk) {
            return errorResponse(res, "Files transfer failed", {}, 500);
          }
        }

        const imgUpdates = {};
        for (let i = 1; i <= 8; i++) {
          const fieldName = `pic${i}_2`;
          const file = req.files.find(f => f.fieldname === fieldName);

          imgUpdates[fieldName] = file
            ? path.join(uploadDir_id, file.originalname).replace(/\\/g, "/")
            : req.body[fieldName] || null;
        }

        await recoverRecord(req.body, imgUpdates);

        return successResponse(res, "Files restored successfully", {
          patient_id,
          action: "resume"
        });
      }

      if (action === "delete") {
        if (fs.existsSync(uploadDir_gb_id)) {
          await deletefiles(uploadDir_gb_id);
        }

        await deleteDiscardRecord(req.body);

        return successResponse(res, "Files deleted successfully", {
          patient_id,
          action: "delete"
        });
      }

      return errorResponse(res, "Invalid action", {}, 400);

    } catch (err) {
      console.error("recycle_record error:", err.message);
      return errorResponse(res, "Internal server error", err.message, 500);
    }
  }
];

/**
 * @swagger
 * /api/auth/sign-out:
 *   get:
 *     tags: [Auth]
 *     summary: Sign out
 *     description: Clear session or remove token
 *     responses:
 *       200:
 *         description: Logged out
 */
export const signout = (req, res) => {
    res.clearCookie("token");
    return successResponse(res, "Signout successfully");
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

/**
 * @swagger
 * /api/auth/request:
 *   post:
 *     tags: [Auth]
 *     summary: Request email verification
 *     description: >
 *       Generates a temporary JWT token, stores basic registration info,  
 *       sends verification email with a hashed code, and returns redirect info.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - email
 *             properties:
 *               name:
 *                 type: string
 *                 example: John Doe
 *               email:
 *                 type: string
 *                 format: email
 *                 example: john@example.com
 *     responses:
 *       200:
 *         description: Verification email sent successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Verification email sent
 *                 data:
 *                   type: object
 *                   properties:
 *                     redirect:
 *                       type: string
 *                       example: /api/auth/verify?name=John&email=john@example.com&code_hash=xxxx&token=yyyy
 *       400:
 *         description: Missing or invalid input fields
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Failed to send verification email
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
export const request = async (req, res) => {
  try {
    const { name, email } = req.body;

    if (!name || !email) {
      return errorResponse(res, "Name and email are required", {}, 400);
    }

    // Create temporary token
    const token = jwt.sign(
      { email, name },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN }
    );

    // Save registration info
    await createRegister({ name, email });

    // Send verification email
    const code_hash = await send_email(email);

    return successResponse(res, "Verification email sent", {
      redirect: `/api/auth/verify?name=${name}&email=${email}&code_hash=${code_hash}&token=${token}`
    });
  } catch (err) {
    return errorResponse(res, "Failed to verify email", err.message, 500);
  }
};

/**
 * @swagger
 * /api/auth/generate_qr:
 *   post:
 *     tags: [Auth]
 *     summary: Generate QR Code for login or verification
 *     description: >
 *       Generates a QR code token, constructs a URL for scanning,  
 *       produces a Base64 encoded QR image, and sets an expiration timestamp.
 *     responses:
 *       200:
 *         description: QR code generated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: QR generated successfully
 *                 data:
 *                   type: object
 *                   properties:
 *                     qr_token:
 *                       type: string
 *                       example: "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
 *                     qrImage:
 *                       type: string
 *                       format: byte
 *                       description: Base64 encoded QR image (Data URI)
 *                       example: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA..."
 *                     expired_at:
 *                       type: string
 *                       format: date-time
 *                       example: "2025-01-18T14:30:00.000Z"
 *       500:
 *         description: Failed to generate QR code
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
export const generate_qr = async (req, res) => {
  try {
    const qr_token = uuidv4();
    
    const url = `${req.protocol}://${req.get("host")}/api/auth/scan_result?qrContent=${qr_token}`;
    const expired_at = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    const qrImage = await QRCode.toDataURL(url);

    return successResponse(res, "QR generated successfully", {
      qr_token,
      qrImage,
      expired_at
    });

  } catch (err) {
    console.error("generate_qr error:", err);
    return errorResponse(res, "Failed to generate QR code", err.message, 500);
  }
};

/** 
 * @swagger
 * /api/auth/scan_result:
 *   post:
 *     tags: [Record]
 *     summary: Scan QR code & bind user to device
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               qrContent:
 *                 type: string
 *                 example: "temp_bind_abd135"
 *     responses:
 *       200:
 *         description: QR scan successful
 *       400:
 *         description: Invalid QR or expired
*/
export const scan_result = async (req, res) => {
    try {
      const { qrContent } = req.query;

      const record = await getTempUser(qrContent);
      
      if (!record) {
          return errorResponse(res, "Invalid QR Code", {}, 400);
      }

      if (record.is_used) {
          return errorResponse(res, "QR Code already used", {}, 400);
      }

      if (Date.now() > new Date(record.expired_at).getTime()) {
          return errorResponse(res, "QR Code expired", {}, 400);
      }

      const token = jwt.sign(
        { qr_token: qrContent }, 
        process.env.JWT_SECRET,
        { expiresIn: config.expireTime }
      );
      
      return successResponse(res, "QR login successful", { token, redirect: `/api/auth/dashboard?token=${token}`});
    } catch (err) {
      return errorResponse(res, "QR login failed", err.message, 500);
    }
};

/**
 * @swagger
 * /api/auth/verify:
 *   get:
 *     tags: [Auth]
 *     summary: Load verification page data
 *     description: Returns the user information and verification hash sent via email.
 *     parameters:
 *       - in: query
 *         name: name
 *         required: true
 *         schema:
 *           type: string
 *         description: User's name
 *         example: "John Doe"
 *       - in: query
 *         name: email
 *         required: true
 *         schema:
 *           type: string
 *         description: User's email address
 *         example: "johndoe@mail.com"
 *       - in: query
 *         name: code_hash
 *         required: true
 *         schema:
 *           type: string
 *         description: Hashed verification code (sent to email)
 *         example: "$2b$10$qkq93UsVxvXUy"
 *     responses:
 *       200:
 *         description: Verification data loaded successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Load verify page data
 *                 data:
 *                   type: object
 *                   properties:
 *                     name:
 *                       type: string
 *                       example: "John Doe"
 *                     email:
 *                       type: string
 *                       example: "johndoe@mail.com"
 *                     code_hash:
 *                       type: string
 *                       example: "$2b$10$qkq93UsVxvXUy"
 *       500:
 *         description: Failed to load verification data
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
export const verify = async (req, res) => {
  try {
    return successResponse(res, "Load verify page data", {
      name: req.query.name,
      email: req.query.email,
      code_hash: req.query.code_hash
    });
  } catch (err) {
    return errorResponse(res, "Failed to load verification data", err.message, 500);
  }
};

/**
 * @swagger
 * /api/auth/verify_register:
 *   post:
 *     tags: [Auth]
 *     summary: Verify user email and complete registration
 *     description: >
 *       Validates the email verification code, updates registration status to `complete`,
 *       and activates user account.  
 *       Returns redirect path to password setup page upon success.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - token
 *               - email
 *               - code
 *               - code_hash
 *             properties:
 *               token:
 *                 type: string
 *                 description: JWT token containing user info
 *                 example: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
 *               email:
 *                 type: string
 *                 example: johndoe@mail.com
 *               code:
 *                 type: string
 *                 example: "834792"
 *               code_hash:
 *                 type: string
 *                 example: "$2b$10$qkq93UsVxvXUy"
 *     responses:
 *       200:
 *         description: Email verified successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Email verified successfully
 *                 data:
 *                   type: object
 *                   properties:
 *                     email:
 *                       type: string
 *                       example: johndoe@mail.com
 *                     name:
 *                       type: string
 *                       example: John Doe
 *                     registered:
 *                       type: boolean
 *                       example: true
 *                     redirect:
 *                       type: string
 *                       example: /api/auth/changepwd?name=John%20Doe&email=johndoe@mail.com
 *       400:
 *         description: Invalid email or verification code
 *       500:
 *         description: Server error during verification
 */
export const verify_register = async (req, res) => {
  try {
    const { token, email, code, code_hash } = req.body;

    if (!token || !email || !code || !code_hash) {
      return errorResponse(res, "Missing required fields", {}, 400);
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (email !== decoded.email) {
      return errorResponse(res, "Wrong email", {}, 400);
    }

    const register = await getRegister("email", email);
    if (!register) {
      return errorResponse(res, "Registration record not found", {}, 404);
    }

    const validCode = await bcrypt.compare(code, code_hash);
    if (!validCode) {
      return errorResponse(res, "Invalid verification code", {}, 400);
    }

    if (register.status === "pending") {
      register.status = "complete";
      await updateRegister("id", register.id, register);
      await updateUserTableFromRegister(register.id, decoded.name);
    }

    return successResponse(res, "Email verified successfully", {
      email: decoded.email,
      name: decoded.name,
      registered: true,
      redirect: `/api/auth/changepwd?name=${decoded.name}&email=${decoded.email}`
    });
  } catch (err) {
    return errorResponse(res, "Verification failed", err.message, 500);
  }
};

/**
 * @swagger
 * /api/auth/quick_changepwd:
 *   post:
 *     tags: [Auth]
 *     summary: Quick change password
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               old_password:
 *                 type: string
 *               new_password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Password updated
 *       401:
 *         description: Unauthorized
 */
export const quickchangepwd = async (req, res) => {
  try {
    const token = req.query.token;
    if (!token) {
      return errorResponse(res, "Missing token", {}, 401);
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (e) {
      return errorResponse(res, "Invalid or expired token", {}, 401);
    }

    return successResponse(res, "Quick change password data loaded", {
      name: decoded.name,
      email: decoded.email,
      role: decoded.role,
      priority: priority_from_role(decoded.role),
      token
    });

  } catch (err) {
    return errorResponse(res, "Failed to load quick change password data", err.message, 500);
  }
};

/**
 * @swagger
 * /api/auth/verify_quick_changepwd:
 *   post:
 *     tags: [Auth]
 *     summary: Quickly change password using old password
 *     description: >
 *       Allows a logged-in user to update their password by providing the current (old) password.  
 *       Requires Authorization Bearer token in header.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - old_password
 *               - new_password
 *             properties:
 *               name:
 *                 type: string
 *                 example: John Doe
 *               old_password:
 *                 type: string
 *                 example: "oldPass123"
 *               new_password:
 *                 type: string
 *                 example: "newSecurePass456"
 *     responses:
 *       200:
 *         description: Password updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Password updated successfully
 *       400:
 *         description: New password does not meet requirements
 *       401:
 *         description: Invalid or incorrect password
 *       404:
 *         description: User not found
 *       500:
 *         description: Server error while processing password change
 */
export const verify_quick_changepwd = async (req, res) => {
  try {
    const { name, old_password, new_password } = req.body;
    const { email } = req.user; // Retrieved from Authorization header

    const user = await getUser("email", email);
    if (!user) {
      return errorResponse(res, "User not found", {}, 404);
    }

    const validPassword = await bcrypt.compare(old_password, user.password);
    if (!validPassword) {
      return errorResponse(res, "Old password is incorrect", {}, 401);
    }

    if (!new_password || new_password.length < 6) {
      return errorResponse(res, "New password does not meet requirements", {}, 400);
    }

    await updateUserPassword(user.id, new_password);

    return successResponse(res, "Password updated successfully");
  } catch (err) {
    return errorResponse(res, "Failed to update password", err.message, 500);
  }
};

/**
 * @swagger
 * /api/auth/resend:
 *   post:
 *     tags: [Auth]
 *     summary: Resend verification email
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *               name:
 *                 type: string
 *     responses:
 *       201:
 *         description: Email sent
 *       400:
 *         description: Missing email or name
 */
export const resend = async (req, res) => {
  try {
    const { name, email } = req.body;

    if (!name || !email) {
      return errorResponse(res, "Missing required fields: name, email", {}, 400);
    }

    const code_hash = await send_email(email);

    return successResponse(res, "Verification email sent successfully", {
      name,
      email,
      code_hash,
      nextAction: {
        type: "verify_code",
        path: "/api/auth/verify"
      }
    });
  } catch (err) {
    console.error("resend error:", err.message);
    return errorResponse(res, "Failed to resend verification email", err.message, 500);
  }
};

/**
 * @swagger
 * /api/auth/changepwd:
 *   get:
 *     tags: [Auth]
 *     summary: Load change password page data
 *     description: >
 *       Returns name and email to prepare the password change process.  
 *       This endpoint does **not** perform validation—only data preload.
 *     parameters:
 *       - in: query
 *         name: name
 *         required: true
 *         schema:
 *           type: string
 *         description: User's name
 *         example: John Doe
 *       - in: query
 *         name: email
 *         required: true
 *         schema:
 *           type: string
 *         description: User's email
 *         example: johndoe@mail.com
 *     responses:
 *       200:
 *         description: Change password page data loaded successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Change password page data
 *                 data:
 *                   type: object
 *                   properties:
 *                     name:
 *                       type: string
 *                       example: John Doe
 *                     email:
 *                       type: string
 *                       example: johndoe@mail.com
 *       500:
 *         description: Server error while loading change password data
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
export const changepwd = async (req, res) => {
  try {
    return successResponse(res, "Change password page data", {
      name: req.query.name,
      email: req.query.email
    });
  } catch (err) {
    return errorResponse(res, "Failed to load password change", err.message, 500);
  }
};

/**
 * @swagger
 * /api/auth/verify_changepwd:
 *   post:
 *     tags: [Auth]
 *     summary: Verify and confirm password reset
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *               name:
 *                 type: string
 *               password:
 *                 type: string
 *               new_password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Password reset successful
 *       400:
 *         description: Missing or invalid data
 *       404:
 *         description: User not found
 */
export const verify_changepwd = async (req, res) => {
  try {
    const { new_password, confirm_password } = req.body;

    if (!new_password || !confirm_password) {
      return errorResponse(res, "Missing required fields: new_password, confirm_password", {}, 400);
    }

    if (new_password !== confirm_password) {
      return errorResponse(res, "Password entries do not match", {}, 400);
    }

    const { id } = req.user;
    if (!id) {
      return errorResponse(res, "Unauthorized user", {}, 401);
    }

    await updateUser("id", id, { password: new_password });

    return successResponse(res, "Password updated successfully", {
      userId: id,
      nextAction: {
        type: "navigate",
        path: "/login",
      },
    });

  } catch (err) {
    console.error("verify_changepwd error:", err);
    return errorResponse(res, "Failed to reset password", err.message, 500);
  }
};

/**
 * @swagger
 * /api/auth/rebind_page:
 *   get:
 *     tags: [Auth]
 *     summary: Load rebind account page
 *     description: >
 *       Loads user information for the account rebind page.  
 *       Requires a valid JWT token in query parameters.
 *     parameters:
 *       - in: query
 *         name: token
 *         required: true
 *         schema:
 *           type: string
 *         description: JWT token for authentication
 *         example: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
 *     responses:
 *       200:
 *         description: Rebind page data loaded successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Rebind page loaded
 *                 data:
 *                   type: object
 *                   properties:
 *                     name:
 *                       type: string
 *                       example: John Doe
 *                     role:
 *                       type: string
 *                       example: user
 *                     token:
 *                       type: string
 *                       example: eyJhbGciOiJIUzI1NiIsIn...
 *       401:
 *         description: Unauthorized or missing token
 *       500:
 *         description: Server error while loading page
 */
export const rebind_page = async (req, res) => {
  try {
    const token = req.query.token;
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (!token || !decoded) {
      return errorResponse(res, "Unauthorized", {}, 401);
    }

    return successResponse(res, "Rebind page loaded", {
      name: decoded.name,
      role: decoded.role,
      token
    });
  } catch (err) {
    return errorResponse(res, "Failed to load rebind page", err.message, 500);
  }
};

/**
 * @swagger
 * /api/auth/rebind_qr:
 *   get:
 *     tags: [Auth]
 *     summary: Generate QR code for account rebind
 *     description: >
 *       Generates a QR token and returns it in Base64 format,  
 *       which can be displayed or scanned to rebind an account.
 *     responses:
 *       200:
 *         description: QR code generated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: QR code generated successfully
 *                 data:
 *                   type: object
 *                   properties:
 *                     token:
 *                       type: string
 *                       description: Unique QR token
 *                       example: 5b0f098e-df03-47e0-97fc-5b7a67b7a9f4
 *                     qrImageBase64:
 *                       type: string
 *                       description: Base64-encoded QR image
 *                       example: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA..."
 *                     type:
 *                       type: string
 *                       example: image/png
 *       500:
 *         description: Failed to generate QR code
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
export const rebind_qr = async (req, res) => {
  try {
    const qr_token = uuidv4();
    const qrImage = await QRCode.toDataURL(qr_token); // returns base64 format

    return successResponse(res, "QR code generated successfully", {
      token: qr_token,
      qrImageBase64: qrImage,
      type: "image/png"
    });

  } catch (err) {
    console.error("QR generation error:", err);
    return errorResponse(res, "QR code generation failed", err.message, 500);
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