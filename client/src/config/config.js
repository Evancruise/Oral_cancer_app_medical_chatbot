import dotenv from "dotenv";

dotenv.config();

function parseChar(str, index = 0) {
    if (!str || index >= str.length) {
        throw new Error("Invalid input");
    }
    return str.charAt(index);
}

export const default_config = {
    MAX_PWD_ATTEMPTS: parseInt(process.env.MAX_PWD_ATTEMPTS || "5"),
    PWD_EXPIRE_DAYS: parseInt(process.env.PWD_EXPIRE_DAYS || "90"),
    expireTime: parseInt(process.env.EXPIRE_TIME || "3600"),
    model_version: process.env.MODEL_VERSION || "v1.0",
    threshold: parseFloat(process.env.THRESHOLD || "0.5"),
    model_accuracy: parseFloat(process.env.MODEL_ACCURACY || "0.95"),
    update_inform: process.env.UPDATE_INFORM === "on", // true or false
    minPasswordLength: parseInt(process.env.MIN_PASSWORD_LENGTH || "8"),
    passwordComplexity: process.env.PASSWORD_COMPLEXITY || "medium", // low, medium, high
    passwordExpiryDays: parseInt(process.env.PASSWORD_EXPIRY_DAYS || "90"),
    accountLockThreshold: parseInt(process.env.ACCOUNT_LOCK_THRESHOLD || "5"),
    enableMFA: process.env.ENABLE_MFA === "on", // true or false
    mfaMethods: (process.env.MFA_METHODS || "totp").split(","), // totp, sms, email
    enableActivityMonitoring: process.env.ENABLE_ACTIVITY_MONITORING === "on", // true or false
    anomalyThreshold: parseFloat(process.env.ANOMALY_THRESHOLD || "0.8"), // 0 to 1
    timezone: process.env.TIMEZONE || "UTC",
};

export let config = {
    MAX_PWD_ATTEMPTS: parseInt(process.env.MAX_PWD_ATTEMPTS || "5"),
    PWD_EXPIRE_DAYS: parseInt(process.env.PWD_EXPIRE_DAYS || "90"),
    expireTime: parseInt(process.env.EXPIRE_TIME || "3600"),
    model_version: process.env.MODEL_VERSION || "v1.0",
    threshold: parseFloat(process.env.THRESHOLD || "0.5"),
    model_accuracy: parseFloat(process.env.MODEL_ACCURACY || "0.95"),
    update_inform: process.env.UPDATE_INFORM === "on", // true or false
    minPasswordLength: parseInt(process.env.MIN_PASSWORD_LENGTH || "8"),
    passwordComplexity: process.env.PASSWORD_COMPLEXITY || "medium", // low, medium, high
    passwordExpiryDays: parseInt(process.env.PASSWORD_EXPIRY_DAYS || "90"),
    accountLockThreshold: parseInt(process.env.ACCOUNT_LOCK_THRESHOLD || "5"),
    enableMFA: process.env.ENABLE_MFA === "on", // true or false
    mfaMethods: (process.env.MFA_METHODS || "totp").split(","), // totp, sms, email
    enableActivityMonitoring: process.env.ENABLE_ACTIVITY_MONITORING === "on", // true or false
    anomalyThreshold: parseFloat(process.env.ANOMALY_THRESHOLD || "0.8"), // 0 to 1
    timezone: process.env.TIMEZONE || "UTC",
};