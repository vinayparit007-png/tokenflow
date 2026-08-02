import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

/** One estimate-vs-actual observation for a model's output-token guess. */
export interface DriftEntry {
  at: string;
  model: string;
  estimatedOutputTokens: number;
  actualOutputTokens: number;
  /** actual / estimated; >1 means we under-estimated. Null when estimate was 0. */
  ratio: number | null;
}

/** Default drift log location. */
export function defaultDriftPath(): string {
  return join(homedir(), ".tokenflow", "drift.jsonl");
}

/**
 * Appends estimate-vs-actual drift observations for later calibration of the
 * chars-per-token constant. Writes are injectable so tests don't touch disk; the
 * data is JSONL so it's trivially greppable and appendable without parsing.
 */
export class DriftLogger {
  constructor(private readonly write: (line: string) => void = fileWriter()) {}

  record(model: string, estimatedOutputTokens: number, actualOutputTokens: number): DriftEntry {
    const entry: DriftEntry = {
      at: new Date().toISOString(),
      model,
      estimatedOutputTokens,
      actualOutputTokens,
      ratio: estimatedOutputTokens === 0 ? null : actualOutputTokens / estimatedOutputTokens,
    };
    this.write(`${JSON.stringify(entry)}\n`);
    return entry;
  }
}

/** A writer that appends to the default drift file, creating its dir on demand. */
function fileWriter(): (line: string) => void {
  const path = defaultDriftPath();
  return (line) => {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, line, "utf8");
  };
}
