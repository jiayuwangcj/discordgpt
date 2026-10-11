import fs from "node:fs/promises";
import path from "node:path";

export function validAlias(value: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,31}$/.test(value) && !["new", "list"].includes(value.toLowerCase());
}

/** Workspace paths are host configuration, never paths supplied through chat. */
export async function loadWorkspaces(projectDir: string, file?: string): Promise<Record<string, string>> {
  const result: Record<string, string> = Object.create(null);
  result.default = projectDir;
  if (file) {
    const entries: unknown = JSON.parse(await fs.readFile(file, "utf8"));
    if (!entries || typeof entries !== "object" || Array.isArray(entries)) throw new Error("Workspace config must be an alias/path object");
    for (const [alias, directory] of Object.entries(entries)) {
      if (!validAlias(alias) || alias === "__proto__" || typeof directory !== "string" || !path.isAbsolute(directory)) {
        throw new Error(`Invalid workspace: ${alias}`);
      }
      if (alias === "default" && directory !== projectDir) throw new Error("default workspace must match CODEX_PROJECT_DIR");
      result[alias] = directory;
    }
  }
  for (const directory of Object.values(result)) {
    if (!(await fs.stat(directory)).isDirectory()) throw new Error("Workspace is not a directory");
  }
  return result;
}
