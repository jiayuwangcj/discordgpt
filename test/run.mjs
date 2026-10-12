// Run in one process for Node 20+ compatibility and restricted test environments.
import fs from "node:fs/promises";
const files = (await fs.readdir(new URL(".", import.meta.url))).filter((file) => file.endsWith(".test.mjs")).sort();
for (const file of files) await import(new URL(file, import.meta.url));
