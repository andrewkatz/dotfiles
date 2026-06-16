import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const ENTRY_TYPE = "developerly-goal-loop-state";
const STATUS_KEY = "developerly-goal-loop";

const DEFAULT_MAX_ATTEMPTS = 5;
const MAX_ATTEMPTS_LIMIT = 25;
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const MIN_TIMEOUT_MS = 1000;
const MAX_TIMEOUT_MS = 60 * 60 * 1000;
const DEFAULT_OUTPUT_LIMIT = 12000;
const MIN_OUTPUT_LIMIT = 1000;
const MAX_OUTPUT_LIMIT = 50000;

type GoalAction = "set" | "progress" | "complete" | "clear" | "stop";
type VerificationStatus = "passed" | "failed";

interface CommandVerifier {
  id: string;
  kind: "command";
  command: string;
}

interface VerifierRun {
  verifierId: string;
  command: string;
  ok: boolean;
  code: number | null;
  killed: boolean;
  durationMs: number;
  output: string;
  outputTruncated: boolean;
  error?: string;
}

interface VerificationResult {
  attempt: number;
  status: VerificationStatus;
  startedAt: string;
  durationMs: number;
  runs: VerifierRun[];
}

interface GoalState {
  schemaVersion: 1;
  id: string;
  kind: "command";
  active: boolean;
  description: string;
  verifiers: CommandVerifier[];
  attempts: number;
  maxAttempts: number;
  timeoutMs: number;
  outputLimit: number;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  stoppedAt?: string;
  clearedAt?: string;
  stopReason?: string;
  lastResult?: VerificationResult;
}

interface GoalEntry {
  schemaVersion: 1;
  action: GoalAction;
  at: string;
  goal?: GoalState;
  reason?: string;
}

interface ParsedGoalArgs {
  description: string;
  verifiers: string[];
  maxAttempts: number;
  timeoutMs: number;
  outputLimit: number;
}

export default function developerlyGoalLoop(pi: ExtensionAPI) {
  let activeGoal: GoalState | undefined;
  let verifying = false;

  function persist(action: GoalAction, goal?: GoalState, reason?: string): void {
    const at = new Date().toISOString();
    const record: GoalEntry = {
      schemaVersion: 1,
      action,
      at,
      goal: goal ? { ...goal, updatedAt: at } : undefined,
      reason,
    };
    pi.appendEntry(ENTRY_TYPE, record);
  }

  function restoreGoal(ctx: ExtensionContext): GoalState | undefined {
    let goal: GoalState | undefined;
    for (const entry of ctx.sessionManager.getEntries()) {
      const customEntry = entry as { type?: string; customType?: string; data?: unknown };
      if (customEntry.type !== "custom" || customEntry.customType !== ENTRY_TYPE) continue;
      const data = customEntry.data;
      if (!isGoalEntry(data)) continue;
      if (data.action === "clear" || data.action === "complete" || data.action === "stop") {
        goal = undefined;
        continue;
      }
      if (data.goal && data.goal.active) {
        goal = data.goal;
      }
    }
    return goal;
  }

  function syncGoal(ctx: ExtensionContext): GoalState | undefined {
    activeGoal = restoreGoal(ctx);
    updateStatus(ctx);
    return activeGoal;
  }

  function updateStatus(ctx: ExtensionContext): void {
    if (!activeGoal) {
      ctx.ui.setStatus(STATUS_KEY, undefined);
      return;
    }
    ctx.ui.setStatus(STATUS_KEY, `goal ${activeGoal.attempts}/${activeGoal.maxAttempts}`);
  }

  pi.registerCommand("goal", {
    description: "Set, inspect, or clear a command-backed completion goal",
    getArgumentCompletions: (prefix: string) => {
      const items = ["status", "clear", "--verify", "--max-attempts", "--timeout", "--output-chars"].map((value) => ({
        value,
        label: value,
      }));
      const filtered = items.filter((item) => item.value.startsWith(prefix));
      return filtered.length > 0 ? filtered : null;
    },
    handler: async (args, ctx) => {
      const trimmed = args.trim();
      let tokens: string[];
      try {
        tokens = tokenize(trimmed);
      } catch (error) {
        ctx.ui.notify(`${error instanceof Error ? error.message : String(error)}\n\n${usage()}`, "error");
        return;
      }
      const subcommand = tokens[0];

      if (subcommand === "status") {
        const goal = syncGoal(ctx);
        ctx.ui.notify(goal ? formatStatus(goal) : "No active /goal.", "info");
        return;
      }

      if (subcommand === "clear") {
        const goal = syncGoal(ctx);
        if (!goal) {
          ctx.ui.notify("No active /goal to clear.", "info");
          return;
        }
        const clearedAt = new Date().toISOString();
        persist("clear", { ...goal, active: false, clearedAt }, "user cleared goal");
        activeGoal = undefined;
        updateStatus(ctx);
        ctx.ui.notify("Cleared active /goal.", "info");
        return;
      }

      if (trimmed === "") {
        const goal = syncGoal(ctx);
        ctx.ui.notify(goal ? `${formatStatus(goal)}\n\n${usage()}` : usage(), "info");
        return;
      }

      const parsed = parseGoalArgs(trimmed);
      if (typeof parsed === "string") {
        ctx.ui.notify(`${parsed}\n\n${usage()}`, "error");
        return;
      }

      const now = new Date().toISOString();
      const goal: GoalState = {
        schemaVersion: 1,
        id: newId("goal"),
        kind: "command",
        active: true,
        description: parsed.description,
        verifiers: parsed.verifiers.map((command) => ({
          id: newId("verifier"),
          kind: "command",
          command,
        })),
        attempts: 0,
        maxAttempts: parsed.maxAttempts,
        timeoutMs: parsed.timeoutMs,
        outputLimit: parsed.outputLimit,
        createdAt: now,
        updatedAt: now,
      };

      activeGoal = goal;
      persist("set", goal);
      updateStatus(ctx);
      ctx.ui.notify(formatSet(goal), "info");
    },
  });

  pi.on("session_start", (_event, ctx) => {
    syncGoal(ctx);
  });

  pi.on("session_shutdown", (_event, ctx) => {
    ctx.ui.setStatus(STATUS_KEY, undefined);
  });

  pi.on("agent_end", async (_event, ctx) => {
    if (verifying) return;
    const goal = syncGoal(ctx);
    if (!goal) return;

    verifying = true;
    try {
      await verifyGoal(goal, ctx);
    } finally {
      verifying = false;
      updateStatus(ctx);
    }
  });

  async function verifyGoal(goal: GoalState, ctx: ExtensionContext): Promise<void> {
    const attempt = goal.attempts + 1;
    const runningGoal: GoalState = {
      ...goal,
      attempts: attempt,
      updatedAt: new Date().toISOString(),
    };
    activeGoal = runningGoal;
    persist("progress", runningGoal);
    updateStatus(ctx);

    ctx.ui.notify(`Running /goal verifier commands (attempt ${attempt}/${runningGoal.maxAttempts})...`, "info");

    const result = await runVerifiers(runningGoal, ctx);
    const updatedGoal: GoalState = {
      ...runningGoal,
      lastResult: result,
      updatedAt: new Date().toISOString(),
    };

    if (result.status === "passed") {
      const completedAt = new Date().toISOString();
      persist("complete", { ...updatedGoal, active: false, completedAt }, "all verifier commands passed");
      activeGoal = undefined;
      updateStatus(ctx);
      ctx.ui.notify(`Goal complete after ${attempt} attempt(s): ${runningGoal.description}`, "info");
      return;
    }

    if (attempt >= runningGoal.maxAttempts) {
      const stoppedAt = new Date().toISOString();
      persist("stop", {
        ...updatedGoal,
        active: false,
        stoppedAt,
        stopReason: `max attempts reached (${runningGoal.maxAttempts})`,
      }, "max attempts reached");
      activeGoal = undefined;
      updateStatus(ctx);
      ctx.ui.notify(`Goal stopped after ${attempt} failed attempt(s); max attempts reached. Run /goal to set a new goal.`, "error");
      return;
    }

    activeGoal = updatedGoal;
    persist("progress", updatedGoal);
    updateStatus(ctx);
    ctx.ui.notify(`Goal verifier failed; continuing automatically (attempt ${attempt}/${runningGoal.maxAttempts}).`, "warning");
    pi.sendUserMessage(buildFailureFollowUp(updatedGoal, result), { deliverAs: "followUp" });
  }

  async function runVerifiers(goal: GoalState, ctx: ExtensionContext): Promise<VerificationResult> {
    const started = Date.now();
    const runs: VerifierRun[] = [];

    for (const verifier of goal.verifiers) {
      runs.push(await runVerifier(verifier, goal, ctx));
    }

    const status: VerificationStatus = runs.every((run) => run.ok) ? "passed" : "failed";
    return {
      attempt: goal.attempts,
      status,
      startedAt: new Date(started).toISOString(),
      durationMs: Date.now() - started,
      runs,
    };
  }

  async function runVerifier(verifier: CommandVerifier, goal: GoalState, ctx: ExtensionContext): Promise<VerifierRun> {
    const started = Date.now();
    try {
      const result = await pi.exec("bash", ["-lc", verifier.command], {
        cwd: ctx.cwd,
        timeout: goal.timeoutMs,
      });
      const ok = result.code === 0 && !result.killed;
      const output = ok ? "" : commandOutput(result.stdout, result.stderr);
      const truncated = truncateTail(output, goal.outputLimit);
      return {
        verifierId: verifier.id,
        command: verifier.command,
        ok,
        code: result.code,
        killed: result.killed,
        durationMs: Date.now() - started,
        output: truncated.text,
        outputTruncated: truncated.truncated,
      };
    } catch (error) {
      return {
        verifierId: verifier.id,
        command: verifier.command,
        ok: false,
        code: null,
        killed: false,
        durationMs: Date.now() - started,
        output: "",
        outputTruncated: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

function parseGoalArgs(input: string): ParsedGoalArgs | string {
  let tokens: string[];
  try {
    tokens = tokenize(input);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }

  const verifiers: string[] = [];
  const description: string[] = [];
  let maxAttempts = DEFAULT_MAX_ATTEMPTS;
  let timeoutMs = DEFAULT_TIMEOUT_MS;
  let outputLimit = DEFAULT_OUTPUT_LIMIT;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === "--") {
      description.push(...tokens.slice(i + 1));
      break;
    }

    if (token === "--verify" || token.startsWith("--verify=")) {
      const option = readOptionValue(token, "--verify", tokens, i);
      if (!option.ok) return option.error;
      i = option.index;
      if (option.value.trim() === "") return "Missing verifier command after --verify.";
      verifiers.push(option.value);
      continue;
    }

    if (token === "--max-attempts" || token.startsWith("--max-attempts=")) {
      const option = readOptionValue(token, "--max-attempts", tokens, i);
      if (!option.ok) return option.error;
      i = option.index;
      const parsed = parseBoundedInteger(option.value, 1, MAX_ATTEMPTS_LIMIT, "max attempts");
      if (typeof parsed === "string") return parsed;
      maxAttempts = parsed;
      continue;
    }

    if (token === "--timeout" || token.startsWith("--timeout=")) {
      const option = readOptionValue(token, "--timeout", tokens, i);
      if (!option.ok) return option.error;
      i = option.index;
      const parsed = parseDurationMs(option.value);
      if (typeof parsed === "string") return parsed;
      timeoutMs = parsed;
      continue;
    }

    if (token === "--output-chars" || token.startsWith("--output-chars=")) {
      const option = readOptionValue(token, "--output-chars", tokens, i);
      if (!option.ok) return option.error;
      i = option.index;
      const parsed = parseBoundedInteger(option.value, MIN_OUTPUT_LIMIT, MAX_OUTPUT_LIMIT, "output chars");
      if (typeof parsed === "string") return parsed;
      outputLimit = parsed;
      continue;
    }

    if (token.startsWith("--")) return `Unknown /goal option: ${token}`;
    description.push(token);
  }

  const descriptionText = description.join(" ").trim();
  if (verifiers.length === 0) return "A command-backed /goal needs at least one --verify command.";
  if (descriptionText === "") return "Describe the completion condition after the verifier command(s).";

  return {
    description: descriptionText,
    verifiers,
    maxAttempts,
    timeoutMs,
    outputLimit,
  };
}

function readOptionValue(
  token: string,
  option: string,
  tokens: string[],
  index: number,
): { ok: true; value: string; index: number } | { ok: false; error: string } {
  if (token.startsWith(`${option}=`)) return { ok: true, value: token.slice(option.length + 1), index };
  const value = tokens[index + 1];
  if (typeof value !== "string") return { ok: false, error: `Missing value for ${option}.` };
  return { ok: true, value, index: index + 1 };
}

function parseBoundedInteger(value: string | undefined, min: number, max: number, label: string): number | string {
  if (!value || !/^\d+$/.test(value)) return `Invalid ${label}: ${value ?? ""}`;
  const parsed = Number.parseInt(value, 10);
  if (parsed < min || parsed > max) return `${label} must be between ${min} and ${max}.`;
  return parsed;
}

function parseDurationMs(value: string | undefined): number | string {
  if (!value) return "Missing timeout value.";
  const match = /^(\d+)(ms|s|m|h)?$/.exec(value);
  if (!match) return "Timeout must look like 300s, 5m, 1h, or 1000ms.";

  const amount = Number.parseInt(match[1], 10);
  const unit = match[2] ?? "s";
  const multiplier = unit === "ms" ? 1 : unit === "s" ? 1000 : unit === "m" ? 60 * 1000 : 60 * 60 * 1000;
  const timeoutMs = amount * multiplier;
  if (timeoutMs < MIN_TIMEOUT_MS || timeoutMs > MAX_TIMEOUT_MS) {
    return `timeout must be between ${formatDuration(MIN_TIMEOUT_MS)} and ${formatDuration(MAX_TIMEOUT_MS)}.`;
  }
  return timeoutMs;
}

function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | undefined;
  let escaping = false;
  let tokenStarted = false;

  for (const char of input) {
    if (escaping) {
      current += char;
      tokenStarted = true;
      escaping = false;
      continue;
    }

    if (char === "\\" && quote !== "'") {
      escaping = true;
      tokenStarted = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = undefined;
      } else {
        current += char;
      }
      tokenStarted = true;
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      tokenStarted = true;
      continue;
    }

    if (/\s/.test(char)) {
      if (tokenStarted) {
        tokens.push(current);
        current = "";
        tokenStarted = false;
      }
      continue;
    }

    current += char;
    tokenStarted = true;
  }

  if (escaping) current += "\\";
  if (quote) throw new Error(`Unterminated ${quote} quote in /goal arguments.`);
  if (tokenStarted) tokens.push(current);
  return tokens;
}

function commandOutput(stdout: string, stderr: string): string {
  const parts: string[] = [];
  if (stdout.trim() !== "") parts.push(`STDOUT:\n${stdout.trimEnd()}`);
  if (stderr.trim() !== "") parts.push(`STDERR:\n${stderr.trimEnd()}`);
  return parts.join("\n\n");
}

function buildFailureFollowUp(goal: GoalState, result: VerificationResult): string {
  const failedRuns = result.runs.filter((run) => !run.ok);
  const outputBudget = Math.max(MIN_OUTPUT_LIMIT, Math.floor(goal.outputLimit / Math.max(1, failedRuns.length)));
  const lines: string[] = [
    `Goal verification failed (attempt ${result.attempt}/${goal.maxAttempts}). Continue working until all verifier commands pass.`,
    "",
    `Completion condition: ${goal.description}`,
    "",
    "Verifier commands (explicit/auditable):",
  ];

  result.runs.forEach((run, index) => {
    const status = run.ok ? "PASS" : "FAIL";
    const exit = run.code === null ? "error" : `exit ${run.code}`;
    const killed = run.killed ? ", killed/timeout" : "";
    lines.push(`${index + 1}. ${status} (${exit}${killed}, ${formatDuration(run.durationMs)}): ${run.command}`);
  });

  lines.push("", "Failure output:");
  failedRuns.forEach((run, index) => {
    const output = run.output || run.error || "(no output)";
    const truncated = truncateTail(output, outputBudget);
    const truncationNote = run.outputTruncated || truncated.truncated ? ` (truncated to last ${outputBudget} chars)` : "";
    lines.push(
      "",
      `Failed verifier ${index + 1}: ${run.command}`,
      `Result: ${run.code === null ? "execution error" : `exit ${run.code}`}${run.killed ? " (killed/timeout)" : ""}`,
      `Output${truncationNote}:`,
      truncated.text || "(no output)",
    );
  });

  lines.push("", "Keep working on the goal. Make the smallest necessary changes, then stop so the verifier commands can run again.");
  return lines.join("\n");
}

function truncateTail(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  const marker = `[output truncated to last ${maxChars} chars]\n`;
  return { text: marker + text.slice(Math.max(0, text.length - maxChars)), truncated: true };
}

function usage(): string {
  return [
    "Usage:",
    '  /goal --verify "bin/test" "completion condition"',
    '  /goal --verify "bin/test" --verify "bundle exec rubocop" --max-attempts 5 --timeout 10m "tests and lint pass"',
    "  /goal status",
    "  /goal clear",
  ].join("\n");
}

function formatSet(goal: GoalState): string {
  return [
    `Set /goal: ${goal.description}`,
    "Verifier commands:",
    ...goal.verifiers.map((verifier, index) => `${index + 1}. ${verifier.command}`),
    `Attempts: 0/${goal.maxAttempts}; timeout: ${formatDuration(goal.timeoutMs)} per command; output limit: ${goal.outputLimit} chars.`,
  ].join("\n");
}

function formatStatus(goal: GoalState): string {
  return [
    `Active /goal: ${goal.description}`,
    `Attempts: ${goal.attempts}/${goal.maxAttempts}; timeout: ${formatDuration(goal.timeoutMs)} per command; output limit: ${goal.outputLimit} chars.`,
    "Verifier commands:",
    ...goal.verifiers.map((verifier, index) => `${index + 1}. ${verifier.command}`),
    goal.lastResult ? `Last verification: ${goal.lastResult.status} in ${formatDuration(goal.lastResult.durationMs)}.` : "Last verification: not run yet.",
  ].join("\n");
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60 * 1000) return `${trimNumber(ms / 1000)}s`;
  if (ms < 60 * 60 * 1000) return `${trimNumber(ms / (60 * 1000))}m`;
  return `${trimNumber(ms / (60 * 60 * 1000))}h`;
}

function trimNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function isGoalEntry(value: unknown): value is GoalEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<GoalEntry>;
  return entry.schemaVersion === 1 && typeof entry.action === "string";
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
