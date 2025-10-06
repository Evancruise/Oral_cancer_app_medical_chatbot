import { removeUserTable, getAllUsers } from "#services/user.service.js";
import { createUsersTable } from "#services/auth.service.js";

export const deleteUserTable = async (req, res) => {
    removeUserTable();
    res.status(200).json({ message: "Delete user table successfully" });
};

export const initUserTable = async (req, res) => {
    createUsersTable();
    console.log("✅ Init user table");
    res.status(200).json({ message: "Init user table successfully" });
};

export const fetchAllUsers = async (req, res, next) => {
    try {
        const allUsers = await getAllUsers();

        res.json({
            message: 'Successfully retrieved users',
            users: allUsers,
            count: allUsers.length,
        });

    } catch(e) {
        logger.error(e);
        next(e);
    }
};