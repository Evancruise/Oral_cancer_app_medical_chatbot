import { createAppointmentTable, removeAppointmentTable } from "#services/appointment.service.js";

export const initAppointmentTable = async (req, res) => {
    createAppointmentTable();
    console.log("✅ Init appointment table");
    res.status(200).json({ message: "Init appointment table successfully" });
};

export const deleteAppointmentTable = async (req, res) => {
    removeAppointmentTable();
    console.log("✅ Delete appointment table");
    res.status(200).json({ message: "Delete appointment table successfully" });
};