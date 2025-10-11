import { sql } from "#config/database.js";

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
        const result = await sql`
          SELECT
            id,
            name,
            gender,
            age,
            patient_id,
            created_at,
            updated_at,
            result,
            notes,
            status,
            result,
            img1,
            img2,
            img3,
            img4,
            img5,
            img6,
            img7,
            img8,
            img1_result,
            img2_result,
            img3_result,
            img4_result,
            img5_result,
            img6_result,
            img7_result,
            img8_result 
          FROM records
        `;
        return result;
    } catch (e) {
        console.error("Error getting records", e);
        throw e;
    }
};

export const getAllDiscardRecords = async () => {
    try {
        const result = await sql`
          SELECT
            id,
            name,
            gender,
            age,
            patient_id,
            created_at,
            updated_at,
            result,
            notes,
            img1,
            img2,
            img3,
            img4,
            img5,
            img6,
            img7,
            img8,
            img1_result,
            img2_result,
            img3_result,
            img4_result,
            img5_result,
            img6_result,
            img7_result,
            img8_result 
          FROM records_gb
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
        result = await sql`SELECT * FROM records WHERE name = ${value}`;
    } else if (key === "id") {
        result = await sql`SELECT * FROM records WHERE id = ${value}`;
    } else if (key == "patient_id") {
        result = await sql`SELECT * FROM records WHERE patient_id = ${value}`;
    }
    return result;
};

export const getDiscardRecord = async (key, value) => {
    let result = null;
    if (key === "name") {
        result = await sql`SELECT * FROM records_gb WHERE name = ${value}`;
    } else if (key === "id") {
        result = await sql`SELECT * FROM records_gb WHERE id = ${value}`;
    }
    return result;
};

/******************************

Remove functions

*******************************/

export const removeRecordTable = async () => {
  try {
    console.log("🔍 刪除 records 資料表中...");
    await sql`DROP TABLE IF EXISTS records`;
    console.log("✅ 刪除 records 資料表完成");
  } catch (e) {
    console.error("❌ 刪除 records 資料表失敗:", e);
    throw e;
  }
};

export const removeDiscardRecordTable = async () => {
  try {
    console.log("🔍 刪除 records_gb 資料表中...");
    await sql`DROP TABLE IF EXISTS records_gb`;
    console.log("✅ 刪除 records_gb 資料表完成");
  } catch (e) {
    console.error("❌ 刪除 records_gb 資料表失敗:", e);
    throw e;
  }
};

export const deleteRecord = async (body) => {
  try {
    // raw SQL 查詢
    const existingRecord = await sql`SELECT * FROM records WHERE patient_id = ${body.patient_id}`;

    console.log("✅ Step 1 結果:", existingRecord);

    if (existingRecord.length == 0) {
      throw new Error(`Record with patient_id ${body.patient_id} has already deleted`);
    }

    await sql`INSERT INTO records_gb (
            name, gender, age, patient_id, result, notes, status, progress, message, created_at, updated_at, 
            img1, img2, img3, img4, img5, img6, img7, img8,
            img1_result, img2_result, img3_result, img4_result, img5_result, img6_result, img7_result, img8_result
        )
        SELECT
            name, gender, age, patient_id, result, notes, status, progress, message, created_at, updated_at,
            img1, img2, img3, img4, img5, img6, img7, img8,
            img1_result, img2_result, img3_result, img4_result, img5_result, img6_result, img7_result, img8_result
        FROM records
        WHERE patient_id = ${body.patient_id}
        RETURNING *
    `;

    const img_dic = await sql`SELECT * FROM records_gb WHERE patient_id = ${body.patient_id}`;
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

    const updated = await sql`
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

    await sql`DELETE FROM records 
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
    const existingRecord = await sql`SELECT * FROM records_gb WHERE patient_id = ${body.patient_id}`;

    console.log("✅ Step 1 結果:", existingRecord);

    if (existingRecord.length == 0) {
      throw new Error(`Record with patient_id ${body.patient_id} has already deleted`);
    }

    await sql`DELETE FROM records_gb 
        WHERE patient_id = ${body.patient_id}
    `;

    console.log("✅ Step 2 完成");
  } catch (e) {
    console.error("❌ deleteDiscardRecordTable 發生錯誤:", e);
    throw e;
  }
};

export const recoverRecord = async (body) => {
  try {

    console.log(`body:`, JSON.stringify(body));
    // raw SQL 查詢
    const existingRecord = await sql`SELECT * FROM records WHERE patient_id = ${body.patient_id}`;

    console.log("✅ Step 1 結果:", existingRecord);

    if (existingRecord.length !== 0) {
      throw new Error(`Record with patient_id ${body.patient_id} already exists`);
    }

    const record = await sql`INSERT INTO records (
            name, gender, age, patient_id, result, notes, status, progress, message, created_at, updated_at, 
            img1, img2, img3, img4, img5, img6, img7, img8,
            img1_result, img2_result, img3_result, img4_result, img5_result, img6_result, img7_result, img8_result
        )
        SELECT
            name, gender, age, patient_id, result, notes, status, progress, message, created_at, updated_at,
            img1, img2, img3, img4, img5, img6, img7, img8,
            img1_result, img2_result, img3_result, img4_result, img5_result, img6_result, img7_result, img8_result
        FROM records_gb
        WHERE patient_id = ${body.patient_id}
        RETURNING *
    `;

    const img_dic = await sql`SELECT img1, img2, img3, img4, img5, img6, img7, img8,
                                     img1_result, img2_result, img3_result, img4_result, img5_result, img6_result, img7_result, img8_result
                                     FROM records_gb WHERE patient_id = ${body.patient_id}`;
    const oldRecord = img_dic[0];    

    const newRecord = {
        img1: "static/uploads/" + oldRecord.img1?.split("/")[2] + "/" + oldRecord.img1?.split("/")[3] ?? "",
        img2: "static/uploads/" + oldRecord.img2?.split("/")[2] + "/" + oldRecord.img2?.split("/")[3] ?? "",
        img3: "static/uploads/" + oldRecord.img3?.split("/")[2] + "/" + oldRecord.img3?.split("/")[3] ?? "",
        img4: "static/uploads/" + oldRecord.img4?.split("/")[2] + "/" + oldRecord.img4?.split("/")[3] ?? "",
        img5: "static/uploads/" + oldRecord.img5?.split("/")[2] + "/" + oldRecord.img5?.split("/")[3] ?? "",
        img6: "static/uploads/" + oldRecord.img6?.split("/")[2] + "/" + oldRecord.img6?.split("/")[3] ?? "",
        img7: "static/uploads/" + oldRecord.img7?.split("/")[2] + "/" + oldRecord.img7?.split("/")[3] ?? "",
        img8: "static/uploads/" + oldRecord.img8?.split("/")[2] + "/" + oldRecord.img8?.split("/")[3] ?? "",
        img1_result: "static/uploads/" + oldRecord.img1_result?.split("/")[2] + "/" + oldRecord.img1_result?.split("/")[3] ?? "",
        img2_result: "static/uploads/" + oldRecord.img2_result?.split("/")[2] + "/" + oldRecord.img2_result?.split("/")[3] ?? "",
        img3_result: "static/uploads/" + oldRecord.img3_result?.split("/")[2] + "/" + oldRecord.img3_result?.split("/")[3] ?? "",
        img4_result: "static/uploads/" + oldRecord.img4_result?.split("/")[2] + "/" + oldRecord.img4_result?.split("/")[3] ?? "",
        img5_result: "static/uploads/" + oldRecord.img5_result?.split("/")[2] + "/" + oldRecord.img5_result?.split("/")[3] ?? "",
        img6_result: "static/uploads/" + oldRecord.img6_result?.split("/")[2] + "/" + oldRecord.img6_result?.split("/")[3] ?? "",
        img7_result: "static/uploads/" + oldRecord.img7_result?.split("/")[2] + "/" + oldRecord.img7_result?.split("/")[3] ?? "",
        img8_result: "static/uploads/" + oldRecord.img8_result?.split("/")[2] + "/" + oldRecord.img8_result?.split("/")[3] ?? "",
    };

    const updated = await sql`
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

    await sql`DELETE FROM records_gb
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
    const existingRecord = await sql`SELECT * FROM records_gb WHERE patient_id = ${body.patient_id}`;

    console.log("✅ Step 1 結果:", existingRecord);

    if (existingRecord.length == 0) {
      throw new Error(`Record with patient_id ${body.patient_id} already deleted`);
    }

    await sql`DELETE FROM records_gb
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
        
        await sql`
          CREATE TABLE IF NOT EXISTS records (
            id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            name TEXT NOT NULL,
            gender TEXT NOT NULL,
            age INTEGER NOT NULL,
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

export const createRecord = async (body) => {
  //try {
    // raw SQL 查詢
    console.log(`body: ${JSON.stringify(body)}`);

    const existingRecord = await sql`SELECT * FROM records WHERE patient_id = ${body.patient_id}`;

    console.log("✅ Step 1 結果:", existingRecord);

    if (existingRecord.length > 0) {
      throw new Error(`Record with patient_id ${body.patient_id} already exists`);
    }

    console.log(`
      INSERT INTO records (name, gender, age, patient_id, notes, updated_at, status, img1, img2, img3, img4, img5, img6, img7, img8)
      VALUES (${body.name}, ${body.gender}, ${body.age}, ${body.patient_id}, ${body.notes}, NOW(), 'not_started', ${body.pic1_2}, ${body.pic2_2}, ${body.pic3_2}, ${body.pic4_2}, ${body.pic5_2}, ${body.pic6_2}, ${body.pic7_2}, ${body.pic8_2})
      RETURNING name, gender, age, patient_id, notes, created_at, updated_at, img1, img2, img3, img4, img5, img6, img7, img8
    `);

    const newRecord = await sql`
      INSERT INTO records (name, gender, age, patient_id, notes, updated_at, status, img1, img2, img3, img4, img5, img6, img7, img8)
      VALUES (${body.name}, ${body.gender}, ${body.age}, ${body.patient_id}, ${body.notes}, NOW(), 'not_started', ${body.pic1_2}, ${body.pic2_2}, ${body.pic3_2}, ${body.pic4_2}, ${body.pic5_2}, ${body.pic6_2}, ${body.pic7_2}, ${body.pic8_2})
      RETURNING name, gender, age, patient_id, notes, created_at, updated_at, img1, img2, img3, img4, img5, img6, img7, img8
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
        
        await sql`
          CREATE TABLE IF NOT EXISTS records_gb (
            id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            name TEXT NOT NULL,
            gender TEXT NOT NULL,
            age INTEGER NOT NULL,
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
        console.log("✅ records_gb 資料表建立完成");
    } catch (e) {
        console.error("❌ 建立 records_gb 資料表失敗:", e);
        throw e;
    }
};

/******************************

Update functions

*******************************/

export const updateRecord = async (body = null, imgUpdates = null) => {
  try {
    // raw SQL 查詢
    const existingRecord = await sql`SELECT * FROM records WHERE patient_id = ${body.patient_id}`;
    // const existingRecord = await getRecord(fieldname, value);

    console.log("✅ Step 1 結果:", existingRecord);

    if (existingRecord.length == 0) {
      throw new Error(`Record with patient_id ${body.patient_id} not exists`);
    }

    const editRecord = await sql`
        UPDATE records
        SET 
          name = ${body.name},
          gender = ${body.gender},
          age = ${body.age},
          notes = ${body.notes},
          updated_at = NOW(),
          img1 = ${imgUpdates.pic1_2},
          img2 = ${imgUpdates.pic2_2},
          img3 = ${imgUpdates.pic3_2},
          img4 = ${imgUpdates.pic4_2},
          img5 = ${imgUpdates.pic5_2},
          img6 = ${imgUpdates.pic6_2},
          img7 = ${imgUpdates.pic7_2},
          img8 = ${imgUpdates.pic8_2}
        WHERE patient_id = ${body.patient_id}
        RETURNING *
      `;

    console.log("✅ Step 2 完成:", editRecord[0]);
    return editRecord[0];
  } catch (e) {
    console.error("❌ createRecord 發生錯誤:", e);
    throw e;
  }
};

export const updateRecordStatus = async (patient_id, fieldname, value) => {
  try {
    const existingRecord = await getRecord("patient_id", patient_id);

    if (existingRecord.length === 0) {
      throw new Error(`Record with patient_id ${body.patient_id} not exists`);
    }

    const editRecord = await sql`
      UPDATE records
      SET
        status = ${value}
      WHERE patient_id = ${patient_id}
      RETURNING *
    `;

    console.log("✅ Step 2 完成:", editRecord[0]);
    return editRecord[0];
  } catch (e) {
    console.error("❌ updateRecordStatus 發生錯誤:", e);
    throw e;
  }
};