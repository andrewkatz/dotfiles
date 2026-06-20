import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const MAX_OUTPUT_CHARS = 16_000;
const MAX_COMPLETED_MONITORS = 25;

type MonitorStatus = "running" | "completed" | "failed" | "cancelled" | "triggered";
type TriggerType = "exit" | "output_match" | "timeout";

type Monitor = {
  id: string;
  name: string;
  command: string;
  kind: "command" | "github_pr_checks";
  proc: ChildProcessWithoutNullStreams;
  status: MonitorStatus;
  startedAt: number;
  completedAt?: number;
  exitCode?: number | null;
  signal?: NodeJS.Signals | null;
  output: string;
  trigger: TriggerType;
  pattern?: RegExp;
  prompt?: string;
  triggered: boolean;
  timeout?: NodeJS.Timeout;
  developerlySession?: string;
};

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

function monitorFile(session: string): string {
  return join(statusDir(), `${sanitize(session)}.monitor`);
}

function clearDeveloperlyMonitorMarker(session: string) {
  try {
    rmSync(monitorFile(session), { force: true });
  } catch {
    // Status publishing is best-effort and must not affect monitor behavior.
  }
}

function writeDeveloperlyMonitorMarker(session: string, monitors: Monitor[]) {
  try {
    const dir = statusDir();
    mkdirSync(dir, { recursive: true });
    const file = monitorFile(session);
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify({
      active: true,
      updated_at: new Date().toISOString(),
      monitors: monitors.map((monitor) => ({
        id: monitor.id,
        name: monitor.name,
        kind: monitor.kind,
        status: monitor.status,
        started_at: new Date(monitor.startedAt).toISOString(),
      })),
    }));
    renameSync(tmp, file);
  } catch {
    // Status publishing is best-effort and must not affect monitor behavior.
  }
}

const commandMonitorSchema = Type.Object({
  command: Type.String({ description: "Shell command to run in the background and monitor." }),
  name: Type.Optional(Type.String({ description: "Short human-readable monitor name." })),
  trigger: Type.Optional(Type.Union([
    Type.Literal("exit"),
    Type.Literal("output_match"),
    Type.Literal("timeout"),
  ], { description: "Event that should wake Pi. Defaults to exit." })),
  pattern: Type.Optional(Type.String({ description: "Regex to watch for when trigger is output_match." })),
  timeoutSeconds: Type.Optional(Type.Number({ description: "Wake Pi after this many seconds if the command is still running." })),
  stopOnTrigger: Type.Optional(Type.Boolean({ description: "Kill the process after an output_match or timeout trigger. Defaults to false." })),
  prompt: Type.Optional(Type.String({ description: "Custom instruction to send Pi when the monitor triggers." })),
});

type CommandMonitorInput = Static<typeof commandMonitorSchema>;

const githubPrChecksSchema = Type.Object({
  pr: Type.Optional(Type.String({ description: "PR number, branch, or URL. If omitted, gh uses the current branch." })),
  repo: Type.Optional(Type.String({ description: "GitHub repo in OWNER/REPO form. Optional when cwd is inside the repo." })),
  name: Type.Optional(Type.String({ description: "Short human-readable monitor name." })),
  requiredOnly: Type.Optional(Type.Boolean({ description: "Only monitor required checks. Defaults to false." })),
  failFast: Type.Optional(Type.Boolean({ description: "Wake as soon as the first check fails. Defaults to false." })),
  intervalSeconds: Type.Optional(Type.Number({ description: "gh watch refresh interval. Defaults to 30 seconds." })),
  prompt: Type.Optional(Type.String({ description: "Custom instruction to send Pi when checks complete or fail." })),
});

type GithubPrChecksInput = Static<typeof githubPrChecksSchema>;

export default function (pi: ExtensionAPI) {
  const monitors = new Map<string, Monitor>();
  let latestCtx: ExtensionContext | undefined;
  let nextId = 1;
  let developerlyMonitorSessions = new Set<string>();

  function newId(): string {
    return `mon-${nextId++}`;
  }

  function appendOutput(monitor: Monitor, text: string) {
    monitor.output += text;
    if (monitor.output.length > MAX_OUTPUT_CHARS) {
      monitor.output = monitor.output.slice(-MAX_OUTPUT_CHARS);
    }
  }

  function outputTail(monitor: Monitor, maxChars = 12_000): string {
    return monitor.output.slice(-maxChars).trim() || "(no output captured)";
  }

  function monitorSummary(monitor: Monitor): string {
    const elapsed = Math.max(1, Math.round(((monitor.completedAt ?? Date.now()) - monitor.startedAt) / 1000));
    const result = monitor.exitCode === undefined ? "" : ` exit=${monitor.exitCode}`;
    return `${monitor.id} [${monitor.status}] ${monitor.name} (${elapsed}s${result})`;
  }

  function activeMonitors() {
    return [...monitors.values()].filter((monitor) => monitor.status === "running");
  }

  function pruneCompleted() {
    const completed = [...monitors.values()]
      .filter((monitor) => monitor.status !== "running")
      .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));

    for (const monitor of completed.slice(MAX_COMPLETED_MONITORS)) {
      monitors.delete(monitor.id);
    }
  }

  function clearCurrentDeveloperlyMonitorMarker() {
    const session = tmuxSession();
    if (session) clearDeveloperlyMonitorMarker(session);
  }

  function syncDeveloperlyMonitorMarkers() {
    const activeBySession = new Map<string, Monitor[]>();
    for (const monitor of activeMonitors()) {
      if (!monitor.developerlySession) continue;
      const existing = activeBySession.get(monitor.developerlySession) ?? [];
      existing.push(monitor);
      activeBySession.set(monitor.developerlySession, existing);
    }

    for (const session of developerlyMonitorSessions) {
      if (!activeBySession.has(session)) clearDeveloperlyMonitorMarker(session);
    }
    for (const [session, active] of activeBySession) {
      writeDeveloperlyMonitorMarker(session, active);
    }
    developerlyMonitorSessions = new Set(activeBySession.keys());
  }

  function renderStatus(ctx = latestCtx) {
    syncDeveloperlyMonitorMarkers();
    if (!ctx?.hasUI) return;

    const running = activeMonitors();
    ctx.ui.setStatus("monitor", running.length ? `monitors: ${running.length}` : undefined);
    ctx.ui.setWidget(
      "monitor",
      running.length ? running.map((monitor) => `● ${monitorSummary(monitor)}`) : undefined,
      { placement: "belowEditor" },
    );
  }

  function sendWakeup(monitor: Monitor, reason: string) {
    const prompt = monitor.prompt ? `\n\nRequested follow-up:\n${monitor.prompt}` : "";
    const message = `Monitor triggered: ${monitor.name}\n\nReason: ${reason}\nCommand:\n\`${monitor.command}\`\n\nStatus: ${monitor.status}\nExit code: ${monitor.exitCode ?? "n/a"}\nSignal: ${monitor.signal ?? "n/a"}\n\nRecent output:\n\`\`\`\n${outputTail(monitor)}\n\`\`\`${prompt}\n\nPlease decide the next step.`;

    try {
      if (latestCtx?.isIdle()) {
        pi.sendUserMessage(message);
      } else {
        pi.sendUserMessage(message, { deliverAs: "followUp" });
      }
    } catch {
      pi.sendUserMessage(message, { deliverAs: "followUp" });
    }
  }

  function killMonitor(monitor: Monitor, signal: NodeJS.Signals = "SIGTERM") {
    if (monitor.timeout) clearTimeout(monitor.timeout);
    try {
      if (monitor.proc.pid) process.kill(-monitor.proc.pid, signal);
    } catch {
      try {
        monitor.proc.kill(signal);
      } catch {
        // Process is already gone.
      }
    }
  }

  function startMonitor(input: {
    name?: string;
    command: string;
    args?: string[];
    kind: Monitor["kind"];
    trigger?: TriggerType;
    pattern?: string;
    timeoutSeconds?: number;
    stopOnTrigger?: boolean;
    prompt?: string;
    cwd: string;
  }) {
    const id = newId();
    const trigger = input.trigger ?? "exit";
    const pattern = input.pattern ? new RegExp(input.pattern, "m") : undefined;
    const proc = input.args
      ? spawn(input.command, input.args, { cwd: input.cwd, env: process.env, detached: true })
      : spawn("bash", ["-lc", input.command], { cwd: input.cwd, env: process.env, detached: true });

    const monitor: Monitor = {
      id,
      name: input.name || input.command,
      command: input.args ? [input.command, ...input.args].join(" ") : input.command,
      kind: input.kind,
      proc,
      status: "running",
      startedAt: Date.now(),
      output: "",
      trigger,
      pattern,
      prompt: input.prompt,
      triggered: false,
      developerlySession: tmuxSession(),
    };

    monitors.set(id, monitor);
    renderStatus();

    function maybeTriggerFromOutput(text: string) {
      if (monitor.trigger !== "output_match" || monitor.triggered || !monitor.pattern) return;
      if (!monitor.pattern.test(text) && !monitor.pattern.test(monitor.output)) return;

      monitor.triggered = true;
      monitor.status = "triggered";
      monitor.completedAt = Date.now();
      sendWakeup(monitor, `output matched /${monitor.pattern.source}/`);
      if (input.stopOnTrigger) killMonitor(monitor);
      renderStatus();
    }

    proc.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      appendOutput(monitor, text);
      maybeTriggerFromOutput(text);
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      appendOutput(monitor, text);
      maybeTriggerFromOutput(text);
    });

    proc.on("close", (code, signal) => {
      if (monitor.timeout) clearTimeout(monitor.timeout);
      monitor.exitCode = code;
      monitor.signal = signal;
      monitor.completedAt = Date.now();
      if (monitor.status === "cancelled") return;
      monitor.status = code === 0 ? "completed" : "failed";

      if (!monitor.triggered && (monitor.trigger === "exit" || monitor.status === "failed")) {
        monitor.triggered = true;
        sendWakeup(monitor, code === 0 ? "process exited successfully" : "process exited with failure");
      }
      pruneCompleted();
      renderStatus();
    });

    proc.on("error", (error) => {
      appendOutput(monitor, `\n[monitor error] ${error.message}\n`);
      monitor.status = "failed";
      monitor.completedAt = Date.now();
      if (!monitor.triggered) {
        monitor.triggered = true;
        sendWakeup(monitor, "process failed to start");
      }
      renderStatus();
    });

    if (input.timeoutSeconds && input.timeoutSeconds > 0) {
      monitor.timeout = setTimeout(() => {
        if (monitor.status !== "running" || monitor.triggered) return;
        monitor.triggered = true;
        if (monitor.trigger === "timeout") {
          monitor.status = "triggered";
          monitor.completedAt = Date.now();
        }
        sendWakeup(monitor, `timeout after ${input.timeoutSeconds} seconds`);
        if (input.stopOnTrigger) killMonitor(monitor);
        renderStatus();
      }, input.timeoutSeconds * 1000);
    }

    return monitor;
  }

  function listText(includeOutput = false): string {
    if (monitors.size === 0) return "No monitors.";
    return [...monitors.values()]
      .sort((a, b) => b.startedAt - a.startedAt)
      .map((monitor) => {
        const base = monitorSummary(monitor);
        if (!includeOutput) return base;
        return `${base}\nCommand: ${monitor.command}\nRecent output:\n${outputTail(monitor, 4000)}`;
      })
      .join("\n\n");
  }

  function startGithubPrChecks(input: GithubPrChecksInput, ctx: ExtensionContext) {
    const interval = Math.max(10, Math.round(input.intervalSeconds ?? 30));
    const args = ["pr", "checks"];
    if (input.pr) args.push(input.pr);
    args.push("--watch", "--interval", String(interval));
    if (input.requiredOnly) args.push("--required");
    if (input.failFast) args.push("--fail-fast");
    if (input.repo) args.push("--repo", input.repo);

    return startMonitor({
      name: input.name || `PR checks${input.pr ? ` ${input.pr}` : ""}`,
      command: "gh",
      args,
      kind: "github_pr_checks",
      trigger: "exit",
      prompt: input.prompt || "If checks failed, inspect the failure and fix it. If checks passed, summarize the status.",
      cwd: ctx.cwd,
    });
  }

  pi.registerTool({
    name: "monitor_command",
    label: "Monitor Command",
    description: "Run a long-running shell command in the background and wake Pi when it exits, times out, or its output matches a regex.",
    promptSnippet: "Run long-running commands in the background and wake Pi only when they complete or produce a relevant signal.",
    promptGuidelines: [
      "Use monitor_command instead of bash for commands likely to run longer than 60 seconds when immediate output is not required.",
      "Use monitor_command for long test suites, builds, dev servers, deploy commands, log watches, and other async workflows where repeated polling would waste context.",
      "Do not use monitor_command for quick one-off commands; use bash instead.",
      "When starting a server, use monitor_command with trigger output_match for readiness messages such as Listening, Ready, or booted.",
      "After monitor_command starts a monitor, do not poll for status; wait for the monitor wakeup unless the user asks for status.",
    ],
    parameters: commandMonitorSchema,
    async execute(_toolCallId, params: CommandMonitorInput, _signal, _onUpdate, ctx) {
      latestCtx = ctx;
      const monitor = startMonitor({
        name: params.name,
        command: params.command,
        kind: "command",
        trigger: params.trigger ?? "exit",
        pattern: params.pattern,
        timeoutSeconds: params.timeoutSeconds,
        stopOnTrigger: params.stopOnTrigger,
        prompt: params.prompt,
        cwd: ctx.cwd,
      });

      return {
        content: [{ type: "text", text: `Started monitor ${monitor.id}: ${monitor.name}. Pi will be woken when ${monitor.trigger} triggers.` }],
        details: { id: monitor.id, status: monitor.status, command: monitor.command, trigger: monitor.trigger },
      };
    },
  });

  pi.registerTool({
    name: "monitor_github_pr_checks",
    label: "Monitor GitHub PR Checks",
    description: "Watch GitHub PR checks with gh and wake Pi when checks pass, fail, or fail fast.",
    promptSnippet: "Watch GitHub PR checks without spending model turns repeatedly polling CI status.",
    promptGuidelines: [
      "Use monitor_github_pr_checks when the user asks to wait for PR checks, CI, branch checks, or GitHub Actions completion.",
      "Prefer monitor_github_pr_checks over repeatedly running gh pr checks or gh run list.",
      "After starting monitor_github_pr_checks, do not poll GitHub checks unless the user asks for an immediate status update.",
    ],
    parameters: githubPrChecksSchema,
    async execute(_toolCallId, params: GithubPrChecksInput, _signal, _onUpdate, ctx) {
      latestCtx = ctx;
      const monitor = startGithubPrChecks(params, ctx);
      return {
        content: [{ type: "text", text: `Started GitHub PR checks monitor ${monitor.id}: ${monitor.name}. Pi will be woken when checks finish or fail.` }],
        details: { id: monitor.id, status: monitor.status, command: monitor.command },
      };
    },
  });

  pi.registerTool({
    name: "monitor_list",
    label: "List Monitors",
    description: "List active and recently completed monitors. Use only when the user asks for monitor status; do not poll repeatedly.",
    parameters: Type.Object({
      includeOutput: Type.Optional(Type.Boolean({ description: "Include recent output for each monitor. Defaults to false." })),
    }),
    async execute(_toolCallId, params: { includeOutput?: boolean }, _signal, _onUpdate, ctx) {
      latestCtx = ctx;
      return { content: [{ type: "text", text: listText(params.includeOutput) }], details: {} };
    },
  });

  pi.registerTool({
    name: "monitor_stop",
    label: "Stop Monitor",
    description: "Stop a running monitor by id.",
    parameters: Type.Object({ id: Type.String({ description: "Monitor id, for example mon-1." }) }),
    async execute(_toolCallId, params: { id: string }, _signal, _onUpdate, ctx) {
      latestCtx = ctx;
      const monitor = monitors.get(params.id);
      if (!monitor) throw new Error(`Monitor ${params.id} not found`);
      monitor.status = "cancelled";
      monitor.completedAt = Date.now();
      killMonitor(monitor);
      renderStatus(ctx);
      return { content: [{ type: "text", text: `Stopped monitor ${monitor.id}: ${monitor.name}` }], details: { id: monitor.id } };
    },
  });

  pi.registerCommand("monitor", {
    description: "Run a background command and wake Pi when it exits",
    handler: async (args, ctx) => {
      latestCtx = ctx;
      const command = args.trim();
      if (!command) {
        ctx.ui.notify("Usage: /monitor <command>", "error");
        return;
      }
      const monitor = startMonitor({ command, kind: "command", trigger: "exit", cwd: ctx.cwd });
      ctx.ui.notify(`Started monitor ${monitor.id}: ${monitor.name}`, "info");
    },
  });

  pi.registerCommand("monitor-pr", {
    description: "Watch GitHub PR checks and wake Pi when they finish",
    handler: async (args, ctx) => {
      latestCtx = ctx;
      const parts = args.trim().split(/\s+/).filter(Boolean);
      const input: GithubPrChecksInput = {};
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (part === "--repo") input.repo = parts[++i];
        else if (part === "--required") input.requiredOnly = true;
        else if (part === "--fail-fast") input.failFast = true;
        else if (part === "--interval") input.intervalSeconds = Number(parts[++i]);
        else input.pr = part;
      }
      const monitor = startGithubPrChecks(input, ctx);
      ctx.ui.notify(`Started PR checks monitor ${monitor.id}: ${monitor.name}`, "info");
    },
  });

  pi.registerCommand("monitors", {
    description: "List monitors",
    handler: async (_args, ctx) => {
      latestCtx = ctx;
      ctx.ui.notify(listText(false), "info");
    },
  });

  pi.registerCommand("monitor-stop", {
    description: "Stop a monitor by id",
    handler: async (args, ctx) => {
      latestCtx = ctx;
      const id = args.trim();
      const monitor = monitors.get(id);
      if (!monitor) {
        ctx.ui.notify(`Monitor ${id} not found`, "error");
        return;
      }
      monitor.status = "cancelled";
      monitor.completedAt = Date.now();
      killMonitor(monitor);
      renderStatus(ctx);
      ctx.ui.notify(`Stopped monitor ${monitor.id}: ${monitor.name}`, "info");
    },
  });

  pi.on("session_start", (_event, ctx) => {
    latestCtx = ctx;
    clearCurrentDeveloperlyMonitorMarker();
    developerlyMonitorSessions.clear();
    renderStatus(ctx);
  });

  pi.on("session_shutdown", () => {
    for (const monitor of monitors.values()) {
      if (monitor.status === "running") {
        monitor.status = "cancelled";
        killMonitor(monitor);
      }
    }
    monitors.clear();
    renderStatus();
    clearCurrentDeveloperlyMonitorMarker();
  });
}
