/**
 * Meaningful exit codes so TokenFlow composes in scripts: a caller can tell a
 * usage mistake from a provider outage from a user cancellation without parsing
 * stderr.
 */
export const ExitCode = {
  /** Completed successfully. */
  Success: 0,
  /** Unexpected internal error. */
  Failure: 1,
  /** Bad command-line usage (unknown flag, missing prompt). */
  Usage: 2,
  /** Provider/API error (bad key, model not found, upstream failure). */
  Provider: 3,
  /** The user cancelled (Ctrl-C / SIGINT). */
  Cancelled: 4,
  /** Invalid configuration file. */
  Config: 5,
} as const;

export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];
