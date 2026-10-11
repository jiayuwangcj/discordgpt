import { StateStore, WorkspaceBinding } from "./state.js";

export function resolveWorkspace(state: StateStore, channelId: string, isThread: boolean,
  workspaces: Record<string, string>): WorkspaceBinding {
  const binding = state.binding(channelId);
  if (!binding) {
    if (isThread) throw new Error("This Discord topic has no workspace binding");
    return { workspace: "default", cwd: workspaces.default };
  }
  // Fail closed on removed/moved host configuration rather than quietly changing cwd.
  if (!Object.hasOwn(workspaces, binding.workspace) || workspaces[binding.workspace] !== binding.cwd) {
    throw new Error("Workspace configuration changed; restore it or create a new topic");
  }
  return binding;
}

export function topicRequest(prompt: string): { workspace: string; name: string } | undefined {
  const match = /^!codex\s+topic\s+(\S+)(?:\s+(.+))?$/i.exec(prompt);
  if (!match) return undefined;
  return { workspace: match[1], name: match[2]?.trim() || match[1] };
}
