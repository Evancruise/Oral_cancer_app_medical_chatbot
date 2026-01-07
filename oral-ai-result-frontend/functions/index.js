import * as functions from "firebase-functions";
import express from "express";
// import line from "@line/bot-sdk";
// import admin from "firebase-admin";
// import OpenAI from "openai";
// import getAIResponse from "./openai.js";
// import getLineConfig from "./line_modules.js";
// import buildFlexProcessing from "./handle_event.js"
import linebotAiRouter from "./line_route.js";

const app = express();

/*
app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  })
);
*/

app.use("/line", linebotAiRouter);

app.get("/", (req, res) => {
  res.send("LINE webhook alive");
});

/*
export const api = onRequest({
  region: "asia-east1",
  cors: false,
  minInstances: 0,
  secrets: [
    defineSecret("LINE_SECRET"), 
    defineSecret("LINE_ACCESS_TOKEN"), 
    defineSecret("OPENAI_API_KEY"), 
    defineSecret("GCLOUD_PROJECT_ID"), 
    defineSecret("FIRESTORE_DATABASE_ID"),
    defineSecret("AI_INFER_API"),
    // defineSecret("JWT_SECRET"),        // 如果需要 JWT
    // defineSecret("API_KEYS"),          // 如果需要 API Key
  ],
}, app);
*/

export const lineWebhook = functions.https.onRequest(app);

// const port = process.env.PORT || 8080;
// app.listen(port, "0.0.0.0", () => console.log("listening", port));
