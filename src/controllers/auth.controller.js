import { v4 as uuidv4 } from "uuid";
import QRCode from "qrcode";
import jwt from "jsonwebtoken";

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

export const loginPage = async (req, res) => {
    let login_role = req?.query.login_role;
    let name = "", email = "";

    if (login_role == "professor") {
        name = process.env.NAME;
        email = process.env.ACCOUNT;
    }

    res.render("loginPage", { layout: false, login_role: login_role, name: name, email: email });
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