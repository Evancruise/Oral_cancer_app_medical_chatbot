import express from "express";
// import { getUserByIdController, updateUserController, deleteUserController, fetchAllUsers } from "#controllers/users.controller.js";

import { authenticateToken } from "#middleware/users.middleware.js";
import { deleteUserTable, initUserTable, fetchAllUsers } from "#src/controllers/user.controller.js";

import dotenv from "dotenv";

dotenv.config();

const router = express.Router();

router.get('/', fetchAllUsers);
router.post("/del-user", deleteUserTable);
router.post("/init-user", initUserTable);
// router.get('/:id', authenticateToken, getUserByIdController);
// router.put('/:id', authenticateToken, updateUserController);
// router.delete('/:id', authenticateToken, authorizeRoles("admin"), deleteUserController);

export default router;