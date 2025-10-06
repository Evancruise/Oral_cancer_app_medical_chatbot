import { sql } from "#config/database.js";
import bcrypt from "bcrypt";

/*********************************
 
Create functions

*********************************/

export const createUser = async ({ name, email, password, role = "tester", login_role = "patient", unit = "personal", note = "none" }) => {
  try {
    // raw SQL 查詢
    const existingUser = await sql`SELECT * FROM users WHERE email = ${email}`;

    console.log("✅ Step 1 結果:", existingUser);

    if (existingUser.length > 0) {
      throw new Error(`User with email ${email} already exists`);
    }

    console.log("🔍 Step 2: 開始雜湊密碼");
    const password_hash = await bcrypt.hash(password, 10);
    console.log("✅ Step 2 完成，hash=", password_hash);

    console.log("🔍 Step 3: 插入新使用者");

    const newUser = await sql`
      INSERT INTO users (name, email, password, role, login_role, unit, note)
      VALUES (${name}, ${email}, ${password_hash}, ${role}, ${login_role}, ${unit}, ${note})
      RETURNING id, name, email, password, role, login_role, unit, note, status, created_at
    `;

    console.log("✅ Step 3 完成:", newUser[0]);

    return newUser[0];
  } catch (e) {
    console.error("❌ createUser 發生錯誤:", e);
    throw e;
  }
};

export const createUsersTable = async () => {
  try {
    console.log("🔍 建立 users 資料表中...");

    await sql`
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
    //res.status(200).json({ message: "Init user table successfully" });
  } catch (e) {
    console.error("❌ 建立 users 資料表失敗:", e);
    throw e;
  }
};

export const createRegister = async ({ name, email, role = "tester" }) => {
    try {
        // raw SQL 查詢
        const existingRegister = await sql`SELECT * FROM registers WHERE email = ${email}`;

        if (existingRegister.length > 0) {
            throw new Error(`Register with email ${email} already exists`);
        }

        const newRegister = await sql`
        INSERT INTO registers (name, email, role, status, created_at, expired_at)
        VALUES (${name}, ${email}, ${role}, 'pending', NOW(), NOW() + interval '1 hour')
        RETURNING id, name, email, status, created_at, expired_at
        `;

        console.log("✅ Step 3 完成:", newRegister[0]);
        return newRegister[0];
    } catch(err) {
        console.error("❌ createRegister 發生錯誤:", err);
        throw err;
    }
};

export const createRegisterTable = async () => {
  try {
    console.log("🔍 建立 registers 資料表中...");

    await sql`
      CREATE TABLE IF NOT EXISTS registers (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) UNIQUE NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password TEXT,
        role VARCHAR(50) DEFAULT 'tester',
        status VARCHAR(50) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT NOW(),
        expired_at TIMESTAMP DEFAULT NOW(),
        timezone VARCHAR(50) DEFAULT 'UTC'
      )
    `;

    console.log("✅ registers 資料表建立完成");
    //res.status(200).json({ message: "Delete register table successfully" });
  } catch (e) {
    console.error("❌ 建立 registers 資料表失敗:", e);
    throw e;
  }
};