import type { PricingTable } from "../pricing/loader.js";
import type { Config } from "./config.js";
import type { Terminal } from "./tty.js";
import type { LogCommand, CostCommand } from "./args.js";
import { ExitCode } from "./exit.js";

/** Dependencies for the history commands (`log`, `cost`). */
export interface HistoryDeps {
  pricing: PricingTable;
  config: Config;
  terminal: Terminal;
}

/**
 * Dispatch `log` / `cost`. The SQLite-backed implementation lands in Phase 5;
 * until then these commands explain that history is not yet recorded rather than
 * failing with a stack trace.
 */
export function dispatchHistory(command: LogCommand | CostCommand, deps: HistoryDeps): number {
  deps.terminal.err(
    deps.terminal.c.yellow(
      `\`tokenflow ${command.kind}\` needs the history store (Phase 5), which isn't enabled yet.\n`,
    ),
  );
  return ExitCode.Success;
}
