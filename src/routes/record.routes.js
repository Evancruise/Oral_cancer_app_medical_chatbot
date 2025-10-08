import express from "express";
// import { authenticateToken } from "#middleware/users.middleware.js";
import { deleteRecordTable, initRecordTable,
         deleteDiscardRecordTable, initDiscardRecordTable} from "#controllers/record.controller.js";
import { fetchAllRecords, fetchAllDiscardRecords } from "#services/record.service.js";

import dotenv from "dotenv";
dotenv.config();

const router = express.Router();

router.get("/init-rec", initRecordTable);
router.get("/del-rec", deleteRecordTable);
router.get("/init-rec-gb", initDiscardRecordTable);
router.get("/del-rec-gb", deleteDiscardRecordTable);

router.get("/rec", fetchAllRecords);
router.get("/rec-gb", fetchAllDiscardRecords);

export default router;