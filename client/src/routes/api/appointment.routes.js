import express from "express";
import {
    appointments, update_appointment, update_appointment_status
} from "#controllers/api/appointment.controller.js";
import { authenticateToken } from "#src/middleware/users.middleware.js";

const router = express.Router();

router.get("/appointments", authenticateToken,
  /* #swagger.tags = ['Appointment']
   #swagger.summary = 'Retrieve grouped appointments'
   #swagger.description = 'Get all appointment records for authenticated user, grouped and sorted by date (newest first)'
  */
  appointments
);

router.post("/update", 
  /* 
   #swagger.tags = ['Appointment']
   #swagger.summary = 'Create / Edit / Delete appointment'
   #swagger.description = 'Manage appointment records (create / edit / delete) based on action type'
  */
  update_appointment
);

router.get("/update_status", 
  /* 
   #swagger.tags = ['Appointment']
   #swagger.summary = 'Update appointment check-in status'
   #swagger.description = 'Confirm or cancel appointment status (check-in)'
  */
  update_appointment_status
);

export default router;