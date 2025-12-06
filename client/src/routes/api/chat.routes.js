import { 
  send,
  chat_history,
  chat_clear,
  chat_cap_guide,
  chat_cap_explain
} from "#src/controllers/api/chatbot.controller.js";
import { authenticateToken } from "#src/middleware/users.middleware.js";
import express from "express";

const router = express.Router();

router.post("/chatbot/record_inquire/send", authenticateToken,
  /*
    #swagger.tags = ['Chatbot']
    #swagger.summary = 'Chatbot interaction'
    #swagger.description = 'Send a user message to the AI chatbot and receive a generated response.'

    #swagger.requestBody = {
      required: true,
      content: {
        "application/json": {
          schema: {
            type: "object",
            required: ["message"],
            properties: {
              message: {
                type: "string",
                example: "What are the symptoms of oral cancer?"
              }
            }
          }
        }
      }
    }

    #swagger.responses[200] = {
      description: 'Chatbot reply received successfully',
      schema: {
        success: true,
        message: 'Chatbot reply received',
        data: {
          reply: "Oral cancer symptoms may include persistent mouth sores, lumps, or pain..."
        }
      }
    }

    #swagger.responses[400] = {
      description: 'Invalid input (missing message)',
      schema: {
        success: false,
        message: "Invalid input. 'message' is required."
      }
    }

    #swagger.responses[500] = {
      description: 'Server or chatbot API error',
      schema: {
        success: false,
        message: "Chatbot service returned an error",
        error: "Internal server error"
      }
    }
  */    
  send
);

router.get("/chatbot/record_inquire/history", authenticateToken,
  /*
    #swagger.tags = ['Chatbot']
    #swagger.summary = 'Get user chat history'
    #swagger.description = 'Retrieve saved conversation history for authenticated user.'
    #swagger.security = [{ bearerAuth: [] }]
    #swagger.responses[200] = {
      description: 'History retrieved successfully',
      schema: {
        success: true,
        message: "Chat history retrieved",
        data: {
          history: [
            { user: "What is AI?", bot: "AI means Artificial Intelligence." }
          ]
        }
      }
    }
  */
  chat_history
);

router.delete("/chatbot/record_inquire/history", authenticateToken,
  /*
    #swagger.tags = ['Chatbot']
    #swagger.summary = 'Clear chat history'
    #swagger.description = 'Delete all chatbot conversation history for authenticated user.'
    #swagger.security = [{ bearerAuth: [] }]
    #swagger.responses[200] = {
      description: 'History cleared',
      schema: {
        success: true,
        message: "Chat history cleared successfully",
        data: { deleted: true }
      }
    }
  */
  chat_clear
);

router.post("/chatbot/photo/cap_guide", authenticateToken,
  /*
  */
  chat_cap_guide
);

router.post("/chatbot/photo/explain", authenticateToken, 
  /*
  */
  chat_cap_explain
);

export default router;