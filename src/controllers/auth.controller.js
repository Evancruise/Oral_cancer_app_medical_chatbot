import { v4 as uuidv4 } from "uuid";
import QRCode from "qrcode";
import bcrypt from 'bcrypt';
import jwt from "jsonwebtoken";
import sgMail from "@sendgrid/mail";
import { createRegister } from "#services/auth.service.js";

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

const send_email = async (email) => {
    try {
        // 寄信
        const code = generateSecureSixDigitCode();
        const code_hash = await bcrypt.hash(code, 10);

        await sgMail.send({
          from: process.env.MAIL_FROM,
          to: email,
          subject: "Verify email from Oral cancer template",
          html: `<!doctype html>
                  <html>
                    <head>
                      <meta charset="utf-8">
                      <meta name="viewport" content="width=device-width,initial-scale=1">
                      <title>驗證碼</title>
                    </head>
                    <body style="margin:0;padding:0;background:#f3f6fb;font-family:Arial,Helvetica,sans-serif;">
                      <table role="presentation" width="100%" style="padding:30px 0">
                        <tr>
                          <td align="center">
                            <table role="presentation" width="600" style="background:#fff;border-radius:10px;padding:28px;box-shadow:0 6px 20px rgba(0,0,0,.06)">
                              <!-- header / logo -->
                              <tr>
                                <td style="text-align:center;padding-bottom:18px">
                                  <img src="/static/images/logo.png" alt="Oral-AI" width="96" style="display:block;margin:0 auto 12px">
                                  <h2 style="margin:0;font-size:20px;color:#0b3b4a">Oral-AI 驗證碼</h2>
                                </td>
                              </tr>

                              <!-- body -->
                              <tr>
                                <td style="padding:12px 24px;color:#222;font-size:15px;line-height:1.5">
                                  <p style="margin:0 0 12px">您好，</p>
                                  <p style="margin:0 0 16px">您正在進行口腔癌 AI 檢測系統的驗證。請在 <strong>10 分鐘</strong> 內使用以下 6 位數驗證碼：</p>

                                  <!-- verification code box -->
                                  <div style="text-align:center;margin:18px 0">
                                    <div style="display:inline-block;padding:18px 22px;border-radius:8px;background:#f8fbff;border:1px solid #e1eff8">
                                      <span style="font-size:28px;letter-spacing:5px;font-weight:700;color:#0b5f7a;font-family: 'Courier New', monospace;">
                                        ${code}
                                      </span>
                                    </div>
                                  </div>

                                  <p style="margin:0 0 10px;color:#555">若不是你本人要求，請忽略此信或聯絡我們。</p>
                                  <p style="margin:0 0 0;color:#777;font-size:13px">此驗證碼只可使用一次，並在過期後失效。</p>
                                </td>
                              </tr>

                              <!-- CTA / footer -->
                              <tr>
                                <td style="padding:18px 24px;text-align:center">
                                  <a href="https://yourdomain.com/support" style="display:inline-block;padding:10px 16px;border-radius:8px;background:#3aa3d1;color:#fff;text-decoration:none;font-weight:600">需要協助？聯絡我們</a>
                                </td>
                              </tr>

                              <tr>
                                <td style="padding:8px 24px;font-size:12px;color:#999;text-align:center">
                                  <div>Oral-AI • 你的醫療影像檢測夥伴</div>
                                  <div style="margin-top:6px">若需取消驗證請忽略本郵件</div>
                                </td>
                              </tr>

                            </table>
                          </td>
                        </tr>
                      </table>
                    </body>
                  </html>`,
        });

        return code_hash;
    } catch (err) {
        return null;
    }
};

export const request = async (req, res) => {

  try {
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
  } catch (err) {
    return res.status(401).json({ success: false, message: err.message });
  }    
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