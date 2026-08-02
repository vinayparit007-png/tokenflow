/**
 * Minimal Server-Sent-Events parser. All three providers stream SSE, so this is
 * the single place that turns a byte stream into `data:` payload strings. We
 * ignore `event:`, `id:`, and comment lines: every provider repeats the event
 * type inside the JSON payload, so the `data:` line is all we need.
 */
export async function* parseSSE(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/, "");
        buffer = buffer.slice(newline + 1);
        if (line.startsWith("data:")) {
          yield line.slice(5).trim();
        }
      }
    }
    // Flush any trailing line without a newline terminator.
    const tail = buffer.replace(/\r$/, "");
    if (tail.startsWith("data:")) yield tail.slice(5).trim();
  } finally {
    reader.releaseLock();
  }
}
