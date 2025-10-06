import { v4 as uuidv4 } from "uuid";
import QRCode from "qrcode";
import bcrypt from 'bcrypt';
import jwt from "jsonwebtoken";
import path from "path";
import sgMail from "@sendgrid/mail";

import { config, default_config } from "#config/config.js";
import { createRegister } from "#services/auth.service.js";
import { findRegister, updateRegister } from "#services/register.service.js";
import { updateUserTableFromRegister, getUser, updateUser } from "#services/user.service.js";

const config_dir = path.join(process.cwd(), "config");
let configPath = path.join(process.cwd(), "config", "settings.json");

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

    if (login_role == "professor") {
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

    logger.info(`process.env.SENDGRID_API_KEY=${process.env.SENDGRID_API_KEY}`);
    
    await sgMail.send({
      from: process.env.MAIL_FROM,
      to: email,
      subject: "Verify email from Oral cancer template",
      html: `<p>Your Oral cancer app verification code is ${code}</p>`,
    });

    logger.info(`code: ${code}`);
    */

    return res.status(201).json({ success: true, layout: false, message: "Verification email sent", redirect: `/api/auth/verify?name=${name}&email=${email}&code_hash=${code_hash}&token=${token}` });
  //} catch (err) {
  //  return res.status(401).json({ success: false, message: err.message });
  //}    
}

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
      const updated = await markQrUsed(qrContent);

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
          logger.info(`📡 WebSocket通知已發送 (${qrContent})`);
      }
      */
      await redis_publisher.publish("qr_auth_notifications", JSON.stringify({ qr_token: qrContent, token }));

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
        return res.render("dashboard", { 
          name: "customer", 
          t: req.t, 
          path: "/api/auth/dashboard", 
          priority: priority_from_role("tester"), 
          layout: "layout" 
        });
      }

    } catch (err) {
      console.error("Scan result error:", err);
      res.status(500).json({ success: false, message: "伺服器錯誤" });
    }
};

export const verify = async(req, res) => {
    return res.status(201).render("verify", { layout: false, name: req.query.name, email: req.query.email, code_hash: req.query.code_hash, token: req.query.token });
}

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
        const register = await findRegister({ email });
        
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

        if (register && register.status == "pending") {
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