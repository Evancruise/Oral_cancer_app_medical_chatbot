import { add_message_to_session, get_session_messages } from "#src/utils/chatstore.js";
import { successResponse, errorResponse } from "#utils/responses.js";

// Store all chat history (mongodb, redis db)
let chatStore = {};

export const chatbot = async (req, res) => {
  try {
    const { message, session_id, user_id } = req.body;

    if (!session_id) {
      return errorResponse(res, "Missing session_id", {}, 400);
    }

    // Add user message
    await add_message_to_session(session_id, "user", message);

    // Get context
    const context = await get_session_messages(session_id);

    // Store AI reply
    await add_message_to_session(session_id, "assistant", message);

    return successResponse(res, "AI Reply", {
      reply: message,
      context,
    });

  } catch (err) {
    return errorResponse(res, "Chatbot failed", err.message, 500);
  }
};

export const send = async (req, res) => {
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
    return errorResponse(
      res,
      "Server error while processing chatbot response",
      err.message,
      500
    );
  }
};

export const chat_history = async (req, res) => {
  try {
    const user_id = req.user.id;
    const history = chatStore[user_id] || [];

    return successResponse(res, "Chat history retrieved", { history });
  } catch (err) {
    return errorResponse(res, "Failed to load history", err.message, 500);
  }
};

export const chat_clear = async (req, res) => {
  try {
    const user_id = req.user.id;

    chatStore[user_id] = [];

    return successResponse(res, "Chat history cleared successfully", { deleted: true });
  } catch (err) {
    return errorResponse(res, "Failed to clear chat history", err.message, 500);
  }
};

export const chat_cap_guide = async (req, res) => {
  try {
    const { image_base64, view_type } = req.body;

    if (!image_base64) {
      return res.status(400).json({ error: "Image required" });
    }

    const diagnosis = await run_landmark_model(image_base64, view_type);

    return successResponse(res, "Capture image successfully", { success: true, data: diagnosis });
  } catch (err) {
    return errorResponse(res, "Failed to capture image", err.message, 500);
  }
};

export const chat_cap_explain = async (req, res) => {
  try {

  } catch (err) {
    
  }
};