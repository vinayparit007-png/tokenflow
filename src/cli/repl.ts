import { createInterface } from "node:readline";
import type { Readable } from "node:stream";
import type { Message } from "../providers/index.js";
import { SessionCost } from "../session.js";
import { resolveModel } from "./config.js";
import { formatCost } from "../format.js";
import { runChat, type CliDeps } from "./run.js";
import { ExitCode } from "./exit.js";
import { paint, banner, themeFor } from "./theme.js";
import type { ChatCommand } from "./args.js";

/**
 * The interactive REPL (`tokenflow` with no prompt in a TTY). Keeps a running
 * message history for multi-turn context and a `SessionCost` so the user sees the
 * cumulative spend of the whole conversation, not just the last turn. Meta
 * commands start with `/`.
 */
export async function runRepl(
  base: ChatCommand,
  deps: CliDeps,
  stdin: Readable = process.stdin,
): Promise<number> {
  const { terminal } = deps;
  const session = new SessionCost(deps.pricing);
  const history: Message[] = [];
  const modelName = base.models[0] ?? deps.config.defaultModel ?? "claude-opus-4-8";

  let resolved;
  try {
    resolved = resolveModel(modelName, deps.config, deps.pricing);
  } catch (error) {
    terminal.err(`${(error as Error).message}\n`);
    return ExitCode.Usage;
  }

  const theme = deps.theme ?? themeFor(undefined);
  const splash = banner(theme, terminal);
  if (splash) terminal.err(`\n${splash}\n`);
  terminal.err(
    terminal.c.dim(`  ${resolved.model} · /help for commands, Ctrl-D to exit\n\n`),
  );

  const rl = createInterface({ input: stdin, output: terminal.isTTY ? process.stdout : undefined, terminal: false });
  const ask = (): Promise<string | null> =>
    new Promise((resolve) => {
      terminal.err(paint("❯ ", theme.accent, terminal, true));
      rl.once("line", (line) => resolve(line));
      rl.once("close", () => resolve(null));
    });

  for (;;) {
    const line = await ask();
    if (line === null) break;
    const trimmed = line.trim();
    if (trimmed === "") continue;

    if (trimmed.startsWith("/")) {
      if (trimmed === "/exit" || trimmed === "/quit") break;
      if (trimmed === "/reset") {
        history.length = 0;
        terminal.err(terminal.c.dim("(history cleared)\n"));
        continue;
      }
      if (trimmed === "/cost") {
        terminal.err(`${paint(`session total: ${formatCost(session.total())}`, theme.accent, terminal, true)}\n`);
        continue;
      }
      if (trimmed === "/help") {
        terminal.err(terminal.c.dim("commands: /reset  /cost  /exit\n"));
        continue;
      }
      terminal.err(terminal.c.yellow(`unknown command: ${trimmed}\n`));
      continue;
    }

    const turnCmd: ChatCommand = { ...base, prompt: trimmed };
    await runChat(turnCmd, {
      ...deps,
      history: [...history],
      stdinText: undefined,
      onTurn: (turn) => {
        history.push({ role: "user", content: trimmed });
        history.push({ role: "assistant", content: turn.responseText });
        session.record(turn.provider, turn.model, turn.usage);
      },
    });
    terminal.err(`${paint(`  session total: ${formatCost(session.total())}`, theme.accent, terminal)}\n\n`);
  }

  rl.close();
  terminal.err(terminal.c.dim(`\nsession total: ${formatCost(session.total())}\n`));
  return ExitCode.Success;
}
