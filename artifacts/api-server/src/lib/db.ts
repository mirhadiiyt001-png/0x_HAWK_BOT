import { Pool } from "pg";
import { logger } from "./logger";

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export async function runMigrations(): Promise<void> {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS phone_statuses (
        phone TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'not_tried',
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    logger.info("DB migrations complete");
  } catch (err) {
    logger.error({ err }, "DB migration failed");
  }
}
