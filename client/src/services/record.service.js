import { sql2, query } from "#config/database.js";
import dotenv from "dotenv";
dotenv.config();

/******************************
 
Fetch functions

******************************/

export const fetchAllRecords = async (req, res, next) => {
    try {
        console.log('Getting records table...');

        const allRecords = await getAllRecords();

        res.json({
            message: 'Successfully retrieved records',
            users: allRecords,
            count: allRecords.length,
        });

    } catch(e) {
        console.error(e);
        next(e);
    }
};

export const fetchAllDiscardRecords = async (req, res, next) => {
    try {
        console.log('Getting records_gb table...');

        const allDiscardRecords = await getAllDiscardRecords();

        res.json({
            message: 'Successfully retrieved records_gb',
            users: allDiscardRecords,
            count: allDiscardRecords.length,
        });

    } catch(e) {
        console.error(e);
        next(e);
    }
};

export const getAllRecords = async () => {
    try {
        const result = await sql2`
          SELECT * FROM records
        `;
        return result;
    } catch (e) {
        console.error("Error getting records", e);
        throw e;
    }
};

export const getAllDiscardRecords = async () => {
    try {
        const result = await sql2`
          SELECT * FROM records_gb
        `;
        return result;
    } catch (e) {
        console.error("Error getting records_gb", e);
        throw e;
    }
};

export const getRecord = async (key, value) => {
    let result = null;
    if (key === "name") {
        result = await sql2`SELECT * FROM records WHERE name = ${value}`;
    } else if (key === "id") {
        result = await sql2`SELECT * FROM records WHERE id = ${value}`;
    } else if (key === "patient_id") {
        result = await sql2`SELECT * FROM records WHERE patient_id = ${value}`;
    }
    return result;
};

export const getDiscardRecord = async (key, value) => {
    let result = null;
    if (key === "name") {
        result = await sql2`SELECT * FROM records_gb WHERE name = ${value}`;
    } else if (key === "id") {
        result = await sql2`SELECT * FROM records_gb WHERE id = ${value}`;
    }
    return result;
};

/******************************

Remove functions

*******************************/

export const removeRecordTable = async () => {
  try {
    console.log("🔍 刪除 records 資料表中...");
    await sql2`DROP TABLE IF EXISTS records`;
    console.log("✅ 刪除 records 資料表完成");
  } catch (e) {
    console.error("❌ 刪除 records 資料表失敗:", e);
    throw e;
  }
};

export const removeDiscardRecordTable = async () => {
  try {
    console.log("🔍 刪除 records_gb 資料表中...");
    await sql2`DROP TABLE IF EXISTS records_gb`;
    console.log("✅ 刪除 records_gb 資料表完成");
  } catch (e) {
    console.error("❌ 刪除 records_gb 資料表失敗:", e);
    throw e;
  }
};

export const deleteRecord = async (body) => {
  try {
    // raw SQL 查詢
    const existingRecord = await sql2`SELECT * FROM records WHERE patient_id = ${body.patient_id}`;

    console.log("✅ Step 1 結果:", existingRecord);

    if (existingRecord.length === 0) {
      throw new Error(`Record with patient_id ${body.patient_id} has already deleted`);
    }

    const inserted = await sql2`
      INSERT INTO records_gb (
        patient_id, name, notes, status, progress, message, created_at, updated_at, 
        img1, img2, img3, img4, img5, img6, img7, img8,
        img1_result, img2_result, img3_result, img4_result, img5_result, img6_result, img7_result, img8_result
      )
      SELECT
        patient_id, name, notes, status, progress, message, created_at, updated_at,
        img1, img2, img3, img4, img5, img6, img7, img8,
        img1_result, img2_result, img3_result, img4_result, img5_result, img6_result, img7_result, img8_result
      FROM records
      WHERE patient_id = ${body.patient_id}
      AND NOT EXISTS (
        SELECT 1 FROM records_gb WHERE patient_id = ${body.patient_id}
      )
      RETURNING *;
    `;

    console.log("✅ Copied Record:", inserted);

    const img_dic = await sql2`SELECT * FROM records_gb WHERE patient_id = ${body.patient_id}`;
    const oldRecord = img_dic[0];    

    console.log("✅ Step 2 結果:", oldRecord);

    const newRecord = {
        img1: "tmp/public/uploads_gb/" + oldRecord.img1?.split("/")[3] + "/" + oldRecord.img1?.split("/")[4] ?? "",
        img2: "tmp/public/uploads_gb/" + oldRecord.img2?.split("/")[3] + "/" + oldRecord.img2?.split("/")[4] ?? "",
        img3: "tmp/public/uploads_gb/" + oldRecord.img3?.split("/")[3] + "/" + oldRecord.img3?.split("/")[4] ?? "",
        img4: "tmp/public/uploads_gb/" + oldRecord.img4?.split("/")[3] + "/" + oldRecord.img4?.split("/")[4] ?? "",
        img5: "tmp/public/uploads_gb/" + oldRecord.img5?.split("/")[3] + "/" + oldRecord.img5?.split("/")[4] ?? "",
        img6: "tmp/public/uploads_gb/" + oldRecord.img6?.split("/")[3] + "/" + oldRecord.img6?.split("/")[4] ?? "",
        img7: "tmp/public/uploads_gb/" + oldRecord.img7?.split("/")[3] + "/" + oldRecord.img7?.split("/")[4] ?? "",
        img8: "tmp/public/uploads_gb/" + oldRecord.img8?.split("/")[3] + "/" + oldRecord.img8?.split("/")[4] ?? "",
        img1_result: "tmp/public/uploads_gb/" + oldRecord.img1_result?.split("/")[3] + "/" + oldRecord.img1_result?.split("/")[4] ?? "",
        img2_result: "tmp/public/uploads_gb/" + oldRecord.img2_result?.split("/")[3] + "/" + oldRecord.img2_result?.split("/")[4] ?? "",
        img3_result: "tmp/public/uploads_gb/" + oldRecord.img3_result?.split("/")[3] + "/" + oldRecord.img3_result?.split("/")[4] ?? "",
        img4_result: "tmp/public/uploads_gb/" + oldRecord.img4_result?.split("/")[3] + "/" + oldRecord.img4_result?.split("/")[4] ?? "",
        img5_result: "tmp/public/uploads_gb/" + oldRecord.img5_result?.split("/")[3] + "/" + oldRecord.img5_result?.split("/")[4] ?? "",
        img6_result: "tmp/public/uploads_gb/" + oldRecord.img6_result?.split("/")[3] + "/" + oldRecord.img6_result?.split("/")[4] ?? "",
        img7_result: "tmp/public/uploads_gb/" + oldRecord.img7_result?.split("/")[3] + "/" + oldRecord.img7_result?.split("/")[4] ?? "",
        img8_result: "tmp/public/uploads_gb/" + oldRecord.img8_result?.split("/")[3] + "/" + oldRecord.img8_result?.split("/")[4] ?? "",
    };

    const updated = await sql2`
      UPDATE records_gb
      SET img1 = ${newRecord.img1},
          img2 = ${newRecord.img2},
          img3 = ${newRecord.img3},
          img4 = ${newRecord.img4},
          img5 = ${newRecord.img5},
          img6 = ${newRecord.img6},
          img7 = ${newRecord.img7},
          img8 = ${newRecord.img8},
          img1_result = ${newRecord.img1_result},
          img2_result = ${newRecord.img2_result},
          img3_result = ${newRecord.img3_result},
          img4_result = ${newRecord.img4_result},
          img5_result = ${newRecord.img5_result},
          img6_result = ${newRecord.img6_result},
          img7_result = ${newRecord.img7_result},
          img8_result = ${newRecord.img8_result},
          updated_at = NOW()
      WHERE patient_id = ${body.patient_id}
      RETURNING *;
    `;

    await sql2`DELETE FROM records 
        WHERE patient_id = ${body.patient_id}
    `;

    console.log(`✅ Step 3 完成 (updated: ${updated})`);
    return updated;
  } catch (e) {
    console.error("❌ deleteRecord 發生錯誤:", e);
    throw e;
  }
};

export const deleteDiscardRecordTable = async (body) => {
  try {
    // raw SQL 查詢
    const existingRecord = await sql2`SELECT * FROM records_gb WHERE patient_id = ${body.patient_id}`;

    console.log("✅ Step 1 結果:", existingRecord);

    if (existingRecord.length === 0) {
      throw new Error(`Record with patient_id ${body.patient_id} has already deleted`);
    }

    await sql2`DELETE FROM records_gb 
        WHERE patient_id = ${body.patient_id}
    `;

    console.log("✅ Step 2 完成");
  } catch (e) {
    console.error("❌ deleteDiscardRecordTable 發生錯誤:", e);
    throw e;
  }
};

export const recoverRecord = async (body, imgUpdates = null) => {
  try {

    console.log(`body:`, JSON.stringify(body));
    // raw SQL 查詢
    const existingRecord = await sql2`SELECT * FROM records WHERE patient_id = ${body.patient_id}`;

    console.log("✅ Step 1 結果:", existingRecord);

    if (existingRecord.length !== 0) {
      throw new Error(`Record with patient_id ${body.patient_id} already exists`);
    }

    const record = await sql2`INSERT INTO records (
            patient_id, name, result, notes, status, progress, message, created_at, updated_at, 
            img1, img2, img3, img4, img5, img6, img7, img8,
            img1_result, img2_result, img3_result, img4_result, img5_result, img6_result, img7_result, img8_result
        )
        SELECT
            patient_id, name, result, notes, status, progress, message, created_at, updated_at,
            img1, img2, img3, img4, img5, img6, img7, img8,
            img1_result, img2_result, img3_result, img4_result, img5_result, img6_result, img7_result, img8_result
        FROM records_gb
        WHERE patient_id = ${body.patient_id}
        RETURNING *
    `;

    const img_dic = await sql2`SELECT img1, img2, img3, img4, img5, img6, img7, img8,
                                     img1_result, img2_result, img3_result, img4_result, img5_result, img6_result, img7_result, img8_result
                                     FROM records_gb WHERE patient_id = ${body.patient_id}`;
    const oldRecord = img_dic[0];    
    console.log(`oldRecord: ${oldRecord}`);

    const newRecord = {
        img1: "tmp/public/uploads/" + oldRecord.img1?.split("/")[3] + "/" + oldRecord.img1?.split("/")[4] ?? "",
        img2: "tmp/public/uploads/" + oldRecord.img2?.split("/")[3] + "/" + oldRecord.img2?.split("/")[4] ?? "",
        img3: "tmp/public/uploads/" + oldRecord.img3?.split("/")[3] + "/" + oldRecord.img3?.split("/")[4] ?? "",
        img4: "tmp/public/uploads/" + oldRecord.img4?.split("/")[3] + "/" + oldRecord.img4?.split("/")[4] ?? "",
        img5: "tmp/public/uploads/" + oldRecord.img5?.split("/")[3] + "/" + oldRecord.img5?.split("/")[4] ?? "",
        img6: "tmp/public/uploads/" + oldRecord.img6?.split("/")[3] + "/" + oldRecord.img6?.split("/")[4] ?? "",
        img7: "tmp/public/uploads/" + oldRecord.img7?.split("/")[3] + "/" + oldRecord.img7?.split("/")[4] ?? "",
        img8: "tmp/public/uploads/" + oldRecord.img8?.split("/")[3] + "/" + oldRecord.img8?.split("/")[4] ?? "",
        img1_result: "tmp/public/uploads/" + oldRecord.img1_result?.split("/")[3] + "/" + oldRecord.img1_result?.split("/")[4] ?? "",
        img2_result: "tmp/public/uploads/" + oldRecord.img2_result?.split("/")[3] + "/" + oldRecord.img2_result?.split("/")[4] ?? "",
        img3_result: "tmp/public/uploads/" + oldRecord.img3_result?.split("/")[3] + "/" + oldRecord.img3_result?.split("/")[4] ?? "",
        img4_result: "tmp/public/uploads/" + oldRecord.img4_result?.split("/")[3] + "/" + oldRecord.img4_result?.split("/")[4] ?? "",
        img5_result: "tmp/public/uploads/" + oldRecord.img5_result?.split("/")[3] + "/" + oldRecord.img5_result?.split("/")[4] ?? "",
        img6_result: "tmp/public/uploads/" + oldRecord.img6_result?.split("/")[3] + "/" + oldRecord.img6_result?.split("/")[4] ?? "",
        img7_result: "tmp/public/uploads/" + oldRecord.img7_result?.split("/")[3] + "/" + oldRecord.img7_result?.split("/")[4] ?? "",
        img8_result: "tmp/public/uploads/" + oldRecord.img8_result?.split("/")[3] + "/" + oldRecord.img8_result?.split("/")[4] ?? "",
    };

    const updated = await sql2`
      UPDATE records
      SET img1 = ${newRecord.img1},
          img2 = ${newRecord.img2},
          img3 = ${newRecord.img3},
          img4 = ${newRecord.img4},
          img5 = ${newRecord.img5},
          img6 = ${newRecord.img6},
          img7 = ${newRecord.img7},
          img8 = ${newRecord.img8},
          img1_result = ${newRecord.img1_result},
          img2_result = ${newRecord.img2_result},
          img3_result = ${newRecord.img3_result},
          img4_result = ${newRecord.img4_result},
          img5_result = ${newRecord.img5_result},
          img6_result = ${newRecord.img6_result},
          img7_result = ${newRecord.img7_result},
          img8_result = ${newRecord.img8_result},
          updated_at = NOW()
      WHERE patient_id = ${body.patient_id}
      RETURNING *;
    `;

    await sql2`DELETE FROM records_gb
        WHERE patient_id = ${body.patient_id}
    `;

    console.log("✅ Step 2 完成:", record[0]);
    return record[0];
  } catch (e) {
    console.error("❌ recoverRecord 發生錯誤:", e);
    throw e;
  }
};

export const deleteDiscardRecord = async (body) => {
  try {
    // raw SQL 查詢
    const existingRecord = await sql2`SELECT * FROM records_gb WHERE patient_id = ${body.patient_id}`;

    console.log("✅ Step 1 結果:", existingRecord);

    if (existingRecord.length === 0) {
      throw new Error(`Record with patient_id ${body.patient_id} already deleted`);
    }

    await sql2`DELETE FROM records_gb
        WHERE patient_id = ${body.patient_id}
    `;

  } catch (e) {
    console.error("❌ deleteDiscardRecord 發生錯誤:", e);
    throw e;
  }
};

/******************************
 
Create functions

******************************/

export const createRecordTable = async () => {
    try {
        console.log("🔍 建立 records 資料表中...");
        
        await sql2`
          CREATE TABLE IF NOT EXISTS records (
            id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            name TEXT NOT NULL,
            task_id TEXT,
            gender TEXT,
            age INTEGER,
            patient_id TEXT NOT NULL,
            result TEXT,
            notes TEXT,
            status TEXT,
            progress INT,
            message TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW(),
            img1 TEXT,
            img2 TEXT,
            img3 TEXT,
            img4 TEXT,
            img5 TEXT,
            img6 TEXT,
            img7 TEXT,
            img8 TEXT,
            img1_result TEXT,
            img2_result TEXT,
            img3_result TEXT,
            img4_result TEXT,
            img5_result TEXT,
            img6_result TEXT,
            img7_result TEXT,
            img8_result TEXT
          )
        `;
        console.log("✅ records 資料表建立完成");
    } catch (e) {
        console.error("❌ 建立 records 資料表失敗:", e);
        throw e;
    }
};

export const createRecord = async (body, mode) => {
  //try {
    // raw SQL 查詢
    console.log(`body: ${JSON.stringify(body)}`);

    const existingRecord = await sql2`SELECT * FROM records WHERE patient_id = ${body.patient_id}`;

    console.log("✅ Step 1 結果:", existingRecord);

    if (existingRecord.length > 0) {
      throw new Error(`Record with patient_id ${body.patient_id} already exists`);
    }

    for (let i = 1; i <= 8; i++) {
      if (!body[`pic${i}_2`]) {
        console.log(`body[pic${i}_2] is null, return`);
        return [];
      }
      console.log(`body[pic${i}_2]: ${body[`pic${i}_2`]}`);
    }

    // tmp/public/uploads/1-1/1-1_8_000060_00.png

    console.log(`
      INSERT INTO records (name, patient_id, updated_at, notes, status, img1, img2, img3, img4, img5, img6, img7, img8)
      VALUES (${body.name}, ${body.patient_id}, NOW(), ${body.notes}, 'not_started', ${body.pic1_2}, ${body.pic2_2}, ${body.pic3_2}, ${body.pic4_2}, ${body.pic5_2}, ${body.pic6_2}, ${body.pic7_2}, ${body.pic8_2})
      RETURNING *
    `);

    const newRecord = await sql2`
        INSERT INTO records 
        (name, patient_id, updated_at, notes, status, img1, img2, img3, img4, img5, img6, img7, img8)
        VALUES (
          ${body.name},
          ${body.patient_id},
          NOW(),
          ${body.notes},
          'not_started',
          ${body.pic1_2},
          ${body.pic2_2},
          ${body.pic3_2},
          ${body.pic4_2},
          ${body.pic5_2},
          ${body.pic6_2},
          ${body.pic7_2},
          ${body.pic8_2}
        )
        RETURNING *
    `;

    console.log("✅ Step 2 完成:", newRecord[0]);

    return newRecord[0];
  //} catch (e) {
  //  console.error("❌ createRecord 發生錯誤:", e);
  //  throw e;
  //}
};

export const createDiscardRecordTable = async () => {
    try {
        console.log("🔍 建立 records_gb 資料表中...");
        
        await sql2`
          CREATE TABLE IF NOT EXISTS records_gb (
            id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            name TEXT,
            gender TEXT,
            age INTEGER,
            patient_id TEXT,
            result TEXT,
            notes TEXT,
            status TEXT,
            progress INT,
            message TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW(),
            img1 TEXT,
            img2 TEXT,
            img3 TEXT,
            img4 TEXT,
            img5 TEXT,
            img6 TEXT,
            img7 TEXT,
            img8 TEXT,
            img1_result TEXT,
            img2_result TEXT,
            img3_result TEXT,
            img4_result TEXT,
            img5_result TEXT,
            img6_result TEXT,
            img7_result TEXT,
            img8_result TEXT
          )
        `;
        console.log("✅ records_gb 資料表建立完成");
    } catch (e) {
        console.error("❌ 建立 records_gb 資料表失敗:", e);
        throw e;
    }
};

/******************************

Update functions

*******************************/

export const updateRecord = async (
  body = {},
  imgUpdates = {},
  mode = "development"
) => {
  try {
    const patientId = body.patient_id;
    if (!patientId) {
      throw new Error("patient_id is required for updateRecord");
    }

    // 先確認該紀錄是否存在（用 template literal 寫法）
    const existing = await sql2`
      SELECT * FROM records WHERE patient_id = ${patientId}
    `;
    if (!existing || existing.length === 0) {
      throw new Error(`Record ${patientId} not found`);
    }

    // -------------------------------
    // 1️⃣ 收集要更新的欄位
    // -------------------------------
    const updateFields = {};

    for (const [key, val] of Object.entries(body || {})) {
      console.log(`key: ${key}, val: ${val}`);

      if (val === undefined || val === null || val === "") continue;

      // 直接更新的欄位
      if (key === "name" || key === "notes") {
        updateFields[key] = val;
        continue;
      }

      // *_2 -> 通常是原始上傳路徑，這裡你原本選擇略過
      if (key.endsWith("_2") && val) {
        continue;
      }

      // *_edit -> 對應到實際欄位名稱
      if (key.endsWith("_edit") && val) {
        const newKey = key.replace("_edit", "");
        console.log(`newKey (from *_edit): ${newKey}`);
        updateFields[newKey] = val;
        continue;
      }

      // picX -> imgX (開發模式使用)
      if (key.startsWith("pic") && val && mode === "development") {
        const newKey = key.replace("pic", "img");
        console.log(`newKey (from picX): ${newKey}`);
        updateFields[newKey] = val;
        continue;
      }
    }

    console.log(`updateFields: ${JSON.stringify(updateFields)}`);

    if (Object.keys(updateFields).length === 0) {
      console.log("⚠️ 沒有欄位需要更新，直接回傳原本紀錄");
      return existing[0];
    }

    // -------------------------------
    // 2️⃣ 動態生成 SQL 語法（用 query()）
    // -------------------------------
    const setClauses = [];
    const values = [];
    let index = 1;

    for (const [col, val] of Object.entries(updateFields)) {
      // 用 escapeIdentifier 保護欄位名稱
      const safeCol = escapeIdentifier(col);
      setClauses.push(`${safeCol} = $${index++}`);
      values.push(val);
    }

    // updated_at
    setClauses.push(`"updated_at" = NOW()`);

    const sqlText = `
      UPDATE records
      SET ${setClauses.join(", ")}
      WHERE "patient_id" = $${index}
      RETURNING *;
    `;

    values.push(patientId);

    console.log("Final UPDATE SQL:", sqlText);
    console.log("With values:", values);

    // -------------------------------
    // 3️⃣ 用 query() 執行
    // -------------------------------
    const rows = await query(sqlText, values);

    if (!rows || rows.length === 0) {
      throw new Error(`Update failed for patient_id=${patientId}`);
    }

    console.log("✅ updateRecord 完成:", rows[0]);
    return rows[0];

  } catch (e) {
    console.error("❌ updateRecord 發生錯誤:", e);
    throw e;
  }
};

function escapeIdentifier(column) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(column)) {
    throw new Error(`Invalid SQL identifier: ${column}`);
  }
  return `"${column}"`;
};

export const updateRecordIndividual = async (
  fieldname_ref,
  value_ref,
  fieldname,
  value
) => {
  try {
    const colRef = escapeIdentifier(fieldname_ref);
    const colUpdate = escapeIdentifier(fieldname);

    const sql = `
      UPDATE records
      SET ${colUpdate} = $1
      WHERE ${colRef} = $2
      RETURNING *
    `;

    const rows = await query(sql, [value, value_ref]);

    return rows[0];

  } catch (e) {
    console.error("❌ updateRecordIndividual error:", e);
    throw e;
  }
};