import { getRecord } from "#services/record.service.js";
import { errorResponse, successResponse } from "#src/utils/responses.js";
import { movefiles, deletefiles } from "#utils/func.js";
import { getRecord, createRecord, updateRecord, updateRecordIndividual, deleteRecord, getAllRecords,
         getDiscardRecord, deleteDiscardRecord, recoverRecord} from "#services/record.service.js";

import fs from "fs";
import path from "path";
import ExcelJS from "exceljs";

const uploadRoot_dir = "/tmp/public";

const uploadDir = path.join(uploadRoot_dir, "uploads");
const uploadDir_gb = path.join(uploadRoot_dir, "uploads_gb");

export const record = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return errorResponse(res, "Unauthorized user", {}, 401);

    const recordList = await getRecord("id", userId);

    let grouped = {};
    if (Array.isArray(recordList)) {
      recordList.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      grouped = recordList.reduce((acc, item) => {
        const dateKey = item.created_at.toISOString().split("T")[0];
        if (!acc[dateKey]) acc[dateKey] = [];
        acc[dateKey].push(item);
        return acc;
      }, {});
    }

    return successResponse(res, "Records retrieved", {
      totalGroups: Object.keys(grouped).length,
      records: grouped
    });

  } catch (err) {
    return errorResponse(res, "Failed to retrieve records", err.message, 500);
  }
};

export const new_record = [
  upload.any(),
  async (req, res) => {
    try {
      const { action, patient_id } = req.body;
      const userId = req.user?.id;

      if (!userId) {
        return errorResponse(res, "Unauthorized", {}, 401);
      }

      if (!patient_id) {
        return errorResponse(res, "Missing patient_id", {}, 400);
      }

      let newRecord = null;

      if (action === "create" || action === "infer") {
        newRecord = await createRecord(req.body, process.env.NODE_ENV);

        if (!newRecord || newRecord.length === 0) {
          return errorResponse(res, "Please upload all required images", {}, 400);
        }

        return successResponse(res, action === "create" 
          ? "Record created successfully" 
          : "Inference requested", {
          patient_id,
          action
        });
      }

      if (action === "check_result") {
        return successResponse(res, "Check results completed", {
          patient_id,
          action
        });
      }

      return errorResponse(res, "Unknown action", {}, 400);

    } catch (err) {
      return errorResponse(res, "Error creating record", err.message, 500);
    }
  }
];

export const edit_record = [
  upload.any(),
  async (req, res) => {
    try {
      const { action, patient_id } = req.body;
      const userId = req.user?.id;

      if (!userId) {
        return errorResponse(res, "Unauthorized", {}, 401);
      }

      if (!patient_id) {
        return errorResponse(res, "Missing patient_id", {}, 400);
      }

      const uploadDir_id = `${uploadDir}/${patient_id}`;
      const uploadDir_gb_id = `${uploadDir_gb}/${patient_id}`;

      if (!fs.existsSync(uploadDir_id)) {
        fs.mkdirSync(uploadDir_id, { recursive: true });
      }

      if (action === "save") {
        const imgUpdates = {};
        for (let i = 1; i <= 8; i++) {
          const field = `pic${i}_2`;
          const file = req.files.find(f => f.fieldname === field);

          imgUpdates[field] = file
            ? path.join(uploadDir_id, file.originalname).replace(/\\/g, "/")
            : req.body[field] || null;
        }

        await updateRecord(req.body, imgUpdates, process.env.NODE_ENV);

        return successResponse(res, "Record updated successfully", {
          patient_id,
          action: "save"
        });
      }

      if (action === "delete") {
        await deleteRecord(req.body);

        if (!fs.existsSync(uploadDir_gb_id)) {
          fs.mkdirSync(uploadDir_gb_id, { recursive: true });
        }

        await movefiles(uploadDir_id, uploadDir_gb_id);

        return successResponse(res, "Record moved to recycle bin", {
          patient_id,
          action: "delete"
        });
      }

      if (action === "infer") {
        return successResponse(res, "Inference started", {
          patient_id,
          action: "infer"
        });
      }

      return errorResponse(res, "Invalid action", {}, 400);

    } catch (err) {
      return errorResponse(res, "Error updating record", err.message, 500);
    }
  }
];

export const analyze = [
  upload_analyze.any(),
  async (req, res) => {
    try {
      console.log("🧾 Received fields:", Object.keys(req.body));
      console.log("Files received:", req.files);

      const { token, patient_id, notes } = req.body;
      const task_id = uuidv4();

      if (!patient_id) {
        return errorResponse(res, "Missing patient_id", {}, 400);
      }

      // 🔹 Update DB: Attach task_id to the current record
      await updateRecordIndividual("patient_id", patient_id, "task_id", task_id);

      const formData = new FormData();
      formData.append("patient_id", String(patient_id));
      formData.append("notes", String(notes || ""));
      formData.append("task_id", String(task_id));

      const logEntries = [];

      for (let i = 1; i <= 8; i++) {
        const field = `pic${i}`;
        let filePath = null;

        // ➤ Multer Uploaded files (Local: development)
        if (process.env.NODE_ENV === "development") {
          const file = req.files.find(f => f.fieldname === field);
          if (file && fs.existsSync(file.path)) {
            filePath = file.path;
            formData.append(field, fs.createReadStream(filePath));
            logEntries.push([field, filePath]);
          }
        } 
        // ➤ GCS Files (Cloud: production)
        else if (process.env.NODE_ENV === "production") {
          const gcsPath = req.body[field];
          if (!gcsPath) continue;

          const tmpPath = `/tmp/${path.basename(gcsPath)}`;
          await bucket.file(gcsPath).download({ destination: tmpPath });

          if (fs.existsSync(tmpPath)) {
            formData.append(field, fs.createReadStream(tmpPath));
            logEntries.push([field, tmpPath]);
          }
        }
      }

      // 📦 Log uploaded files
      console.log("📦 Sending to Flask:");
      for (const [key, value] of logEntries) {
        console.log(`  ${key}:`, value);
      }

      // 🔗 AI 推論 API (Flask)
      const flaskResponse = await fetch(
        `${process.env.GOOGLE_FLASK_APP_URL}/api/predict`,
        { method: "POST", body: formData }
      );

      const result = await flaskResponse.json();
      console.log("result:", result);

      if (result?.status === "ok") {
        return successResponse(res, "Inference started", {
          task_id,
          patient_id: result.patient_id,
          nextAction: {
            type: "navigate",
            path: `/api/auth/get_inference_status/${task_id}`
          }
        });
      } else {
        return errorResponse(
          res,
          "Failed to start inference",
          result?.message || "AI service returned an error",
          500
        );
      }

    } catch (err) {
      console.error("Error starting inference:", err);
      return errorResponse(
        res,
        "Server error while starting inference",
        err.message,
        500
      );
    }
  }
];

export const get_inference_status = async (req, res) => {
  try {
    const { task_id } = req.params;
    if (!task_id) {
      return errorResponse(res, "Missing task_id parameter", {}, 400);
    }

    console.log(`Fetching inference status for task_id: ${task_id}`);

    // 🔍 向 Flask API 查詢推論狀態
    const response = await fetch(`${process.env.GOOGLE_FLASK_APP_URL}/api/status/${task_id}`);
    
    if (!response.ok) {
      return errorResponse(
        res,
        `Failed to fetch inference status (HTTP ${response.status})`,
        {},
        response.status
      );
    }

    const result = await response.json();
    console.log(`[get_inference_status] result=${JSON.stringify(result)}`);

    // ✅ 若推論完成 → 更新資料庫狀態
    if (result?.status === "completed") {
      console.log(`Inference complete for task_id: ${task_id}`);
      await updateRecordIndividual("task_id", task_id, "status", "completed");
    }

    // 📌 統一成功回傳格式
    return successResponse(res, "Inference status retrieved", {
      task_id,
      status: result.status,
      progress: result.progress || null,
      message: result.message || null,
      completed_at: result.completed_at || null
    });

  } catch (err) {
    console.error("Error get_inference_status:", err);
    return errorResponse(
      res,
      "Unable to get inference status",
      err.message,
      500
    );
  }
};

export const record_search = async (req, res) => {
  try {
    // 使用 authenticateToken middleware 已注入的 req.user
    const user = req.user;

    if (!user || !user.id) {
      return errorResponse(res, "Unauthorized or missing user data", {}, 401);
    }

    let grouped = {};
    const allRecords = await getAllRecords();

    if (allRecords && Array.isArray(allRecords)) {
      // 排序 (created_at 新 → 舊)
      allRecords.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

      // 依日期分組
      grouped = allRecords.reduce((acc, item) => {
        const dateKey = new Date(item.created_at).toISOString().split("T")[0];
        if (!acc[dateKey]) acc[dateKey] = [];
        acc[dateKey].push(item);
        return acc;
      }, {});
    }

    return successResponse(res, "Record search results", {
      grouped_records: grouped,
      total: Object.keys(grouped).length,
      today_date: new Date().toISOString().split("T")[0],
    });

  } catch (err) {
    return errorResponse(res, "Failed to search records", err.message, 500);
  }
};

export const export_data = async (req, res) => {
  try {
    console.log(`export_data req.body: ${JSON.stringify(req.body)}`);

    const rows = JSON.parse(req.body.tableData || "[]");

    if (!rows.length) {
      return errorResponse(res, "No data to export", {}, 400);
    }

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Records");

    worksheet.columns = [
      { header: "影像案例編號", key: "patient_id", width: 20 },
      { header: "建立日期", key: "created_at", width: 15 },
      { header: "上傳日期", key: "updated_at", width: 15 },
      { header: "上傳人員", key: "name", width: 15 },
      { header: "分析狀態", key: "status", width: 15 },
      { header: "備註", key: "notes", width: 30 },
    ];

    rows.forEach((r) => worksheet.addRow(r));

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", "attachment; filename=records.xlsx");

    await workbook.xlsx.write(res);
    res.end();

  } catch (e) {
    console.error("export_data error:", e);
    return errorResponse(res, "Export data failed", e.message, 500);
  }
};

export const recycle_bin = async (req, res) => {
  try {
    // 從 authenticateToken middleware 注入的 req.user 取得使用者資訊
    const user = req.user;

    if (!user || !user.name) {
      return errorResponse(res, "Unauthorized or missing user data", {}, 401);
    }

    // 直接使用 user.name 查詢使用者的丟棄紀錄
    const record = await getDiscardRecord("name", user.name);

    let grouped = {};

    if (record && Array.isArray(record)) {
      // 1️⃣ Sort newest first
      record.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

      // 2️⃣ Group by date (YYYY-MM-DD)
      grouped = record.reduce((acc, item) => {
        const dateKey = new Date(item.created_at).toISOString().split("T")[0];
        if (!acc[dateKey]) acc[dateKey] = [];
        acc[dateKey].push(item);
        return acc;
      }, {});
    }

    return successResponse(res, "Discarded records retrieved", {
      totalGroups: Object.keys(grouped).length,
      records: grouped,
    });

  } catch (err) {
    return errorResponse(res, "Failed to retrieve discarded records", err.message, 500);
  }
};

export const recycle_record = [
  upload_gb.any(),
  async (req, res) => {
    try {
      const { action, patient_id } = req.body;

      if (!action || !patient_id) {
        return errorResponse(res, "Missing required fields: action, patient_id", {}, 400);
      }

      const { id: userId } = req.user; // 從 Authorization header 解出
      const uploadDir_id = `${uploadDir}/${patient_id}`;
      const uploadDir_gb_id = `${uploadDir_gb}/${patient_id}`;

      if (action === "resume") {
        if (!fs.existsSync(uploadDir_id)) {
          fs.mkdirSync(uploadDir_id, { recursive: true });
        }

        if (fs.existsSync(uploadDir_gb_id)) {
          const moveOk = await movefiles(uploadDir_gb_id, uploadDir_id);
          if (!moveOk) {
            return errorResponse(res, "Files transfer failed", {}, 500);
          }
        }

        const imgUpdates = {};
        for (let i = 1; i <= 8; i++) {
          const fieldName = `pic${i}_2`;
          const file = req.files.find(f => f.fieldname === fieldName);

          imgUpdates[fieldName] = file
            ? path.join(uploadDir_id, file.originalname).replace(/\\/g, "/")
            : req.body[fieldName] || null;
        }

        await recoverRecord(req.body, imgUpdates);

        return successResponse(res, "Files restored successfully", {
          patient_id,
          action: "resume"
        });
      }

      if (action === "delete") {
        if (fs.existsSync(uploadDir_gb_id)) {
          await deletefiles(uploadDir_gb_id);
        }

        await deleteDiscardRecord(req.body);

        return successResponse(res, "Files deleted successfully", {
          patient_id,
          action: "delete"
        });
      }

      return errorResponse(res, "Invalid action", {}, 400);

    } catch (err) {
      console.error("recycle_record error:", err.message);
      return errorResponse(res, "Internal server error", err.message, 500);
    }
  }
];