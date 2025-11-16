import { sql2 } from "#config/database.js";
import bcrypt from "bcrypt";
import { createUser } from "#services/auth.service.js";

/***************************************
  
Delete functions

****************************************/

export const removeUserTable = async() => {
  try {
    console.log("🔍 刪除 users 資料表中...");
    await sql2`DROP TABLE IF EXISTS users;`;

    console.log("✅ 刪除 users 資料表完成");
  } catch (e) {
    console.error("❌ 刪除 users 資料表失敗:", e);
    throw e;
  }
};

export const deleteUser = async (fieldname, value) => {
    const existing = await getUser(fieldname, value);

    if (!existing) {
      throw new Error("User not found");
    }

    if (fieldname === "id") {
      await sql2`DELETE FROM users WHERE id = ${value}`;
    } else if (fieldname === "name") {
      await sql2`DELETE FROM users WHERE name = ${value}`;
    } else if (fieldname === "email") {
      await sql2`DELETE FROM users WHERE email = ${value}`;
    }
    return { message: `User deleted successfully` };
};

/***************************************
  
Create functions

****************************************/

export const createUsersTable = async () => {
  try {
    console.log("🔍 建立 users 資料表中...");

    await sql2`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) UNIQUE,
        email VARCHAR(255) UNIQUE,
        password TEXT,
        retry_times INTEGER DEFAULT 5,
        role VARCHAR(50) DEFAULT 'tester',
        login_role VARCHAR(50) DEFAULT 'patient',
        unit VARCHAR(100) DEFAULT 'personal',
        is_used BOOLEAN DEFAULT false,
        note TEXT,
        shareAnalysis TEXT,
        allowResearch TEXT,
        notifyResult TEXT,
        notifyReminder TEXT,
        qr_token VARCHAR(255) UNIQUE,
        status VARCHAR(50) DEFAULT 'deactivated',
        created_at TIMESTAMPTZ DEFAULT NOW(), 
        expired_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ DEFAULT NOW(),      
        allowed_loggin_at TIMESTAMPTZ DEFAULT NOW(),
        timezone VARCHAR(50) DEFAULT 'UTC'          
      )
    `;

    const admin_user = await createUser({ name: process.env.NAME, email: process.env.ACCOUNT, password: process.env.DB_PASSWORD, role: "system manager", note: "none" });

    console.log("✅ users 資料表建立完成");
  } catch (e) {
    console.error("❌ 建立 users 資料表失敗:", e);
    throw e;
  }
};

/***************************************
  
Get functions

****************************************/

export const getAllUsers = async () => {
    try {
        const result = await sql2`
          SELECT
            *
          FROM users
        `;
        return result;
    } catch (e) {
        console.error("Error getting users", e);
        throw e;
    }
};

export const getUser = async (fieldname, value) => {
    console.log(`Search for ${fieldname}=${value}`);

    let result=null;

    if (fieldname === "name") {
      result = await sql2`SELECT * FROM users WHERE name = ${value}`;
    }

    if (fieldname === "email") {
      result = await sql2`SELECT * FROM users WHERE email = ${value}`;
    }

    if (fieldname === "id") {
      result = await sql2`SELECT * FROM users WHERE id = ${value}`;
    }

    return result[0] || null;
};

export const getTempUser = async (qr_token) => {
    const existingUser = await sql2`SELECT * FROM users WHERE qr_token = ${qr_token}`;

    console.log("Step 1 結果:", existingUser);

    if (existingUser.length === 0) {
      throw new Error(`User with qr_token ${qr_token} not exists`);
    }

    return existingUser[0];
};

/***************************************
  
Update functions

****************************************/

export const markQrUsed = async (qr_token) => {
    const existingUser = await sql2`SELECT * FROM users WHERE qr_token = ${qr_token}`;

    console.log("Step 1 結果:", existingUser);

    if (existingUser.length === 0) {
      throw new Error(`User with qr_token ${qr_token} not exists`);
    }

    const updated = await sql2`UPDATE users
    SET is_used = true 
    WHERE qr_token = ${qr_token}
    RETURNING qr_token, is_used, expired_at`;

    if (updated.length === 0) {
      throw new Error(`Update failed: user with token ${qr_token} not found`);
    }

    console.log("Updated users Successfully");
    return updated[0];
};

export const updateUserGroup = async (fieldnames, values = null, updates = null) => {
    if (!updates || Object.keys(updates).length === 0) {
      throw new Error("No update data provided");
    }

    const setClauses = [];
    const params = [];
    let paramIndex = 1;

    // 動態產生 SET 子句
    for (const field of fieldnames) {
      if (updates[field] !== undefined && updates[field] !== null) {
        setClauses.push(`${field} = $${paramIndex++}`);
        params.push(updates[field]);
      }
    }

    // 動態產生 WHERE 子句
    const whereClauses = [];
    if (values) {
      for (const key in values) {
        whereClauses.push(`${key} = $${paramIndex++}`);
        params.push(values[key]);
      }
    }

    // 組合 SQL 字串
    const sqlText = `
      UPDATE users
      SET ${setClauses.join(", ")}
      ${whereClauses.length ? `WHERE ${whereClauses.join(" AND ")}` : ""}
      RETURNING *;
    `;

    console.log("📜 SQL:", sqlText);
    console.log("🧩 Params:", params);

    const result = await sql.query(sqlText, params);

    console.log(`result: ${result}`);
    return result[0];
};

export const updateUser = async (fieldname, value = null, updates = null) => {
    const existing = await getUser(fieldname, value);

    console.log(`existing: ${JSON.stringify(existing)}`);

    if (!existing) {throw new Error("User not found");}

    const setClauses = [];

    if (updates.name) {
      setClauses.push(`name = '${updates.name}'`);
    } else {
      updates.name = existing.name;
    }

    if (updates.email) {
      setClauses.push(`email = '${updates.email}'`);
    } else {
      updates.email = existing.email;
    }

    if (updates.role) {
      setClauses.push(`role = '${updates.role}'`);
    } else {
      updates.role = existing.role;
    }

    if (updates.unit) {
      setClauses.push(`unit = '${updates.unit}'`);
    } else {
      updates.unit = existing.unit;
    }

    if (updates.is_used) {
      setClauses.push(`is_used = '${updates.is_used}'`);
    } else {
      updates.is_used = existing.is_used;
    }

    if (updates.notes) {
      setClauses.push(`note = '${updates.notes}'`);
    } else {
      updates.notes = existing.notes;
    }

    let password_hash = null;
    if (updates.password) {
      password_hash = await bcrypt.hash(updates.password, 10);
      updates.password = password_hash;
      setClauses.push(`password = ${password_hash}`);
    } else {
      password_hash = await bcrypt.hash(existing.password, 10);
      updates.password = password_hash;
    }

    if (setClauses.length === 0) {return existing;}

    console.log("applying update sql command");
    
    const updated = await sql2`UPDATE users
    SET name = ${updates.name}, email = ${updates.email}, role = ${updates.role}, password = ${updates.password}, unit = ${updates.unit}, is_used = ${updates.is_used}, note = ${updates.notes}, updated_at = NOW() AT TIME ZONE timezone
    WHERE id = ${existing.id}
    RETURNING *
    `;

    if (updated.length === 0) {
      throw new Error(`Update failed: user ${updated.id} not found`);
    }

    console.log("Updated users Successfully");
    return updated[0];
};

export const updateUserPassword = async (flag = false, fieldname, value = null) => {

    if (flag === false) 
    {
        if (fieldname === "name") 
        {
            await sql2`UPDATE users
            SET retry_times = retry_times - 1,
                updated_at = NOW(),
                allowed_loggin_at = CASE
                    WHEN retry_times - 1 <= 0
                    THEN NOW() + INTERVAL '10 minutes'
                    ELSE allowed_loggin_at
                END
            WHERE name = ${value};`;
        } 
        else if (fieldname === "email") 
        {
            await sql2`UPDATE users
            SET retry_times = retry_times - 1,
                updated_at = NOW(),
                allowed_loggin_at = CASE
                    WHEN retry_times - 1 <= 0
                    THEN NOW() + INTERVAL '10 minutes'
                    ELSE allowed_loggin_at
                END
            WHERE email = ${value};`;
        }
    } else {
        if (fieldname === "name") 
        {
            await sql2`UPDATE users
            SET retry_times = 5,
                updated_at = NOW(),
                allowed_loggin_at = NOW()
            WHERE name = ${value};`;
        }
        else if (fieldname === "email") 
        {
            await sql2`UPDATE users
            SET retry_times = 5,
                updated_at = NOW(),
                allowed_loggin_at = NOW()
            WHERE email = ${value};`;
        }
    }
};

/*
Check for user login authorization
*/
export const check_user_login = async (fieldname, value = null) => {
    let allowed = false;  

    if (fieldname === "name") {
        allowed = await sql2`SELECT * FROM users
        WHERE name = ${value}
        AND allowed_loggin_at <= NOW();`;
    } else if (fieldname === "email") {
        allowed = await sql2`SELECT * FROM users
        WHERE email = ${value}
        AND allowed_loggin_at <= NOW();`;
    }

    console.log(`allowed_loggin: ${allowed}`);
    return allowed;
};


/**********************************
 
Update user info from register

***********************************/

export const updateUserTableFromRegister = async (id, name) => {

    const result = await sql2`SELECT * FROM users WHERE name = ${name}`;

    if (result.length !== 0) {
      throw new Error(`Update failed: user ${name} has already existed`);
    }
    
    const updated = await sql2`INSERT INTO users (
                name, email, role, created_at
              )
              SELECT name, email, role, created_at FROM registers
              WHERE id=${id}
              RETURNING id, name, email, role, created_at`;
    
    if (updated.length === 0) {
      throw new Error(`Update failed: register ${id} not found`);
    } 

    console.log("Updated users from registers successfully");
    return updated[0];
};