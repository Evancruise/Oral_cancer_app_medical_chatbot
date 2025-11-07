import { neon, neonConfig } from '@neondatabase/serverless';
import { Pool } from 'pg';
import { logToFile } from '#config/logger.js';

import 'dotenv/config';

let sql = null; // 統一的 query 函式

async function initDatabase() {
  // 嘗試使用 Neon（WebSocket 模式）
  try {
    if (process.env.NODE_ENV === "development") {
      neonConfig.useSecureWebSocket = true;
      neonConfig.poolQueryViaFetch = false;
      console.log("🧩 [Neon] Using secure WebSocket mode (dev)");
      logToFile("Using Neon WebSocket mode (development");
    }

    const neonSql = neon(process.env.DATABASE_URL);
    // 試探性查詢：確保 Neon 可以連線
    await neonSql`SELECT NOW()`;
    console.log("✅ Connected to Neon successfully!");
    logToFile("✅ Connected to Neon successfully!");
    sql = neonSql;
    return;
  } catch (err) {
    console.warn("⚠️ Neon connection failed, switching to pg Pool...");
    logToFile("⚠️ Neon connection failed, switching to pg Pool...");
    console.error(err.message);
  }

  // 若 Neon 失敗，改用 pg Pool（生產模式常用）
  try {
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 10,
      idleTimeoutMillis: 30000,
    });

    const client = await pool.connect();
    await client.query("SELECT NOW()");
    client.release();
    console.log("✅ Connected to PostgreSQL via pg Pool!");
    logToFile("✅ Connected to PostgreSQL via pg Pool!");

    pool.on('connect', () => logger.info('✅ PostgreSQL connected via pg Pool'));
    pool.on('remove', () => logger.warn('⚠️ PostgreSQL connection closed'));
    pool.on('error', (err) => logger.error('❌ PostgreSQL error', { stack: err.stack }));

    await pool.query(
        'INSERT INTO models (model_name, gcs_path, version, created_at) VALUES ($1, $2, $3, NOW())',
        ['yolov8_epoch50.pt', 'gs://oral-cancer-storage/models/yolov8_epoch50.pt', 'v1.0']
    );

    // 包裝統一的 async query 函式
    sql = async (strings, ...values) => {
      const text = strings.join('$') + (values.length ? `$${values.length}` : '');
      const result = await pool.query(text, values);
      return result.rows;
    };
  } catch (err) {
    console.error("❌ Both Neon and pg Pool connection failed!");
    logToFile("❌ Both Neon and pg Pool connection failed!");
    throw err;
  }
}

await initDatabase();

export { sql };
