import express from "express";
import { initAppointmentTable, deleteAppointmentTable } from "#controllers/appointment.controller.js";

import dotenv from "dotenv";
dotenv.config();

const router = express.Router();

router.get("/init-appointment", initAppointmentTable);
router.get("/del-appointment", deleteAppointmentTable);

export default router;