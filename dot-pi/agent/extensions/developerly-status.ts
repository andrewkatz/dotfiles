import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { execFileSync } from "node:child_process";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function statusDir(): string {
  return process.env.XDG_CACHE_HOME
    ? join(process.env.XDG_CACHE_HOME, "developerly", "status")
    : join(homedir(), ".cache", "developerly", "status");
}

function tmuxSession(): string | undefined {
  const pane = process.env.TMUX_PANE;
  if (!pane) return undefined;
  try {
    return execFileSync("tmux", ["display-message", "-p", "-t", pane, "#{session_name}"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}

function sanitize(session: string): string {
  return session.replaceAll("/", "_");
}

function writeStatus(state: "idle" | "working" | "awaiting") {
  const session = tmuxSession();
  if (!session) return;
  const dir = statusDir();
  mkdirSync(dir, { recursive: true });
  const file = join(dir, sanitize(session));
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, state);
  renameSync(tmp, file);
}

export default function (_pi: ExtensionAPI) {
  function markWorking(_event: unknown, _ctx: ExtensionContext) {
    writeStatus("working");
  }

  function markIdle(_event: unknown, _ctx: ExtensionContext) {
    writeStatus("idle");
  }

  _pi.on("before_agent_start", markWorking);
  _pi.on("agent_start", markWorking);
  _pi.on("tool_execution_start", markWorking);
  _pi.on("agent_end", markIdle);
  _pi.on("session_start", markIdle);
  _pi.on("session_shutdown", markIdle);
}
