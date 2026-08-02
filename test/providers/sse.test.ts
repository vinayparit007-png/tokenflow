import { describe, it, expect } from "vitest";
import { parseSSE } from "../../src/providers/sse.js";

function streamOf(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<string[]> {
  const out: string[] = [];
  for await (const data of parseSSE(stream)) out.push(data);
  return out;
}

describe("parseSSE", () => {
  it("extracts data lines and ignores event/comment lines", async () => {
    const body = "event: message_start\ndata: {\"a\":1}\n\n: comment\ndata: {\"b\":2}\n\n";
    expect(await collect(streamOf(body))).toEqual(['{"a":1}', '{"b":2}']);
  });

  it("handles CRLF line endings", async () => {
    const body = "data: hello\r\n\r\ndata: world\r\n\r\n";
    expect(await collect(streamOf(body))).toEqual(["hello", "world"]);
  });

  it("emits a trailing data line with no final newline", async () => {
    expect(await collect(streamOf("data: last"))).toEqual(["last"]);
  });
});
