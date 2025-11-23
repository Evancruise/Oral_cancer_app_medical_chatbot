import fs from "fs";
import express from "express";
import swaggerUi from "swagger-ui-express";
import { setupSwagger } from "#config/swagger.js";
import authRoutes from "#routes/api/auth.routes.js";

import { removeUserTable } from "#services/user.service.js";
import { createUsersTable } from "#services/auth.service.js";
import { removeRegisterTable } from "#services/register.service.js";
import { createRegisterTable } from "#services/auth.service.js";
import { createAppointmentTable, removeAppointmentTable } from "#services/appointment.service.js";
import {
  createDiscardRecordTable,
  createRecordTable,
  removeDiscardRecordTable,
  removeRecordTable,
} from "#services/record.service.js";

import dotenv from "dotenv";

dotenv.config();

const app = express();
setupSwagger(app);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const swaggerFile = JSON.parse(fs.readFileSync("./swagger.json", "utf-8"));

if (process.env.NODE_ENV !== "production") {
  await removeUserTable();
  await removeRegisterTable();
  await removeRecordTable();
  await removeDiscardRecordTable();
  //await removeAppointmentTable();
  await createUsersTable();
  await createRegisterTable();
  await createRecordTable();
  await createDiscardRecordTable();
  //await createAppointmentTable();
}

app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerFile));

app.use("/api/auth", authRoutes);

app.listen(process.env.PORT, "127.0.0.1", () => {
  console.log(`🚀 Server running on http://127.0.0.1:${process.env.PORT}`);
});
