// src/swagger-autogen.config.js
import swaggerAutogen from "swagger-autogen";

const swaggerAutogenInstance = swaggerAutogen({ openapi: "3.0.0" });

const doc = {
  info: {
    title: "Oral Cancer Web App API",
    description: "RESTful API documentation for Oral Cancer web system (Node.js + Express).",
    version: "1.0.0",
  },
  host: "localhost:5000",
  schemes: ["http"],
  basePath: "/",   // ⚠️ 改這裡
  consumes: ["application/json", "multipart/form-data"],
  produces: ["application/json"],

  securityDefinitions: {
    bearerAuth: {
      type: "apiKey",
      in: "header",
      name: "Authorization",
      description: "JWT token，格式：Bearer <token>",
    },
  },

  tags: [
    { name: "Auth", description: "註冊 / 登入 / 密碼重設 / Token 驗證" },
    { name: "Record", description: "影像紀錄上傳 / 編輯 / 刪除 / 回收桶" },
    { name: "Appointment", description: "預約建立 / 修改 / 取消 / 查詢" },
    { name: "File", description: "檔案上傳 / GCS / 影像分析" },
    { name: "System", description: "系統設定 / Web 設定 / 隱私設定 / 匯入匯出" },
    { name: "LINE", description: "LINE Login / LIFF / Webhook / QR 綁定" },
    { name: "Chatbot", description: "與 Flask / OpenAI 後端聊天介面" },
  ],
};

const outputFile = "./swagger.json";
const endpointsFiles = [
  "./src/index.api.js",
  "./src/routes/api/**.js",
  "./src/controllers/api/auth.controller.js",
  "./src/controllers/api/system.controller.js",
  "./src/controllers/api/record.controller.js",
];

swaggerAutogenInstance(outputFile, endpointsFiles, doc).then(() => {
  console.log("✅ swagger.json 已產生完成！");
});
