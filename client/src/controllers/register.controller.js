import { removeRegisterTable, getAllRegisters } from "#services/register.service.js";
import { createRegisterTable } from "#services/auth.service.js";

export const deleteRegisterTable = async (req, res) => {
    removeRegisterTable();
    console.log("✅ Delete register table");
    res.status(200).json({ message: "Delete register table successfully" });
};

export const initRegisterTable = async (req, res) => {
    createRegisterTable();
    console.log("✅ Init register table");
    res.status(200).json({ message: "Init register table successfully" });
};

/*
Acquire registers table
*/
export const fetchAllRegisters = async (req, res, next) => {
    try {
        console.info('Getting registers table...');

        const allRegisters = await getAllRegisters();

        res.json({
            message: 'Successfully retrieved registers',
            users: allRegisters,
            count: allRegisters.length,
        });
    } catch(e) {
        console.error(e);
        next(e);
    }
};