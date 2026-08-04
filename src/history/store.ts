import type { DatabaseSync as DatabaseSyncInstance } from "node:sqlite";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import type { Usage } from "../usage.js";
import type { Message } from "../providers/index.js";

/**
 * NOTE ON THE DEPENDENCY: the brief specifies `better-sqlite3`. We use Node's
 * built-in `node:sqlite` (DatabaseSync) instead — it provides the same
 * synchronous API and bundles FTS5, but needs no native compilation, which is the
 * failure mode `better-sqlite3` hits on brand-new Node versions. If you prefer
 * the original, this module is the only place that touches the driver.
 *
 * `node:sqlite` is loaded via createRequire rather than a static import so that
 * bundlers/test runners (Vite/vitest) that don't yet recognise this new built-in
 * defer resolution to Node at runtime instead of trying to bundle "sqlite".
 */

/** Silence the one-time "SQLite is an experimental" warning so it never pollutes
 * the cost channel; we knowingly accept the experimental built-in. Installed
 * BEFORE requiring the driver, since the warning fires at load time. */
function suppressSqliteWarning(): void {
  const original = process.emitWarning.bind(process);
  process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
    const text = typeof warning === "string" ? warning : warning?.message;
    if (text && text.includes("SQLite is an experimental")) return;
    return (original as (...a: unknown[]) => void)(warning, ...rest);
  }) as typeof process.emitWarning;
}

suppressSqliteWarning();
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");

/** A turn as stored/returned by the history layer. `provider` is a display
 * label — a built-in name or a custom lab's name from `config.customProviders`. */
export interface StoredTurn {
  provider: string;
  model: string;
  prompt: string;
  response: string;
  system?: string;
  usage: Usage;
  cost: bigint | null;
  latencyMs: number | null;
  ttftMs: number | null;
}

export interface SessionSummary {
  id: number;
  startedAt: string;
  turns: number;
  firstPrompt: string;
  cost: bigint | null;
}

export interface TurnMatch {
  sessionId: number;
  createdAt: string;
  model: string;
  prompt: string;
  response: string;
}

export interface TurnCostRow {
  createdAt: string;
  model: string;
  cost: bigint | null;
}

/** Default database location. */
export function defaultDbPath(): string {
  return join(homedir(), ".tokenflow", "history.db");
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  id         INTEGER PRIMARY KEY,
  started_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS turns (
  id           INTEGER PRIMARY KEY,
  session_id   INTEGER NOT NULL REFERENCES sessions(id),
  created_at   TEXT NOT NULL,
  provider     TEXT NOT NULL,
  model        TEXT NOT NULL,
  prompt       TEXT NOT NULL,
  response     TEXT NOT NULL,
  system       TEXT,
  input        INTEGER NOT NULL,
  output       INTEGER NOT NULL,
  cache_write  INTEGER NOT NULL,
  cache_read   INTEGER NOT NULL,
  reasoning    INTEGER NOT NULL,
  cost_nano    TEXT,            -- bigint as string; NULL when the model is unpriced
  latency_ms   INTEGER,
  ttft_ms      INTEGER
);
CREATE INDEX IF NOT EXISTS turns_by_session ON turns(session_id);
CREATE INDEX IF NOT EXISTS turns_by_time ON turns(created_at);
CREATE VIRTUAL TABLE IF NOT EXISTS turns_fts USING fts5(
  prompt, response, content='turns', content_rowid='id'
);
CREATE TRIGGER IF NOT EXISTS turns_ai AFTER INSERT ON turns BEGIN
  INSERT INTO turns_fts(rowid, prompt, response) VALUES (new.id, new.prompt, new.response);
END;
`;

/**
 * SQLite-backed history: sessions, turns, usage, cost, latency, and a full-text
 * index over prompts and responses. Costs are stored as decimal strings, not
 * INTEGERs, so a bigint nanodollar value never loses precision through the
 * driver, and aggregation happens in JS where null propagation (decision 3) is
 * explicit rather than SQL's silent NULL-skipping SUM.
 */
export class HistoryStore {
  private readonly db: DatabaseSyncInstance;

  constructor(path: string = defaultDbPath()) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(SCHEMA);
  }

  /** Begin a new session, returning its id. */
  startSession(now: Date = new Date()): number {
    const info = this.db.prepare("INSERT INTO sessions (started_at) VALUES (?)").run(now.toISOString());
    return Number(info.lastInsertRowid);
  }

  /** The most recent session id, or null if there are none (for `--continue`). */
  lastSessionId(): number | null {
    const row = this.db.prepare("SELECT id FROM sessions ORDER BY id DESC LIMIT 1").get() as unknown as
      | { id: number }
      | undefined;
    return row ? row.id : null;
  }

  /** Record one completed turn against a session. */
  recordTurn(sessionId: number, turn: StoredTurn, now: Date = new Date()): void {
    this.db
      .prepare(
        `INSERT INTO turns
         (session_id, created_at, provider, model, prompt, response, system,
          input, output, cache_write, cache_read, reasoning, cost_nano, latency_ms, ttft_ms)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        sessionId,
        now.toISOString(),
        turn.provider,
        turn.model,
        turn.prompt,
        turn.response,
        turn.system ?? null,
        turn.usage.input,
        turn.usage.output,
        turn.usage.cacheWrite,
        turn.usage.cacheRead,
        turn.usage.reasoning,
        turn.cost === null ? null : turn.cost.toString(),
        turn.latencyMs,
        turn.ttftMs,
      );
  }

  /** Reconstruct a session's messages (user/assistant pairs) for `--continue`. */
  sessionMessages(sessionId: number): Message[] {
    const rows = this.db
      .prepare("SELECT prompt, response FROM turns WHERE session_id = ? ORDER BY id")
      .all(sessionId) as unknown as Array<{ prompt: string; response: string }>;
    const messages: Message[] = [];
    for (const row of rows) {
      messages.push({ role: "user", content: row.prompt });
      messages.push({ role: "assistant", content: row.response });
    }
    return messages;
  }

  /** List recent sessions, newest first, with a cost total per session. */
  listSessions(limit = 20): SessionSummary[] {
    const rows = this.db
      .prepare(
        `SELECT s.id AS id, s.started_at AS startedAt,
                (SELECT COUNT(*) FROM turns t WHERE t.session_id = s.id) AS turns,
                (SELECT prompt FROM turns t WHERE t.session_id = s.id ORDER BY t.id LIMIT 1) AS firstPrompt
         FROM sessions s ORDER BY s.id DESC LIMIT ?`,
      )
      .all(limit) as unknown as Array<{ id: number; startedAt: string; turns: number; firstPrompt: string | null }>;

    return rows.map((row) => ({
      id: row.id,
      startedAt: row.startedAt,
      turns: row.turns,
      firstPrompt: row.firstPrompt ?? "(empty)",
      cost: this.sessionCost(row.id),
    }));
  }

  /** Sum a session's cost with null propagation. */
  private sessionCost(sessionId: number): bigint | null {
    const rows = this.db
      .prepare("SELECT cost_nano FROM turns WHERE session_id = ?")
      .all(sessionId) as unknown as Array<{ cost_nano: string | null }>;
    let sum = 0n;
    for (const row of rows) {
      if (row.cost_nano === null) return null; // one unpriced turn -> unknown total
      sum += BigInt(row.cost_nano);
    }
    return sum;
  }

  /** Full-text search over prompts and responses, most relevant first. */
  search(query: string, limit = 20): TurnMatch[] {
    const match = sanitizeFtsQuery(query);
    if (match === "") return [];
    const rows = this.db
      .prepare(
        `SELECT t.session_id AS sessionId, t.created_at AS createdAt, t.model AS model,
                t.prompt AS prompt, t.response AS response
         FROM turns_fts f JOIN turns t ON t.id = f.rowid
         WHERE turns_fts MATCH ? ORDER BY bm25(turns_fts) LIMIT ?`,
      )
      .all(match, limit) as unknown as TurnMatch[];
    return rows;
  }

  /** Every turn's cost/model/time on or after `since`, for the spend report. */
  turnsSince(since: Date): TurnCostRow[] {
    const rows = this.db
      .prepare(
        "SELECT created_at AS createdAt, model, cost_nano FROM turns WHERE created_at >= ? ORDER BY created_at",
      )
      .all(since.toISOString()) as unknown as Array<{ createdAt: string; model: string; cost_nano: string | null }>;
    return rows.map((row) => ({
      createdAt: row.createdAt,
      model: row.model,
      cost: row.cost_nano === null ? null : BigInt(row.cost_nano),
    }));
  }

  close(): void {
    this.db.close();
  }
}

/**
 * Turn a free-text query into a safe FTS5 MATCH expression. User text can contain
 * FTS operators that would raise a syntax error; we quote each token so the query
 * is treated as an AND of literal terms, which is what a person typing words
 * expects.
 */
export function sanitizeFtsQuery(query: string): string {
  return query
    .split(/\s+/)
    .map((token) => token.replace(/"/g, "").trim())
    .filter(Boolean)
    .map((token) => `"${token}"`)
    .join(" ");
}
