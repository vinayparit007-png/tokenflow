/**
 * A tiny hand-rolled argument parser. We avoid a dependency here because the
 * surface is small and the behaviour (comma-split models, `--` passthrough,
 * hidden `--record`) is specific enough that a generic parser would need as much
 * configuration as this is code.
 */

/** A chat invocation: one-shot if `prompt` is set, otherwise a REPL in a TTY. */
export interface ChatCommand {
  kind: "chat";
  prompt?: string;
  /** Model names/aliases from `-m/--model`; empty means "use the default". */
  models: string[];
  system?: string;
  stream: boolean;
  json: boolean;
  record?: string;
  maxTokens?: number;
  continueSession: boolean;
  color?: boolean;
  theme?: string;
}

export interface LogCommand {
  kind: "log";
  query?: string;
  limit?: number;
}

export interface CostCommand {
  kind: "cost";
  since?: string;
}

export interface ParseError {
  kind: "error";
  message: string;
}

export type ParsedCommand =
  | ChatCommand
  | LogCommand
  | CostCommand
  | { kind: "help" }
  | { kind: "version" }
  | ParseError;

/** Flags that take a value. */
const VALUE_FLAGS = new Set(["--model", "-m", "--system", "-s", "--record", "--max-tokens", "--since", "--limit", "--theme"]);

/**
 * Parse argv (without `node` and script path). Returns a discriminated command;
 * a `{ kind: "error" }` result carries an actionable message and maps to exit
 * code 2 (usage) upstream.
 */
export function parseArgs(argv: string[]): ParsedCommand {
  // Subcommands come first and are not chat.
  if (argv[0] === "log") return parseLog(argv.slice(1));
  if (argv[0] === "cost") return parseCost(argv.slice(1));
  if (argv[0] === "help" || argv.includes("--help") || argv.includes("-h")) return { kind: "help" };
  if (argv[0] === "version" || argv.includes("--version") || argv.includes("-v")) return { kind: "version" };

  const chat: ChatCommand = {
    kind: "chat",
    models: [],
    stream: true,
    json: false,
    continueSession: false,
  };
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "--") {
      positional.push(...argv.slice(i + 1));
      break;
    }
    if (VALUE_FLAGS.has(arg)) {
      const value = argv[i + 1];
      if (value === undefined) return { kind: "error", message: `${arg} requires a value.` };
      i += 1;
      switch (arg) {
        case "--model":
        case "-m":
          chat.models.push(...value.split(",").map((s) => s.trim()).filter(Boolean));
          break;
        case "--system":
        case "-s":
          chat.system = value;
          break;
        case "--record":
          chat.record = value;
          break;
        case "--theme":
          chat.theme = value;
          break;
        case "--max-tokens": {
          const n = Number(value);
          if (!Number.isInteger(n) || n <= 0) return { kind: "error", message: `--max-tokens must be a positive integer.` };
          chat.maxTokens = n;
          break;
        }
      }
      continue;
    }
    switch (arg) {
      case "--no-stream":
        chat.stream = false;
        break;
      case "--json":
        chat.json = true;
        break;
      case "--continue":
        chat.continueSession = true;
        break;
      case "--color":
        chat.color = true;
        break;
      case "--no-color":
        chat.color = false;
        break;
      default:
        if (arg.startsWith("-")) return { kind: "error", message: `Unknown flag: ${arg}` };
        positional.push(arg);
    }
  }

  if (positional.length > 0) chat.prompt = positional.join(" ");
  return chat;
}

function parseLog(argv: string[]): LogCommand | ParseError {
  const cmd: LogCommand = { kind: "log" };
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "--limit") {
      const n = Number(argv[++i]);
      if (!Number.isInteger(n) || n <= 0) return { kind: "error", message: "--limit must be a positive integer." };
      cmd.limit = n;
    } else if (arg === "search") {
      cmd.query = argv.slice(i + 1).join(" ");
      break;
    } else {
      positional.push(arg);
    }
  }
  if (cmd.query === undefined && positional.length > 0) cmd.query = positional.join(" ");
  return cmd;
}

function parseCost(argv: string[]): CostCommand | ParseError {
  let since: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--since") {
      const value = argv[++i];
      if (value === undefined) return { kind: "error", message: "--since requires a value (e.g. 7d)." };
      since = value;
    }
  }
  return since !== undefined ? { kind: "cost", since } : { kind: "cost" };
}
