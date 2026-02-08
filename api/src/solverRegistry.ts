import type Database from "better-sqlite3";
import type { Address } from "viem";
import type { ChainContext } from "./chain.js";
import { firmSwapAbi } from "./chain.js";
import type { RegisteredSolver } from "./types.js";

interface SolverRow {
  address: string;
  chain_id: number;
  endpoint_url: string;
  name: string;
  registered_at: number;
  active: number;
}

/**
 * SQLite-backed solver registry, scoped per chain.
 * Solvers register via the API with their quote endpoint URL.
 * The registry verifies they have sufficient on-chain bond.
 * Data persists across server restarts.
 */
export class SolverRegistry {
  private stmtUpsert: Database.Statement;
  private stmtDelete: Database.Statement;
  private stmtGet: Database.Statement;
  private stmtGetActive: Database.Statement;
  private stmtSetActive: Database.Statement;
  private stmtCountActive: Database.Statement;

  constructor(
    private db: Database.Database,
    private chainCtx: ChainContext,
    private minSolverBond: bigint,
    private maxSolvers: number = 50,
  ) {
    this.stmtUpsert = db.prepare(
      `INSERT INTO solvers (address, chain_id, endpoint_url, name, registered_at, active)
       VALUES (?, ?, ?, ?, ?, 1)
       ON CONFLICT(address, chain_id) DO UPDATE SET endpoint_url = excluded.endpoint_url, name = excluded.name, active = 1`,
    );
    this.stmtDelete = db.prepare(`DELETE FROM solvers WHERE address = ? AND chain_id = ?`);
    this.stmtGet = db.prepare(`SELECT * FROM solvers WHERE address = ? AND chain_id = ?`);
    this.stmtGetActive = db.prepare(`SELECT * FROM solvers WHERE active = 1 AND chain_id = ?`);
    this.stmtSetActive = db.prepare(`UPDATE solvers SET active = ? WHERE address = ? AND chain_id = ?`);
    this.stmtCountActive = db.prepare(`SELECT COUNT(*) as count FROM solvers WHERE active = 1 AND chain_id = ?`);
  }

  async register(
    address: Address,
    endpointUrl: string,
    name: string,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const normalized = address.toLowerCase();

    // Check solver cap (skip for existing solvers updating their endpoint)
    const existing = this.stmtGet.get(normalized, this.chainCtx.chainId) as SolverRow | undefined;
    if (!existing) {
      const { count } = this.stmtCountActive.get(this.chainCtx.chainId) as { count: number };
      if (count >= this.maxSolvers) {
        return { ok: false, error: `Maximum solver limit (${this.maxSolvers}) reached for this chain` };
      }
    }

    // Verify on-chain bond
    if (this.chainCtx.firmSwapAddress) {
      const bondOk = await this.verifyBond(address);
      if (!bondOk) {
        return { ok: false, error: "Solver does not have sufficient on-chain bond" };
      }
    }

    this.stmtUpsert.run(normalized, this.chainCtx.chainId, endpointUrl, name, Date.now());
    return { ok: true };
  }

  unregister(address: Address): boolean {
    const result = this.stmtDelete.run(address.toLowerCase(), this.chainCtx.chainId);
    return result.changes > 0;
  }

  getSolver(address: Address): RegisteredSolver | undefined {
    const row = this.stmtGet.get(address.toLowerCase(), this.chainCtx.chainId) as SolverRow | undefined;
    return row ? this.rowToSolver(row) : undefined;
  }

  getActiveSolvers(): RegisteredSolver[] {
    const rows = this.stmtGetActive.all(this.chainCtx.chainId) as SolverRow[];
    return rows.map((row) => this.rowToSolver(row));
  }

  setSolverActive(address: Address, active: boolean): void {
    this.stmtSetActive.run(active ? 1 : 0, address.toLowerCase(), this.chainCtx.chainId);
  }

  private rowToSolver(row: SolverRow): RegisteredSolver {
    return {
      address: row.address as `0x${string}`,
      endpointUrl: row.endpoint_url,
      name: row.name,
      registeredAt: row.registered_at,
      active: row.active === 1,
    };
  }

  private async verifyBond(address: Address): Promise<boolean> {
    try {
      const result = await this.chainCtx.publicClient.readContract({
        address: this.chainCtx.firmSwapAddress!,
        abi: firmSwapAbi,
        functionName: "solvers",
        args: [address],
      });

      // solvers() returns (totalBond, reservedBond, unstakeAmount, unstakeTimestamp, registered)
      const [totalBond, , , , registered] = result as [bigint, bigint, bigint, bigint, boolean];
      return registered && totalBond >= this.minSolverBond;
    } catch {
      return false;
    }
  }
}
