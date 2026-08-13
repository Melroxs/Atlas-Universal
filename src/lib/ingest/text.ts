const CHUNK_SIZE = 1400;
const CHUNK_OVERLAP = 180;

/** Split text into overlapping semantic-ish chunks on paragraph/sentence boundaries. */
export function chunkText(text: string): string[] {
  const cleaned = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!cleaned) return [];

  const paragraphs = cleaned.split(/\n\s*\n/);
  const chunks: string[] = [];
  let current = "";

  const push = (s: string) => {
    const t = s.trim();
    if (t) chunks.push(t);
  };

  for (const para of paragraphs) {
    const candidate = current ? `${current}\n\n${para}` : para;
    if (candidate.length <= CHUNK_SIZE) {
      current = candidate;
      continue;
    }
    if (current) push(current);
    // Long paragraph: split on sentences, keep overlap with previous tail.
    const sentences = para.match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g) ?? [para];
    let buf = "";
    for (const sentence of sentences) {
      if (buf && buf.length + sentence.length > CHUNK_SIZE) {
        push(buf);
        buf = buf.slice(-CHUNK_OVERLAP) + " " + sentence;
      } else {
        buf = buf ? `${buf} ${sentence}` : sentence;
      }
    }
    if (buf) {
      if (current && current.length + buf.length <= CHUNK_SIZE + 100) {
        current = `${current}\n\n${buf}`;
      } else {
        push(current);
        current = buf;
      }
    }
  }
  if (current) push(current);

  return chunks;
}

export const truncate = (s: string, n = 300) =>
  s.length <= n ? s : `${s.slice(0, n).trimEnd()}…`;

export const summarize = (s: string, n = 320) =>
  truncate(s.replace(/\s+/g, " ").trim(), n);
