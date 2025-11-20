import fs from "fs";
import express from "express";
import swaggerUi from "swagger-ui-express";
import { setupSwagger } from "#config/swagger.js";
import authRoutes from "#routes/api/auth.routes.js";

const app = express();
setupSwagger(app);

const swaggerFile = JSON.parse(fs.readFileSync("./swagger.json", "utf-8"));

app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerFile));

app.use("/api/auth", authRoutes);

app.listen(process.env.PORT, "127.0.0.1", () => {
  console.log(`🚀 Server running on http://127.0.0.1:${process.env.PORT}`);
});
