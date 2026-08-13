import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { ActivityType, ClientUser, PresenceData } from "discord.js";

const execFileAsync = promisify(execFile);
const REFRESH_MS = 15 * 60 * 1000;
const MAX_ACTIVITY_LENGTH = 128;

export type PresenceContext = {
  node: string;
  project: string;
  slurmJobId: string;
};

export function presenceContext(projectDir: string, env = process.env): PresenceContext {
  return {
    node: shortHostname(env.SLURMD_NODENAME || env.HOSTNAME || os.hostname()),
    project: path.basename(projectDir) || "Codex",
    slurmJobId: env.SLURM_JOB_ID || env.SLURM_JOBID || "",
  };
}

export function formatSlurmTimeLeft(value: string): string {
  const text = value.trim();
  if (!text || text === "INVALID" || text === "NOT_SET" || text === "N/A") return "";
  const match = text.match(/^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/);
  if (!match) return text;
  const days = Number(match[1] || 0);
  const hours = Number(match[2] || 0);
  const minutes = Number(match[3] || 0);
  if (days) return `${days}d${hours}h`;
  if (hours) return `${hours}h${String(minutes).padStart(2, "0")}m`;
  return `${minutes}m`;
}

export function presenceLabel(context: PresenceContext, timeLeft = ""): string {
  const parts = [context.node, timeLeft ? `⏳${timeLeft}` : "", context.project].filter(Boolean);
  return truncate(parts.join(" · ") || "Codex · HPC", MAX_ACTIVITY_LENGTH);
}

export function initialPresence(context: PresenceContext): PresenceData {
  return {
    status: "online",
    activities: [{ name: presenceLabel(context), type: ActivityType.Playing }],
  };
}

export async function slurmTimeLeft(jobId: string): Promise<string> {
  if (!jobId) return "";
  try {
    const { stdout } = await execFileAsync("squeue", ["-h", "-j", jobId, "-o", "%L"], {
      timeout: 5000,
      encoding: "utf8",
    });
    return formatSlurmTimeLeft(stdout);
  } catch {
    return "";
  }
}

export function startPresenceUpdates(
  user: ClientUser,
  context: PresenceContext,
  log: (message: string) => void = console.log,
): NodeJS.Timeout | undefined {
  let refreshing = false;
  const refresh = async () => {
    if (refreshing) return;
    refreshing = true;
    try {
      const left = await slurmTimeLeft(context.slurmJobId);
      user.setPresence({
        status: "online",
        activities: [{ name: presenceLabel(context, left), type: ActivityType.Playing }],
      });
      log(`Discord presence: ${presenceLabel(context, left)}${context.slurmJobId ? `; job=${context.slurmJobId}` : ""}`);
    } finally {
      refreshing = false;
    }
  };

  void refresh();
  if (!context.slurmJobId) return undefined;
  const timer = setInterval(() => void refresh(), REFRESH_MS);
  timer.unref();
  return timer;
}

function shortHostname(value: string): string {
  return value.trim().split(".")[0] || "";
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}
