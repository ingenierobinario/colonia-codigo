// Read all of stdin as UTF-8. Chunks are joined as bytes first: decoding each chunk alone would corrupt a
// multibyte character split across two chunks ("ñ", "€", emoji…).
export async function readStdin(
  input: AsyncIterable<Buffer | string> = process.stdin,
  maxBytes = Number.POSITIVE_INFINITY,
): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of input) {
    const buf = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
    size += buf.length;
    if (size > maxBytes) throw new Error(`stdin exceeds ${maxBytes} bytes`);
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString("utf8");
}
