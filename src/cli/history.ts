import type { Terminal } from "./tty.js";
import type { LogCommand, CostCommand } from "./args.js";
import { ExitCode } from "./exit.js";
import { formatCost } from "../format.js";
import { renderTable, type Column } from "./table.js";
import { HistoryStore, type SessionSummary, type TurnMatch } from "../history/store.js";
import { parseSince, byModel, byDay, total, type CostBucket } from "../history/report.js";

/** Dependencies for the history commands (`log`, `cost`). Store is injectable
 * so tests use an in-memory database. */
export interface HistoryDeps {
  terminal: Terminal;
  store: HistoryStore;
  now?: () => Date;
}

/** Dispatch `log` / `cost` to their handlers. */
export function dispatchHistory(command: LogCommand | CostCommand, deps: HistoryDeps): number {
  return command.kind === "log" ? runLog(command, deps) : runCost(command, deps);
}

/** `tokenflow log` (list) and `tokenflow log search <query>`. */
export function runLog(command: LogCommand, deps: HistoryDeps): number {
  const { terminal, store } = deps;
  if (command.query) {
    const matches = store.search(command.query, command.limit ?? 20);
    if (matches.length === 0) {
      terminal.out(`No turns matching "${command.query}".\n`);
      return ExitCode.Success;
    }
    terminal.out(`${renderTable(matches, searchColumns(terminal), terminal)}\n`);
    return ExitCode.Success;
  }

  const sessions = store.listSessions(command.limit ?? 20);
  if (sessions.length === 0) {
    terminal.out("No sessions recorded yet. Run a prompt to start one.\n");
    return ExitCode.Success;
  }
  terminal.out(`${renderTable(sessions, sessionColumns(terminal), terminal)}\n`);
  return ExitCode.Success;
}

/** `tokenflow cost --since 7d` — spend grouped by model and by day. */
export function runCost(command: CostCommand, deps: HistoryDeps): number {
  const { terminal, store } = deps;
  let since: Date;
  try {
    since = parseSince(command.since ?? "30d", deps.now?.());
  } catch (error) {
    terminal.err(`${(error as Error).message}\n`);
    return ExitCode.Usage;
  }

  const rows = store.turnsSince(since);
  if (rows.length === 0) {
    terminal.out(`No turns since ${since.toISOString().slice(0, 10)}.\n`);
    return ExitCode.Success;
  }

  terminal.out(`Spend since ${since.toISOString().slice(0, 10)} (${rows.length} turns)\n\n`);
  terminal.out(`${terminal.c.bold("By model")}\n`);
  terminal.out(`${renderTable(byModel(rows), bucketColumns("MODEL", terminal), terminal)}\n\n`);
  terminal.out(`${terminal.c.bold("By day")}\n`);
  terminal.out(`${renderTable(byDay(rows), bucketColumns("DAY", terminal), terminal)}\n\n`);
  terminal.out(`${terminal.c.bold(`Total: ${formatCost(total(rows))}`)}\n`);
  return ExitCode.Success;
}

function sessionColumns(_t: Terminal): Column<SessionSummary>[] {
  return [
    { header: "ID", right: true, cell: (s) => String(s.id) },
    { header: "STARTED", cell: (s) => s.startedAt.slice(0, 16).replace("T", " ") },
    { header: "TURNS", right: true, cell: (s) => String(s.turns) },
    { header: "COST", right: true, cell: (s) => formatCost(s.cost) },
    { header: "FIRST PROMPT", cell: (s) => truncate(s.firstPrompt, 50) },
  ];
}

function searchColumns(_t: Terminal): Column<TurnMatch>[] {
  return [
    { header: "WHEN", cell: (m) => m.createdAt.slice(0, 16).replace("T", " ") },
    { header: "MODEL", cell: (m) => m.model },
    { header: "PROMPT", cell: (m) => truncate(m.prompt, 40) },
    { header: "RESPONSE", cell: (m) => truncate(m.response, 40) },
  ];
}

function bucketColumns(keyHeader: string, _t: Terminal): Column<CostBucket>[] {
  return [
    { header: keyHeader, cell: (b) => b.key },
    { header: "TURNS", right: true, cell: (b) => String(b.turns) },
    { header: "COST", right: true, cell: (b) => formatCost(b.cost) },
  ];
}

/** Collapse whitespace and clip to `max` chars with an ellipsis. */
function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}
