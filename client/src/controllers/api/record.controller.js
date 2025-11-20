import { createRecordTable, removeRecordTable } from "#services/record.service.js";
import { createDiscardRecordTable, removeDiscardRecordTable } from "#services/record.service.js";

export const initRecordTable = async (req, res) => {
    createRecordTable();
    console.log("✅ Init record table");
    res.status(200).json({ message: "Init record table successfully" });
};

export const deleteRecordTable = async (req, res) => {
    removeRecordTable();
    console.log("✅ Delete record table");
    res.status(200).json({ message: "Delete record table successfully" });
};

export const initDiscardRecordTable = async (req, res) => {
    createDiscardRecordTable();
    console.log("✅ Init record_gb table");
    res.status(200).json({ message: "Init record_gb table successfully" });
};

export const deleteDiscardRecordTable = async (req, res) => {
    removeDiscardRecordTable();
    console.log("✅ Delete record_gb table");
    res.status(200).json({ message: "Delete record_gb table successfully" });
};