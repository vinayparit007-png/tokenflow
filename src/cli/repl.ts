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
 *
 * EXIT KEYS: `Ctrl-D` is a POSIX "end of input" convention that Windows
 * terminals do not send at all (Windows uses Ctrl-Z + Enter instead), so the
 * startup hint only promises it where it actually works. `Ctrl-C` is made to
 * exit the REPL when idle at the prompt — without this, index.ts's global SIGINT
 * handler (which exists to cancel an in-flight request) swallows Ctrl-C into a
 * no-op the moment nothing is streaming, which reads as the whole program having
 * frozen. `/exit` always works everywhere and is listed first.
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
  const exitHint = process.platform === "win32" ? "/exit or Ctrl-C" : "/exit, Ctrl-D, or Ctrl-C";
  terminal.err(terminal.c.dim(`  ${resolved.model} · type ${exitHint} to leave · /help for commands\n\n`));

  const rl = createInterface({ input: stdin, output: terminal.isTTY ? process.stdout : undefined, terminal: false });
  const ask = (): Promise<string | null> =>
    new Promise((resolve) => {
      terminal.err(paint("❯ ", theme.accent, terminal, true));
      rl.once("line", (line) => resolve(line));
      rl.once("close", () => resolve(null));
    });

  // Own SIGINT locally rather than relying on index.ts's global handler: that
  // one only ever aborts a single shared controller, which would stay
  // permanently "tripped" after the first cancel and silently kill every later
  // turn in this same REPL session. A fresh AbortController per turn avoids
  // that, and this handler additionally exits the REPL on an idle Ctrl-C
  // (nothing streaming) instead of swallowing it into a no-op.
  let turnController: AbortController | null = null;
  const onSigint = () => {
    if (turnController) {
      turnController.abort();
    } else {
      terminal.err(terminal.c.dim("\n(exiting)\n"));
      rl.close();
    }
  };
  process.on("SIGINT", onSigint);

  try {
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
          terminal.err(terminal.c.dim(`commands: /reset  /cost  /exit  (or Ctrl-C)\n`));
          continue;
        }
        terminal.err(terminal.c.yellow(`unknown command: ${trimmed}\n`));
        continue;
      }

      const turnCmd: ChatCommand = { ...base, prompt: trimmed };
      turnController = new AbortController();
      await runChat(turnCmd, {
        ...deps,
        signal: turnController.signal,
        history: [...history],
        stdinText: undefined,
        onTurn: (turn) => {
          history.push({ role: "user", content: trimmed });
          history.push({ role: "assistant", content: turn.responseText });
          session.record(turn.provider, turn.model, turn.usage);
        },
      });
      turnController = null;
      terminal.err(`${paint(`  session total: ${formatCost(session.total())}`, theme.accent, terminal)}\n\n`);
    }
  } finally {
    process.off("SIGINT", onSigint);
  }

  rl.close();
  terminal.err(terminal.c.dim(`\nsession total: ${formatCost(session.total())}\n`));
  return ExitCode.Success;
}
