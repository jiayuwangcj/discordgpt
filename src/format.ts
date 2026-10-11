/** Discord limits are UTF-16 units; prefer intact paragraphs and links. */
export function splitReply(text: string, limit = 1900): string[] {
  if (limit < 1) throw new Error("Message limit must be positive");
  const parts: string[] = [];
  let current = "";
  for (const paragraph of text.trim().split(/\n\s*\n/)) {
    if (!paragraph) continue;
    if (paragraph.length <= limit) {
      const combined = current ? `${current}\n\n${paragraph}` : paragraph;
      if (combined.length <= limit) current = combined;
      else { if (current) parts.push(current); current = paragraph; }
      continue;
    }
    if (current) { parts.push(current); current = ""; }
    let rest = paragraph;
    while (rest.length > limit) {
      let cut = limit;
      // Avoid cutting a Markdown link or a bare URL if it fits by itself.
      for (const match of rest.matchAll(/\[[^\]]*\]\([^\s]*\)|https?:\/\/\S+/g)) {
        const start = match.index!;
        if (start < cut && start + match[0].length > cut && start > 0) {
          cut = start; break;
        }
      }
      if (cut === limit) {
        const boundary = Math.max(rest.lastIndexOf("\n", cut), rest.lastIndexOf(" ", cut));
        if (boundary > limit / 2) cut = boundary;
      }
      const code = rest.charCodeAt(cut - 1);
      if (code >= 0xd800 && code <= 0xdbff) cut--;
      if (cut <= 0) throw new Error("Message limit is too small for a Unicode character");
      parts.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trim();
    }
    current = rest;
  }
  if (current) parts.push(current);
  return parts;
}
