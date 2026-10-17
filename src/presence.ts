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

export function presenceLabel(_context: PresenceContext, timeLeft = ""): string {
  return truncate(timeLeft ? `⏳${timeLeft}` : "", MAX_ACTIVITY_LENGTH);
}

export function initialPresence(context: PresenceContext): PresenceData {
  return {
    status: "online",
    activities: [{ name: presenceLabel(context) || "限额：读取中", type: ActivityType.Playing }],
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
        activities: [{ name: presenceLabel(context, left) || "限额：读取中", type: ActivityType.Playing }],
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

/** Coalesce bursts and re-read the latest state before publishing. Discord permits
 * five activity changes per twenty seconds; reconnect/heartbeat requests share
 * the same throttle as task and quota changes.
 */
export class PresencePublisher {
  private timer?: NodeJS.Timeout;
  private lastSent = -Infinity;
  private lastKey = "";
  private force = false;
  private stopped = false;
  lastPublished?: { label: string; status: string; at: string };
  constructor(private read: () => PresenceData | undefined, private send: (data: PresenceData) => void,
    private log: () => void = () => console.error("Presence publish failed"),
    private minimumMs = 5000, private now: () => number = Date.now) {}

  request(force = false): void {
    if (this.stopped) return;
    this.force ||= force;
    const data = this.read();
    if (!data) return;
    const key = JSON.stringify(data);
    if (key === this.lastKey && !this.force) return;
    const remaining = this.minimumMs - (this.now() - this.lastSent);
    if (remaining > 0) {
      if (!this.timer) {
        this.timer = setTimeout(() => { this.timer = undefined; this.request(); }, remaining);
        this.timer.unref();
      }
      return;
    }
    try {
      this.send(data);
      this.lastSent = this.now(); this.lastKey = key; this.force = false;
      this.lastPublished = { label: data.activities?.[0]?.name ?? "", status: data.status ?? "online",
        at: new Date(this.lastSent).toISOString() };
    } catch { this.log(); }
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }
}
