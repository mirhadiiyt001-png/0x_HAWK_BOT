import { Pool } from "pg";
import { logger } from "./logger";

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ── Seed data ─────────────────────────────────────────────────────────────────
// ON CONFLICT DO NOTHING → first deploy inserts, future deploys skip (preserves
// any user changes made in production).
const SEED: Array<{ phone: string; status: string }> = [
  // ── Registered ──────────────────────────────────────────────────────────────
  { phone: "358505761730", status: "registered" },
  { phone: "359879435927", status: "registered" },
  { phone: "359878118333", status: "registered" },
  { phone: "359879097729", status: "registered" },
  { phone: "79654047111",  status: "registered" },
  { phone: "79661162764",  status: "registered" },
  { phone: "79671667675",  status: "registered" },
  { phone: "79770776732",  status: "registered" },
  { phone: "79169720637",  status: "registered" },
  { phone: "923217647504", status: "registered" },
  { phone: "923558880287", status: "registered" },
  { phone: "923553710399", status: "registered" },
  { phone: "923557294967", status: "registered" },
  { phone: "923553404560", status: "registered" },
  { phone: "923558160267", status: "registered" },
  { phone: "923559614942", status: "registered" },
  { phone: "923558147994", status: "registered" },
  { phone: "923558706829", status: "registered" },
  { phone: "923557777247", status: "registered" },
  { phone: "923553168369", status: "registered" },
  { phone: "923559979296", status: "registered" },
  { phone: "923553313535", status: "registered" },
  { phone: "923557950357", status: "registered" },
  { phone: "923559730168", status: "registered" },
  { phone: "923553141750", status: "registered" },
  { phone: "923553438022", status: "registered" },
  { phone: "923552635146", status: "registered" },
  { phone: "923553169365", status: "registered" },
  { phone: "923557536411", status: "registered" },
  { phone: "923552144079", status: "registered" },
  { phone: "923557465507", status: "registered" },
  { phone: "923558693987", status: "registered" },
  { phone: "923553723373", status: "registered" },
  { phone: "923552669602", status: "registered" },
  { phone: "923558767974", status: "registered" },
  { phone: "923552606602", status: "registered" },
  { phone: "923552178817", status: "registered" },
  { phone: "923552994030", status: "registered" },
  { phone: "923553953443", status: "registered" },
  { phone: "923558791624", status: "registered" },
  { phone: "923558184818", status: "registered" },
  { phone: "923557863180", status: "registered" },
  { phone: "923553606555", status: "registered" },
  { phone: "923552644431", status: "registered" },
  { phone: "923553320471", status: "registered" },
  { phone: "923558381884", status: "registered" },
  { phone: "923553389581", status: "registered" },
  { phone: "923553850429", status: "registered" },
  { phone: "923552892077", status: "registered" },
  { phone: "923553667064", status: "registered" },
  { phone: "923558771638", status: "registered" },
  { phone: "923552526664", status: "registered" },
  { phone: "923559837269", status: "registered" },
  { phone: "923559330515", status: "registered" },
  { phone: "923557356213", status: "registered" },
  { phone: "923552054577", status: "registered" },
  { phone: "923553562882", status: "registered" },
  { phone: "923559335919", status: "registered" },
  { phone: "923553144405", status: "registered" },
  { phone: "923554898981", status: "registered" },
  // ── Already Other ────────────────────────────────────────────────────────────
  { phone: "358505761729", status: "already_other" },
  { phone: "420705123999", status: "already_other" },
  { phone: "420725313012", status: "already_other" },
  { phone: "420724545112", status: "already_other" },
  { phone: "420720413401", status: "already_other" },
  { phone: "79168308641",  status: "already_other" },
  { phone: "79168480699",  status: "already_other" },
  { phone: "923559441713", status: "already_other" },
];

export async function runMigrations(): Promise<void> {
  try {
    // 1. Create table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS phone_statuses (
        phone      TEXT        PRIMARY KEY,
        status     TEXT        NOT NULL DEFAULT 'not_tried',
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // 2. Seed initial data — DO NOTHING so production user changes are preserved
    if (SEED.length > 0) {
      const values = SEED.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2}, NOW())`).join(",");
      const params = SEED.flatMap(s => [s.phone, s.status]);
      await pool.query(
        `INSERT INTO phone_statuses (phone, status, updated_at) VALUES ${values}
         ON CONFLICT (phone) DO NOTHING`,
        params
      );
    }

    logger.info({ seeded: SEED.length }, "DB migrations + seed complete");
  } catch (err) {
    logger.error({ err }, "DB migration failed");
  }
}
