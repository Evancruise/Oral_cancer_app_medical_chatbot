import { removeUserTable } from "#services/user.service.js";

export const deleteUserTable = async (req, res) => {
    removeUserTable();
    res.status(200).json({ message: "Delete user table successfully" });
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