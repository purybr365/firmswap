import Database from "better-sqlite3";
import { config } from "./config.js";

/**
 * Create and initialize a SQLite database for the solver registry.
 *
 * @param dbPath - Path to the SQLite file, or ":memory:" for tests. Defaults to config.dbPath.
 */
export function createDatabase(dbPath?: string): Database.Database {
  const db = new Database(dbPath ?? config.dbPath);

  // WAL mode for better concurrent read performance
  db.pragma("journal_mode = WAL");

  // Check if old schema exists (no chain_id column) and migrate
  const tableInfo = db.pragma("table_info(solvers)") as Array<{ name: string }>;
  const hasChainId = tableInfo.some((col) => col.name === "chain_id");

  if (tableInfo.length > 0 && !hasChainId) {
    // Migrate: add chain_id column with composite PK
    const defaultChainId = config.chains[0].chainId;
    db.exec(`
      ALTER TABLE solvers RENAME TO solvers_old;
      CREATE TABLE solvers (
        address       TEXT NOT NULL,
        chain_id      INTEGER NOT NULL,
        endpoint_url  TEXT NOT NULL,
        name          TEXT NOT NULL,
        registered_at INTEGER NOT NULL,
        active        INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY (address, chain_id)
      );
      INSERT INTO solvers (address, chain_id, endpoint_url, name, registered_at, active)
        SELECT address, ${defaultChainId}, endpoint_url, name, registered_at, active FROM solvers_old;
      DROP TABLE solvers_old;
    `);
  } else if (tableInfo.length === 0) {
    // Fresh database
    db.exec(`
      CREATE TABLE IF NOT EXISTS solvers (
        address       TEXT NOT NULL,
        chain_id      INTEGER NOT NULL,
        endpoint_url  TEXT NOT NULL,
        name          TEXT NOT NULL,
        registered_at INTEGER NOT NULL,
        active        INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY (address, chain_id)
      )
    `);
  }

  return db;
}
