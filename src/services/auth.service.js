import { sql } from "#config/database.js";

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
}