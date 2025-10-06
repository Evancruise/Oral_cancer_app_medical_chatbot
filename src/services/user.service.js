import { sql } from "#config/database.js";

export const removeUserTable = async() => {
  try {
    console.log("🔍 刪除 users 資料表中...");
    await sql`DROP TABLE users`;

    console.log("✅ 刪除 users 資料表完成");
  } catch (e) {
    console.error("❌ 刪除 users 資料表失敗:", e);
    throw e;
  }
};

export const getAllUsers = async () => {
    try {
        const result = await sql`
          SELECT
            id,
            email,
            name,
            role,
            unit,
            password,
            created_at,
            updated_at,
            allowed_loggin_at 
          FROM users
        `;
        return result;
    } catch (e) {
        console.error("Error getting users", e);
        throw e;
    }
};