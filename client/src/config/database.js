import { neon, neonConfig } from '@neondatabase/serverless';
import { Pool } from 'pg';
import 'dotenv/config';

let sql2 = null;   // for template literal
let query = null;  // for regular "text + values"

async function initDatabase() {
  try {
    const neonSql = neon(process.env.DATABASE_URL);

    // Test neon connection
    await neonSql`SELECT 1`;

    sql2 = neonSql;
    query = neonSql.query;   // ⭐ Neon serverless 支援 sql.query()

    console.log("Using Neon serverless");
    return;
  } catch (err) {
    console.warn("Neon connect failed, fallback to pg Pool");
  }

  try {
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    });

    await pool.query("SELECT 1");

    sql2 = (strings, ...values) => {
      const text = strings.join("$") + (values.length ? `$${values.length}` : "");
      return pool.query(text, values).then(r => r.rows);
    };

    query = (text, values) =>
      pool.query(text, values).then(r => r.rows);

    console.log("Using pg Pool");
    return;
  } catch (err) {
    console.error("❌ Both Neon and pg failed");
    throw err;
  }
}

await initDatabase();

export { sql2, query };
