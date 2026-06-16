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

const AWAITING_TOOLS = new Set(["ask_user_question", "plan_exit"]);

export default function (_pi: ExtensionAPI) {
  const awaitingToolCalls = new Set<string>();

  function toolCallId(event: unknown): string | undefined {
    return typeof (event as { toolCallId?: unknown }).toolCallId === "string"
      ? (event as { toolCallId: string }).toolCallId
      : undefined;
  }

  function toolName(event: unknown): string | undefined {
    return typeof (event as { toolName?: unknown }).toolName === "string"
      ? (event as { toolName: string }).toolName
      : undefined;
  }

  function markWorking(_event: unknown, _ctx: ExtensionContext) {
    writeStatus(awaitingToolCalls.size > 0 ? "awaiting" : "working");
  }

  function markIdle(_event: unknown, _ctx: ExtensionContext) {
    awaitingToolCalls.clear();
    writeStatus("idle");
  }

  function isAwaitingTool(event: unknown): boolean {
    const name = toolName(event);
    return typeof name === "string" && AWAITING_TOOLS.has(name);
  }

  function markToolStart(event: unknown, _ctx: ExtensionContext) {
    if (isAwaitingTool(event)) {
      const id = toolCallId(event);
      if (id) awaitingToolCalls.add(id);
      writeStatus("awaiting");
      return;
    }
    markWorking(event, _ctx);
  }

  function markToolEnd(event: unknown, _ctx: ExtensionContext) {
    if (isAwaitingTool(event)) {
      const id = toolCallId(event);
      if (id) awaitingToolCalls.delete(id);
    }
    markWorking(event, _ctx);
  }

  _pi.on("before_agent_start", markWorking);
  _pi.on("agent_start", markWorking);
  _pi.on("tool_execution_start", markToolStart);
  _pi.on("tool_execution_end", markToolEnd);
  _pi.on("agent_end", markIdle);
  _pi.on("session_start", markIdle);
  _pi.on("session_shutdown", markIdle);
}
