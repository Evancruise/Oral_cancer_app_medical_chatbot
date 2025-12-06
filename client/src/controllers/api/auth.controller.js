import { successResponse, errorResponse } from "#utils/responses.js";
import { createUser, createRegister } from "#services/auth.service.js";
import { v4 as uuidv4 } from "uuid";
import QRCode from "qrcode";
import jwt from "jsonwebtoken";
import bcrypt from 'bcrypt';
import crypto from "crypto";
import sgMail from "@sendgrid/mail";
import { signupSchema, signinSchema } from "#validations/auth.validation.js";
import { updateUserPassword, updateUserTableFromRegister, updateUserGroup, 
         getUser, getAllUsers, updateUser, deleteUser, getTempUser } from "#services/user.service.js";

import { OAuth2Client } from "google-auth-library";
import { except } from "drizzle-orm/mysql-core";
import { success } from "zod";

sgMail.setApiKey(process.env.SENDGRID_API_KEY);
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const chat_client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function generateSecureSixDigitCode() {
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  return (array[0] % 1000000).toString().padStart(6, "0");
}

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

export const signin = async (req, res) => {
  try {

    console.log(`req.body: ${JSON.stringify(req.body)}`);

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
      { expiresIn: process.env.JWT_EXPIRES_IN },
    );

    return successResponse(res, "Login successful", {
      token, 
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    });

  } catch (e) {
    return errorResponse(res, "Login failed", e.message, 400);
  }
};

export const processing = async (req, res) => {
  const { login_role } = req.body;
  return successResponse(res, "Processing login role", {
    login_role,
    redirect: `/api/auth/loginPage?login_role=${login_role}`,
  });
};

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

export const signout = (req, res) => {
    res.clearCookie("token");
    return successResponse(res, "Signout successfully");
};

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
    return errorResponse(res, "Failed to generate QR code", err.message, 500);
  }
};

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
    return errorResponse(res, "Failed to resend verification email", err.message, 500);
  }
};

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

export const verify_changepwd = async (req, res) => {
  try {
    console.log(`req.body: ${JSON.stringify(req.body)}`);

    const { name, email, password, new_password } = req.body;

    // Basic required field validation
    if (!name || !email || !password || !new_password) {
      return errorResponse(res, "Missing required fields (name, email, password, new_password)", {}, 400);
    }

    const userByName = await getUser("name", name);
    const userByEmail = await getUser("email", email);

    console.log(`userByName: ${JSON.stringify(userByName)}`);
    console.log(`userByEmail: ${JSON.stringify(userByEmail)}`);

    if (!userByName || !userByEmail) {
      return errorResponse(res, "User not found", {}, 404);
    }

    if (userByName.id !== userByEmail.id) {
      return errorResponse(res, "User identity mismatch", {}, 400);
    }

    if (new_password !== password) {
      return errorResponse(res, "New password and confirmation do not match", {}, 401);
    }

    await updateUser("id", userByEmail.id, { password: new_password });

    return successResponse(res, "Password reset verified successfully", {
      redirect: `/api/auth/loginPage?login_role=${userByEmail.login_role}`,
    });

  } catch (err) {
    return errorResponse(res, "Error occurred during password change verification", err.message, 500);
  }
};

export const rebind_page = async (req, res) => {
  try {
    const token = req.query.token;

    if (!token) {
      return errorResponse(res, "Missing token", {}, 401);
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      return errorResponse(res, "Invalid or expired token", err.message, 401);
    }

    return successResponse(res, "Rebind page data loaded", {
      name: decoded.name,
      role: decoded.role,
      priority: priority_from_role(decoded.role),
      token,
      nextAction: {
        type: "rebind",
        path: "/api/auth/rebind_qr"  // 示範返回 rebind_qr 下一步API
      }
    });

  } catch (err) {
    return errorResponse(res, "Failed to load rebind page", err.message, 500);
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

export const login_with_google = async (req, res) => {
  try {
    const { google_token } = req.body;

    const ticket = client.verifyIdToken({
      id_token: google_token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    const name = payload.name;
    const email = payload.email;
    const role = payload.role || "tester";

    let user = await getUser("email", email);
    if (!user) {
      user = await createUser({name, email});
    }

    const token = jwt.sign(
      { id: user.id, name: user.name, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN }
    );

    return successResponse(res, "Google login success", {
      name: name,
      role: role,
      priority: priority_from_role(role),
      token,
      nextAction: {
        type: "submit",
        path: "/api/auth/dashboard"
      }
    });
  } catch (err) {
    return errorResponse(res, "Google login failed", err.message, 500);
  }
};

export const inference = async (req, res) => {
  try {
    const { image_base64, view_type } = req.body;

    if (!image_base64) {
      return errorResponse(res, "Image required", {}, 400);
    }

    const diagnosis = await run_inference(image_base64, view_type);

    return successResponse(res, "Inference success", {
      success: true,
      data: diagnosis
    });
  } catch (err) {
    return errorResponse(res, "Inference failed", err.message, 500);
  }
};

export const analyze = async (req, res) => {
  try {
      console.log("🧾 Received fields:", Object.keys(req.body));
      console.log("Files received:", req.files);

      const { token, patient_id, notes } = req.body;
      const task_id = uuidv4();

      const formData = new FormData();
      formData.append("patient_id", String(patient_id));
      formData.append("notes", String(notes));
      formData.append("task_id", String(task_id));

      const updated = await updateRecordIndividual("patient_id", patient_id, "task_id", task_id);

      const logEntries = [];
      logEntries.push(["patient_id", patient_id]);

      for (let i = 1; i <= 8; i++) {
        /*
        const file = req.files.find(f => f.fieldname === `pic${i}`);
        if (file && fs.existsSync(file.path)) {
          console.log(`Appending file: ${file.path}`);
          formData.append(`pic${i}`, fs.createReadStream(file.path));
          logEntries.push([`pic${i}`, file.path]);
        } else {
          console.log(`File not found or empty: pic${i}`);
        }
        */
        const field = `pic${i}`;
        let filePath = null;

        // 開發環境: multer 本地 /tmp 檔案
        if (process.env.NODE_ENV === "development") {
          const file = req.files.find(f => f.fieldname === field);

          console.log(`file.path: ${file.path}`);

          if (file && fs.existsSync(file.path)) {
            filePath = file.path;
            console.log(`[LOCAL] Found file ${field}: ${filePath}`);
            formData.append(field, fs.createReadStream(filePath));
            logEntries.push([field, filePath]);
          } else {
            console.log(`[LOCAL] File missing: ${field}`);
          }
        }
        // 生產環境: GCS模式
        else if (process.env.NODE_ENV === "production") {
          const gcsPath = req.body[`pic${i}`];
          if (!gcsPath) {
            console.log(`[GCS] Missing path for ${field}`);
            continue;
          }

          const tmpPath = `/tmp/${path.basename(gcsPath)}`;
          console.log(`[GCS] Downloading ${gcsPath} -> ${tmpPath}`);

          await bucket.file(gcsPath).download({ destination: tmpPath });

          if (fs.existsSync(tmpPath)) {
            formData.append(field, fs.createReadStream(tmpPath));
            logEntries.push([field, tmpPath]);
          } else {
            console.log(`[GCS] Download failed for ${gcsPath}`);
          }
        }
      }

      // 手動列印出所有 append 的內容
      console.log("📦 Sending to Flask:");
      for (const [key, value] of logEntries) {
        console.log(`  ${key}:`, value?.path || value?.name || value);
      }

      // Flask API
      console.log("🔗 Flask URL →", `${process.env.GOOGLE_FLASK_APP_URL}/api/predict`);
      /*
      const response = await fetch(`${process.env.GOOGLE_FLASK_APP_URL}/api/predict`, {
        method: "POST",
        body: formData,
      });
      */
      
      const response = await fetch(`${process.env.GOOGLE_FLASK_APP_URL}/api/predict_sync`, {
        method: "POST",
        body: formData,
      });

      const result = await response.json();
      console.log("result:", result);
      const explanation = await callChatGPT(result.diagnosis);

      // 結果回傳給前端
      if (result.status !== "ok") {
          return errorResponse(res, "Inference failed", {
              success: false, 
              message: "Inference failed", 
              task_id: task_id, 
              patient_id: result.patient_id,
              explanation: explanation
          });
      }
      
      return successResponse(res, "Inference completed", {
          success: true, 
          message: "Inference started", 
          task_id: task_id,
          diagnosis: result.diagnosis
      });
    } catch (err) {
      return errorResponse(res, "Error starting inference", {
        success: false, 
        message: "Server error"
      });
    }
};

export const explain_response = async (req, res) => {
  try {
    const { diagnosis } = req.body;

    if (!diagnosis) {
      return errorResponse(res, "Diagnosis JSON missing", {}, 400);
    }

    const prompt = `
    You are an oral health assistant specializing in interpreting AI dental model output.

    Explain the JSON result below in a friendly, medically accurate, and safe manner.
    Avoid definitive medical diagnosis. Provide helpful guidance only.

    JSON:
    ${JSON.stringify(diagnosis, null, 2)}

    Your explanation should include:
    1. What the AI detected
    2. What this may mean medically
    3. Whether the level of concern is low/medium/high
    4. Suggested next steps for the user
    5. Mention if the model confidence is low
    `;

    const completion = await chat_client.clientAuthentication.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }]
    });

    return successResponse(res, "Explain complete", { 
        success: true, 
        explanation: completion.choices[0].message.content 
    });
  } catch (err) {
    return errorResponse(res, "Explain response failed", {}, 500);
  }
};