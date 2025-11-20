import { successResponse, errorResponse } from "#utils/responses.js";

/**
 * @swagger
 * /api/auth/liff_toppage:
 *   get:
 *     tags: [LINE]
 *     summary: Load LIFF configuration for LINE login
 *     description: >
 *       Retrieves LIFF application configuration, including LIFF ID and login URL.  
 *       Allows Android / Web apps to initiate LINE Login or open LIFF app.
 *     responses:
 *       200:
 *         description: LIFF configuration loaded successfully
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
 *                   example: LIFF configuration loaded successfully
 *                 data:
 *                   type: object
 *                   properties:
 *                     liffId:
 *                       type: string
 *                       example: "1657123456-abcXYZ"
 *                     loginUrl:
 *                       type: string
 *                       example: "https://liff.line.me/1657123456-abcXYZ"
 *       500:
 *         description: LIFF ID missing or configuration error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
export const liff_toppage = async (req, res) => {
  try {
    const { LIFF_ID } = process.env;

    if (!LIFF_ID) {
      return errorResponse(res, "LIFF ID not configured", {}, 500);
    }

    return successResponse(res, "LIFF configuration loaded successfully", {
      liffId: LIFF_ID,
      loginUrl: `https://liff.line.me/${LIFF_ID}`, // 可當登入引導網址
    });
  } catch (err) {
    console.error("liff_toppage error:", err);
    return errorResponse(res, "Failed to load LIFF config", err.message, 500);
  }
};

/**
 * @swagger
 * /api/auth/link_line_account:
 *   post:
 *     tags: [LINE]
 *     summary: Link a LINE account to the user's profile
 *     description: >
 *       Links a LINE user account (via user_id) to the system user profile.  
 *       Stores LINE user ID and optionally display name for future authentication or messaging.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - user_id
 *             properties:
 *               user_id:
 *                 type: string
 *                 description: LINE unique user identifier
 *                 example: Ue5c862ab960cc33c40ffc44d27621b2e
 *               display_name:
 *                 type: string
 *                 description: LINE display name (optional)
 *                 example: Evan Chang
 *     responses:
 *       200:
 *         description: LINE account linked successfully
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
 *                   example: LINE account linked successfully
 *                 data:
 *                   type: object
 *                   properties:
 *                     user_id:
 *                       type: string
 *                       example: Ue5c862ab960cc33c40ffc44d27621b2e
 *                     display_name:
 *                       type: string
 *                       example: Evan Chang
 *       400:
 *         description: Missing or invalid user_id
 *       500:
 *         description: Server error while linking LINE account
 */
export const link_line_account = async (req, res) => {
  try {
    const { user_id, display_name } = req.body;

    if (!user_id) {
      return errorResponse(res, "Missing user_id", {}, 400);
    }

    return successResponse(res, "LINE account linked successfully", {
      user_id,
      display_name
    });
  } catch (err) {
    return errorResponse(res, "Failed to link LINE account", err.message, 500);
  }
};

/**
 * Send a LIFF entry Flex Message via LINE Messaging API
 *
 * @function send_liff_entry
 * @param {Object} client - LINE Messaging API client instance
 * @param {string} reply_token - The LINE reply token from webhook event
 * @description
 * Sends a Flex message containing LIFF app entry button.  
 * Used when LINE user types `menu` or triggers specific webhook events.
 *
 * The button opens the LIFF mini-app:
 * → https://liff.line.me/{LIFF_ID}
 *
 * @returns {Promise<any>} API response from LINE Messaging API
 */
export const send_liff_entry = async (client, reply_token) => {
  const message = {
    type: "flex",
    altText: "點我開啟回診系統",
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          { type: "text", text: "回診小幫手", weight: "bold", size: "xl" },
          { type: "text", text: "點選按鈕開啟App", margin: "sm" },
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "button",
            style: "primary",
            action: {
              type: "uri",
              label: "打開回診小程式",
              uri: `https://liff.line.me/${process.env.LIFF_ID}`,
            },
          },
        ],
      },
    },
  };

  return client.replyMessage(reply_token, message);
};

/**
 * @swagger
 * /api/auth/webhook_entry:
 *   post:
 *     tags: [LINE]
 *     summary: LINE Webhook endpoint
 *     description: >
 *       接收來自 LINE Messaging API 的 Webhook 事件（push / reply）。  
 *       當使用者傳送 `"menu"` 訊息時，回傳 Flex Message，並附上 LIFF 登入按鈕。  
 *       **注意：此 endpoint 不可由 Postman 主動測試，需透過 LINE Webhook 驅動。**
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               events:
 *                 type: array
 *                 description: LINE webhook events
 *                 items:
 *                   type: object
 *                   properties:
 *                     replyToken:
 *                       type: string
 *                       example: "f4b18d6b8d934fd58084f220b2c2ab30"
 *                     type:
 *                       type: string
 *                       example: "message"
 *                     message:
 *                       type: object
 *                       properties:
 *                         type:
 *                           type: string
 *                           example: "text"
 *                         text:
 *                           type: string
 *                           example: "menu"
 *     responses:
 *       200:
 *         description: Webhook processed successfully
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
 *                   example: Webhook processed
 *       500:
 *         description: Webhook processing failed
 */
export const webhook_entry = async (req, res) => {
  try {
    const events = req.body.events;

    await Promise.all(
      events.map(async (event) => {
        if (event.type === "message" && event.message.type === "text") {
          if (event.message.text === "menu") {
            return send_liff_entry(client, event.replyToken);
          }
        }
      })
    );

    return res.status(200).json({
      success: true,
      message: "Webhook processed",
    });
  } catch (err) {
    console.error("webhook_entry error:", err);
    return res.status(500).json({
      success: false,
      message: "Webhook processing failed",
      error: err.message,
    });
  }
};

/**
 * @swagger
 * /api/auth/login-line:
 *   post:
 *     tags: [LINE]
 *     summary: LINE Login (Create or Login User via LINE)
 *     description: >
 *       使用 line_user_id 執行 LINE 登入。  
 *       若使用者第一次登入，會自動建立帳號；  
 *       若已有資料，則直接回傳該使用者資料與 JWT token。
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 example: "Evan Lin"
 *               line_user_id:
 *                 type: string
 *                 example: "Ua123456789abcd"
 *     responses:
 *       200:
 *         description: LINE login successful
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
 *                   example: LINE login successful
 *                 data:
 *                   type: object
 *                   properties:
 *                     token:
 *                       type: string
 *                       example: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
 *                     user:
 *                       type: object
 *                       properties:
 *                         id:
 *                           type: integer
 *                           example: 17
 *                         name:
 *                           type: string
 *                           example: Evan Lin
 *                         email:
 *                           type: string
 *                           example: Ua123456789abcd@line-login.local
 *                         login_role:
 *                           type: string
 *                           example: tester
 *                         provider:
 *                           type: string
 *                           example: line
 *                     nextAction:
 *                       type: object
 *                       properties:
 *                         type:
 *                           type: string
 *                           example: navigate
 *                         path:
 *                           type: string
 *                           example: /dashboard
 *       400:
 *         description: Missing line_user_id
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
 *                   example: Missing line_user_id
 *       500:
 *         description: Server error during LINE login
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
 *                   example: LINE login failed
 */
export const login_line = async (req, res) => {
  try {
    let { name, line_user_id } = req.body;

    if (!line_user_id) {
      return errorResponse(res, "Missing line_user_id", {}, 400);
    }

    let user = await getUser("line_user_id", line_user_id);

    if (!user) {
      user = await createUser({
        name: name || "LINE User",
        email: `${line_user_id}@line-login.local`,
        login_role: "tester",
        line_user_id,
        provider: "line",
      });
    }

    const token = jwt.sign(
      {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role || "tester",
        login_role: user.login_role,
      },
      process.env.JWT_SECRET,
      { expiresIn: config.expireTime }
    );

    return successResponse(res, "LINE login successful", {
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        login_role: user.login_role,
        provider: user.provider,
      },
      nextAction: {
        type: "navigate",
        path: "/dashboard",
      },
    });
  } catch (err) {
    console.error("login_line error:", err);
    return errorResponse(res, "LINE login failed", err.message, 500);
  }
};