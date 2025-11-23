import { successResponse, errorResponse } from "#utils/responses.js";
import { createUser, createRegister } from "#services/auth.service.js";
import { v4 as uuidv4 } from "uuid";
import QRCode from "qrcode";
import jwt from "jsonwebtoken";
import fs from "fs";
import path from "path";
import bcrypt from 'bcrypt';
import crypto from "crypto";
import sgMail from "@sendgrid/mail";
import { signupSchema, signinSchema } from "#validations/auth.validation.js";
import { updateUserPassword, updateUserTableFromRegister, updateUserGroup, 
         getUser, getAllUsers, updateUser, deleteUser, getTempUser } from "#services/user.service.js";
import { priority_from_role } from "#src/utils/func.js";
import { config, default_config } from "#config/config.js";

const configRoot_dir = "/tmp/config";
let configPath = path.join(configRoot_dir, "settings.json");

export const privacy_setting = async (req, res) => {
  try {
    return successResponse(res, "Privacy settings loaded", {
      name: req.user.name,
      role: req.user.role,
      priority: priority_from_role(req.user.role),
    });
  } catch (err) {
    return errorResponse(res, "Failed to load privacy settings", err.message, 500);
  }
};

export const save_privacy_setting = async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return errorResponse(res, "Unauthorized user", {}, 401);
    }

    const allowedFields = ["shareAnalysis", "allowResearch", "notifyResult", "notifyReminder"];
    const updateData = {};

    allowedFields.forEach((field) => {
      if (req.body[field] !== undefined) {
        updateData[field] = req.body[field];
      }
    });

    const updated = await updateUserGroup(allowedFields, { id: userId }, updateData);

    if (!updated || updated.length === 0) {
      return errorResponse(res, "Failed to update privacy settings", {}, 400);
    }

    return successResponse(res, "Privacy settings saved successfully", {
      userId,
      updatedFields: updateData,
      nextAction: { type: "stay" },
    });
  } catch (err) {
    return errorResponse(res, "Unable to save privacy settings", err.message, 500);
  }
};

export const web_setting = async (req, res) => {
  try {
    let cur_config = null;
    if (fs.existsSync(configPath)) {
      const fileContent = fs.readFileSync(configPath, "utf-8");
      cur_config = JSON.parse(fileContent);
    }

    return successResponse(res, "Web settings loaded successfully", {
      name: req.user.name,
      role: req.user.role,
      priority: priority_from_role(req.user.role),
      config: cur_config,
    });
  } catch (err) {
    return errorResponse(res, "Failed to load web settings", err.message, 500);
  }
};

export const guideline = async (req, res) => {
  try {
    return successResponse(res, "Guideline loaded", {
      name: req.user.name,
      role: req.user.role,
    });
  } catch (err) {
    return errorResponse(res, "Failed to load guideline", err.message, 500);
  }
};

export const education = async (req, res) => {
  try {
    return successResponse(res, "Education content loaded", {
      name: req.user.name,
      role: req.user.role,
    });
  } catch (err) {
    return errorResponse(res, "Failed to load education", err.message, 500);
  }
};

export const sys_import = async (req, res) => {
  try {
    if (!req.file) {
      return errorResponse(res, "No file uploaded", {}, 400);
    }

    let settings;
    try {
      settings = JSON.parse(req.file.buffer.toString("utf-8"));
    } catch (err) {
      return errorResponse(res, "Invalid JSON format", err.message, 400);
    }

    fs.writeFileSync(configPath, JSON.stringify(settings, null, 2));
    const updated_at = new Date().toISOString();

    return successResponse(res, "Configuration imported successfully", {
      updated_at,
      nextAction: { type: "navigate", path: "/api/auth/web_setting" },
    });
  } catch (err) {
    return errorResponse(res, "System import failed", err.message, 500);
  }
};

export const sys_export = async (req, res) => {
  try {
    let oldConfig = {};

    if (!fs.existsSync(config_dir)) {
      fs.mkdirSync(config_dir, { recursive: true });
      const newConfig = { ...oldConfig, updated_at: new Date().toISOString() };
      fs.writeFileSync(configPath, JSON.stringify(newConfig, null, 2), "utf-8");
    } else if (fs.existsSync(configPath)) {
      const old_raw = fs.readFileSync(configPath, "utf-8");
      oldConfig = JSON.parse(old_raw);
    }

    res.setHeader("Content-Disposition", "attachment; filename=settings.json");
    res.setHeader("Content-Type", "application/json");
    return res.send(oldConfig);
  } catch (err) {
    return errorResponse(res, "Export failed", err.message, 500);
  }
};

export const reset = async (req, res) => {
  try {
    fs.writeFileSync(configPath, JSON.stringify(default_config, null, 2));
    return successResponse(res, "System reset successfully", {
      redirect: `/api/auth/web_setting`,
    });
  } catch (err) {
    return errorResponse(res, "Reset failed", err.message, 500);
  }
};

export const apply_system_setting = async (req, res) => {
  try {
    const { action, ...settings } = req.body;

    if (!action) {
      return errorResponse(res, "Invalid action", {}, 400);
    }

    if (action === "save") {
      let oldConfig = {};
      if (fs.existsSync(configPath)) {
        oldConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      }
      const newConfig = { ...oldConfig, ...settings, updated_at: new Date().toISOString() };
      fs.writeFileSync(configPath, JSON.stringify(newConfig, null, 2), "utf-8");
      return successResponse(res, "System setting applied", {
        redirect: "/api/auth/web_setting",
      });
    }

    if (action === "reset") {
      fs.writeFileSync(configPath, JSON.stringify(default_config, null, 2));
      return successResponse(res, "System reset", {
        redirect: "/api/auth/web_setting",
      });
    }

    if (action === "backup") {
      const fileData = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      res.setHeader("Content-Disposition", "attachment; filename=settings.json");
      res.setHeader("Content-Type", "application/json");
      return res.send(fileData);
    }

    if (action === "recover") {
      if (!fs.existsSync(configPath)) {
        return errorResponse(res, "No config file found", {}, 404);
      }
      const settingsData = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      return successResponse(res, "System backup recovered", { settings: settingsData });
    }

    return errorResponse(res, "Invalid action", {}, 400);
  } catch (err) {
    return errorResponse(res, "Failed to apply system settings", err.message, 500);
  }
};