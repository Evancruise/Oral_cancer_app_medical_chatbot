import express from "express";

import { authenticateToken } from "#middleware/users.middleware.js";
import { deleteRegisterTable, fetchAllRegisters, initRegisterTable } from "#controllers/register.controller.js";

import dotenv from "dotenv";

dotenv.config();

const router = express.Router();

router.get('/', authenticateToken, fetchAllRegisters);
router.post("/del-reg", deleteRegisterTable);
router.post("/init-reg", initRegisterTable);
// router.get('/:id', authenticateToken, getUserByIdController);
// router.put('/:id', authenticateToken, updateUserController);
// router.delete('/:id', authenticateToken, authorizeRoles("admin"), deleteUserController);

export default router;