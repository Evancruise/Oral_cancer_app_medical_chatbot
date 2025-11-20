export const successResponse = (res, message, data = {}, statusCode = 200) => {
    return res.status(statusCode).json({
        success: true,
        message, 
        data
    });
};

export const redirectResponse = (res, message, redirect, statusCode = 200) => {
    return res.status(statusCode).json({
        success: true,
        message,
        redirect,
    });
};

export const errorResponse = (res, message, details = {}, statusCode = 400) => {
    return res.status(statusCode).json({
        success: false,
        message,
        details
    });
};

