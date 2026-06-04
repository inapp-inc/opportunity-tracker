import { parentPort } from 'worker_threads';
import fs from 'fs';
import pg from 'pg';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.PGSSL === '1' || process.env.PGSSL === 'true'
      ? { rejectUnauthorized: process.env.PGSSL_REJECT_UNAUTHORIZED !== '0' }
      : undefined,
});

parentPort.on('message', async (message) => {
  const status = new Int32Array(message.sharedBuffer);
  try {
    const result = await pool.query(message.sql, message.params || []);
    fs.writeFileSync(
      message.resultPath,
      JSON.stringify({
        rows: result.rows || [],
        rowCount: result.rowCount || 0,
      })
    );
    Atomics.store(status, 0, 1);
  } catch (error) {
    fs.writeFileSync(
      message.resultPath,
      JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
      })
    );
    Atomics.store(status, 0, 2);
  }
  Atomics.notify(status, 0);
});
