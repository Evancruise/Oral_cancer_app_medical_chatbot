import { sql } from "#config/database.js";

/***************************************

Get function

***************************************/

export const getAllRegisters = async () => {
    try {
        const result = await sql`
          SELECT
            id,
            email,
            name,
            role,
            status,
            created_at,
            expired_at
          FROM registers
        `;
        return result;
    } catch (e) {
        console.error("Error getting registers", e);
        throw e;
    }
};

export const findRegister = async ({email}) => {
    const result = await sql`SELECT * FROM registers WHERE email = ${email}`;
    return result[0] || null;
};

export const getRegister = async (fieldname, value) => {
    console.log(`Search for ${fieldname}=${value}`);
    let result = null;

    if (fieldname == "id") {
      result = await sql`SELECT * FROM registers WHERE id = ${value}`;
    } else if (fieldname == "name") {
      result = await sql`SELECT * FROM registers WHERE name = ${value}`;
    } else if (fieldname == "email") {
      result = await sql`SELECT * FROM registers WHERE email = ${value}`;
    }

    return result[0] || null;
};

/*********************************
 
Delete functions

*********************************/

export const removeRegisterTable = async() => {
  try {
    console.log("🔍 刪除 registers 資料表中...");
    await sql`DROP TABLE registers`;

    console.log("✅ 刪除 registers 資料表完成");
  } catch (e) {
    console.error("❌ 刪除 registers 資料表失敗:", e);
    throw e;
  }
};

/*********************************
 
Update functions

*********************************/

export const updateRegister = async (fieldname, value, updates) => {
    const existing = await getRegister(fieldname, value);
    if (!existing) throw new Error("User not found");

    const setClauses = [];

    if (updates.status) {
      setClauses.push(`status = '${updates.status}'`);
    } else {
      updates.status = existing.status;
    }
    
    console.log(`updates: ${JSON.stringify(updates)}`);
    console.log("applying update sql command");
    
    const updated = await sql`UPDATE registers
    SET name = ${updates.name}, email = ${updates.email}, role = ${updates.role}, status = ${updates.status}
    WHERE id = ${updates.id}
    RETURNING id, name, email, status
    `;

    if (updated.length === 0) {
      throw new Error(`Update failed: user ${id} not found`);
    }

    console.log("Updated registers successfully");
    return updated[0];
};