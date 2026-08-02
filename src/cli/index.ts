#!/usr/bin/env node
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import type { Readable } from "node:stream";
import { loadPricing } from "../pricing/loader.js";
import { providers } from "../providers/index.js";
import { parseArgs } from "./args.js";
import { loadConfig } from "./config.js";
import { terminalFromProcess, type Terminal } from "./tty.js";
import { runChat, type CliDeps } from "./run.js";
import { runFanout } from "./fanout.js";
import { runRepl } from "./repl.js";
import { HELP_TEXT } from "./help.js";
import { ExitCode } from "./exit.js";

/** Read all of stdin when it's piped; return "" when it's an interactive TTY. */
async function readStdin(stdin: Readable & { isTTY?: boolean }): Promise<string> {
  if (stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function version(): string {
  try {
    const require = createRequire(import.meta.url);
    return (require("../../package.json") as { version: string }).version;
  } catch {
    return "0.0.0";
  }
}

/**
 * The CLI entry point, parameterised on argv so it can be driven from a test.
 * Returns a process exit code rather than calling `process.exit`, so nothing
 * short-circuits the harness.
 */
export async function main(argv: string[]): Promise<number> {
  const command = parseArgs(argv);

  if (command.kind === "help") {
    process.stdout.write(HELP_TEXT);
    return ExitCode.Success;
  }
  if (command.kind === "version") {
    process.stdout.write(`${version()}\n`);
    return ExitCode.Success;
  }
  if (command.kind === "error") {
    process.stderr.write(`${command.message}\nRun \`tokenflow --help\` for usage.\n`);
    return ExitCode.Usage;
  }

  // Build the terminal chokepoint, honouring --color/--no-color.
  const colorOverride =
    command.kind === "chat" && command.color !== undefined
      ? command.color
        ? { forceColor: true }
        : { forceColor: false }
      : {};
  const terminal: Terminal = terminalFromProcess(colorOverride);

  let config;
  try {
    config = loadConfig();
  } catch (error) {
    terminal.err(`${(error as Error).message}\n`);
    return ExitCode.Config;
  }
  const pricing = loadPricing();

  if (command.kind === "log" || command.kind === "cost") {
    // Wired to the history store in Phase 5.
    const { dispatchHistory } = await import("./history.js");
    return dispatchHistory(command, { pricing, config, terminal });
  }

  // chat
  const controller = new AbortController();
  const onSigint = () => controller.abort();
  process.on("SIGINT", onSigint);

  const stdinText = await readStdin(process.stdin);
  const deps: CliDeps = {
    providers,
    pricing,
    config,
    terminal,
    env: process.env,
    signal: controller.signal,
    stdinText,
  };

  try {
    const hasPrompt = Boolean(command.prompt) || stdinText.trim() !== "";
    if (hasPrompt) {
      return command.models.length > 1 ? await runFanout(command, deps) : await runChat(command, deps);
    }
    if (process.stdin.isTTY) return await runRepl(command, deps);
    terminal.err("No prompt given and stdin is empty. Run `tokenflow --help`.\n");
    return ExitCode.Usage;
  } finally {
    process.off("SIGINT", onSigint);
  }
}

// Bootstrap when run as the binary. `pathToFileURL` handles Windows backslash
// paths, which a naive `file://${argv[1]}` comparison gets wrong.
const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      process.stderr.write(`${(error as Error).stack ?? String(error)}\n`);
      process.exitCode = ExitCode.Failure;
    });
}
