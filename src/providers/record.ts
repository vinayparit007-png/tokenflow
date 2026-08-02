import { writeFileSync } from "node:fs";
import type { ProviderName } from "../adapters/index.js";

/** A recorded fixture: raw pre-adaptation events plus the metadata needed to
 * know what they are and when they were captured. */
export interface RecordedFixture {
  provider: ProviderName;
  model: string;
  /** ISO timestamp of capture, so a stale fixture is obvious at a glance. */
  capturedAt: string;
  events: unknown[];
}

/**
 * Collects raw events during a stream (via `StreamOptions.onRawEvent`) and writes
 * them to disk as a date-stamped fixture. This is the mechanism behind the hidden
 * `--record` flag: capture a real stream once, then replay it forever in the
 * offline test suite.
 */
export class FixtureRecorder {
  private readonly events: unknown[] = [];

  constructor(
    private readonly provider: ProviderName,
    private readonly model: string,
  ) {}

  /** Pass this as `onRawEvent`. */
  readonly capture = (event: unknown): void => {
    this.events.push(event);
  };

  /** Serialise the capture to `path` with provider, model, and capture date. */
  save(path: string): RecordedFixture {
    const fixture: RecordedFixture = {
      provider: this.provider,
      model: this.model,
      capturedAt: new Date().toISOString(),
      events: this.events,
    };
    writeFileSync(path, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
    return fixture;
  }
}
