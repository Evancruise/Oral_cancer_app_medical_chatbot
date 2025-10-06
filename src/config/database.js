import 'dotenv/config';
import { neon, neonConfig } from '@neondatabase/serverless';

if (process.env.NODE_ENV === 'development') {
  neonConfig.useSecureWebSocket = false;
  neonConfig.poolQueryViaFetch = true;
  console.log("✅ Using Neon Local Proxy (dev mode)");
}

export const sql = neon(process.env.DATABASE_URL);