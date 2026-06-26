import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const ENTRY_TYPE = "developerly-goal-loop-state";
const STATUS_KEY = "developerly-goal-loop";

const DEFAULT_MAX_ATTEMPTS = 5;
const MAX_ATTEMPTS_LIMIT = 25;
const DEFAULT_MAX_EVALUATOR_FAILURES = 3;
const EVALUATOR_TIMEOUT_MS = 2 * 60 * 1000;
const EVALUATOR_OUTPUT_LIMIT = 20000;
const SNAPSHOT_OUTPUT_LIMIT = 12000;

const COMPLETE_MARKER = "[goal:complete]";
const BLOCKED_MARKER = "[goal:blocked]";

type GoalAction = "set" | "progress" | "complete" | "clear" | "stop";
type GoalMarker = "complete" | "blocked";
type EvaluationStatus = "complete" | "continue" | "blocked";
type EvaluationConfidence = "low" | "medium" | "high";

interface GoalEvaluation {
  status: EvaluationStatus;
  confidence: EvaluationConfidence;
  reason: string;
  nextInstruction?: string;
  rawOutput?: string;
  error?: string;
  exitCode?: number;
  durationMs: number;
  evaluatedAt: string;
}

interface PromptGoalState {
  schemaVersion: 2;
  id: string;
  kind: "prompt";
  active: boolean;
  prompt: string;
  attempts: number;
  maxAttempts: number;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  stoppedAt?: string;
  clearedAt?: string;
  stopReason?: string;
  lastAssistantText?: string;
  lastMarker?: GoalMarker;
  lastEvaluation?: GoalEvaluation;
  evaluatorFailures: number;
  evaluatorModel?: string;
}

type GoalState = PromptGoalState;

interface GoalEntry {
  schemaVersion: 1;
  action: GoalAction;
  at: string;
  goal?: unknown;
  reason?: string;
}

interface ParsedGoalArgs {
  prompt: string;
  maxAttempts: number;
  evaluatorModel?: string;
}

export default function developerlyGoalLoop(pi: ExtensionAPI) {
  let activeGoal: GoalState | undefined;
  let handlingAgentEnd = false;

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
      if (isPromptGoalState(data.goal) && data.goal.active) {
        goal = {
          ...data.goal,
          evaluatorFailures: typeof data.goal.evaluatorFailures === "number" ? data.goal.evaluatorFailures : 0,
        };
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
    if (!activeGoal || !activeGoal.active) {
      ctx.ui.setStatus(STATUS_KEY, undefined);
      return;
    }
    ctx.ui.setStatus(STATUS_KEY, `goal ${activeGoal.attempts}/${activeGoal.maxAttempts}`);
  }

  pi.registerCommand("goal", {
    description: "Set, inspect, or clear a prompt-backed completion goal",
    getArgumentCompletions: (prefix: string) => {
      const items = ["status", "clear", "--max-attempts", "--max-turns", "--evaluator-model", "--"].map((value) => ({
        value,
        label: value,
      }));
      const matches = items.filter((item) => item.value.startsWith(prefix));
      return matches.length > 0 ? matches : null;
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
        schemaVersion: 2,
        id: newId("goal"),
        kind: "prompt",
        active: true,
        prompt: parsed.prompt,
        attempts: 0,
        maxAttempts: parsed.maxAttempts,
        evaluatorFailures: 0,
        evaluatorModel: parsed.evaluatorModel ?? modelSpecFor(ctx),
        createdAt: now,
        updatedAt: now,
      };

      activeGoal = goal;
      persist("set", goal);
      updateStatus(ctx);
      ctx.ui.notify(formatSet(goal), "info");
      pi.sendUserMessage(buildKickoffPrompt(goal));
    },
  });

  pi.on("session_start", (_event, ctx) => {
    syncGoal(ctx);
  });

  pi.on("session_shutdown", (_event, ctx) => {
    ctx.ui.setStatus(STATUS_KEY, undefined);
  });

  pi.on("before_agent_start", async (event, ctx) => {
    const goal = syncGoal(ctx);
    if (!goal) return;

    return {
      systemPrompt: `${event.systemPrompt}\n\n${buildSystemGoalBlock(goal)}`,
    };
  });

  pi.on("agent_end", async (event, ctx) => {
    if (handlingAgentEnd) return;
    const goal = syncGoal(ctx);
    if (!goal) return;

    handlingAgentEnd = true;
    try {
      await evaluateGoalProgress(goal, latestAssistantText(event), ctx);
    } finally {
      handlingAgentEnd = false;
    }
  });

  async function evaluateGoalProgress(goal: GoalState, assistantText: string, ctx: ExtensionContext): Promise<void> {
    const marker = markerFromText(assistantText);
    const snapshot = await collectRepoSnapshot(pi, ctx);
    const evaluation = await runGoalEvaluator(goal, assistantText, marker, snapshot, ctx);
    const updatedGoal: GoalState = {
      ...goal,
      lastAssistantText: trimText(assistantText, 4000),
      lastEvaluation: evaluation,
      evaluatorFailures: evaluation.error ? goal.evaluatorFailures + 1 : 0,
      updatedAt: new Date().toISOString(),
    };
    if (marker) updatedGoal.lastMarker = marker;

    if (evaluation.error) {
      if (updatedGoal.evaluatorFailures >= DEFAULT_MAX_EVALUATOR_FAILURES) {
        const stoppedAt = new Date().toISOString();
        persist("stop", {
          ...updatedGoal,
          active: false,
          stoppedAt,
          stopReason: `goal evaluator failed ${updatedGoal.evaluatorFailures} time(s)`,
        }, "goal evaluator failed");
        activeGoal = undefined;
        updateStatus(ctx);
        ctx.ui.notify(`Goal stopped because the evaluator failed ${updatedGoal.evaluatorFailures} time(s): ${evaluation.error}`, "error");
        return;
      }

      await continueGoal(updatedGoal, ctx, `Goal evaluator failed: ${evaluation.error}`);
      return;
    }

    if (evaluation.status === "complete") {
      const completedAt = new Date().toISOString();
      persist("complete", { ...updatedGoal, active: false, completedAt }, evaluation.reason);
      activeGoal = undefined;
      updateStatus(ctx);
      ctx.ui.notify(`Goal complete: ${oneLine(goal.prompt)}`, "info");
      return;
    }

    if (evaluation.status === "blocked") {
      const stoppedAt = new Date().toISOString();
      persist("stop", {
        ...updatedGoal,
        active: false,
        stoppedAt,
        stopReason: evaluation.reason || "goal evaluator marked blocked",
      }, evaluation.reason || "goal evaluator marked blocked");
      activeGoal = undefined;
      updateStatus(ctx);
      ctx.ui.notify(`Goal blocked: ${evaluation.reason || oneLine(goal.prompt)}`, "warning");
      return;
    }

    await continueGoal(updatedGoal, ctx, evaluation.reason);
  }

  async function continueGoal(goal: GoalState, ctx: ExtensionContext, reason: string): Promise<void> {
    const attempt = goal.attempts + 1;
    const runningGoal: GoalState = {
      ...goal,
      attempts: attempt,
      updatedAt: new Date().toISOString(),
    };

    if (attempt >= goal.maxAttempts) {
      const stoppedAt = new Date().toISOString();
      persist("stop", {
        ...runningGoal,
        active: false,
        stoppedAt,
        stopReason: `max attempts reached (${goal.maxAttempts})`,
      }, "max attempts reached");
      activeGoal = undefined;
      updateStatus(ctx);
      ctx.ui.notify(`Goal stopped after ${attempt} continuation attempt(s); max attempts reached. Run /goal to set a new goal.`, "error");
      return;
    }

    activeGoal = runningGoal;
    persist("progress", runningGoal);
    updateStatus(ctx);
    ctx.ui.notify(`Goal evaluator says to continue (attempt ${attempt}/${goal.maxAttempts}).`, "info");
    pi.sendUserMessage(buildSelfCheckFollowUp(runningGoal, reason), { deliverAs: "followUp" });
  }
}

function parseGoalArgs(input: string): ParsedGoalArgs | string {
  let tokens: string[];
  try {
    tokens = tokenize(input);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }

  const prompt: string[] = [];
  let maxAttempts = DEFAULT_MAX_ATTEMPTS;
  let evaluatorModel: string | undefined;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === "--") {
      prompt.push(...tokens.slice(i + 1));
      break;
    }

    if (token === "--verify" || token.startsWith("--verify=")) {
      return "/goal no longer runs verifier commands. Pass a prompt that describes the goal and exit criteria instead.";
    }

    if (token === "--timeout" || token.startsWith("--timeout=") || token === "--output-chars" || token.startsWith("--output-chars=")) {
      return "/goal no longer accepts command-verifier options. Use --max-attempts plus a goal prompt instead.";
    }

    if (token === "--max-attempts" || token.startsWith("--max-attempts=") || token === "--max-turns" || token.startsWith("--max-turns=")) {
      const flag = token.startsWith("--max-turns") ? "--max-turns" : "--max-attempts";
      const option = readOptionValue(token, flag, tokens, i);
      if (!option.ok) return option.error;
      i = option.index;
      const parsed = parseBoundedInteger(option.value, 1, MAX_ATTEMPTS_LIMIT, "max attempts");
      if (typeof parsed === "string") return parsed;
      maxAttempts = parsed;
      continue;
    }

    if (token === "--evaluator-model" || token.startsWith("--evaluator-model=")) {
      const option = readOptionValue(token, "--evaluator-model", tokens, i);
      if (!option.ok) return option.error;
      i = option.index;
      if (option.value.trim() === "") return "Missing model after --evaluator-model.";
      evaluatorModel = option.value.trim();
      continue;
    }

    if (token.startsWith("--")) {
      return `Unknown /goal option: ${token}`;
    }

    prompt.push(token);
  }

  const promptText = prompt.join(" ").trim();
  if (promptText === "") return "Missing goal prompt. Describe the goal and exit criteria after /goal.";
  return { prompt: promptText, maxAttempts, evaluatorModel };
}

function readOptionValue(
  token: string,
  flag: string,
  tokens: string[],
  index: number,
): { ok: true; value: string; index: number } | { ok: false; error: string } {
  if (token.startsWith(`${flag}=`)) {
    return { ok: true, value: token.slice(flag.length + 1), index };
  }
  const next = tokens[index + 1];
  if (next === undefined) return { ok: false, error: `Missing value for ${flag}.` };
  return { ok: true, value: next, index: index + 1 };
}

function parseBoundedInteger(value: string, min: number, max: number, label: string): number | string {
  if (!/^\d+$/.test(value)) return `Invalid ${label}: ${value}`;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    return `Invalid ${label}: ${value} (expected ${min}-${max}).`;
  }
  return parsed;
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
      escaping = false;
      tokenStarted = true;
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

async function collectRepoSnapshot(pi: ExtensionAPI, ctx: ExtensionContext): Promise<string> {
  const parts: string[] = [];

  for (const [label, args] of [
    ["git status --short", ["status", "--short"]],
    ["git diff --stat", ["diff", "--stat"]],
  ] as const) {
    try {
      const result = await pi.exec("git", [...args], { cwd: ctx.cwd, timeout: 5000 });
      const output = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n");
      parts.push(`${label} (exit ${result.code}${result.killed ? ", killed" : ""}):\n${output || "(no output)"}`);
    } catch (error) {
      parts.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return trimText(parts.join("\n\n"), SNAPSHOT_OUTPUT_LIMIT);
}

async function runGoalEvaluator(
  goal: GoalState,
  assistantText: string,
  marker: GoalMarker | undefined,
  repoSnapshot: string,
  ctx: ExtensionContext,
): Promise<GoalEvaluation> {
  const started = Date.now();
  const prompt = buildEvaluatorPrompt(goal, assistantText, marker, repoSnapshot);
  const args = [
    "--mode",
    "json",
    "-p",
    "--no-session",
    "--no-extensions",
    "--no-skills",
    "--no-prompt-templates",
    "--no-tools",
    "--system-prompt",
    evaluatorSystemPrompt(),
    prompt,
  ];
  if (goal.evaluatorModel) args.splice(0, 0, "--model", goal.evaluatorModel);

  const invocation = getPiInvocation(args);
  const child = spawn(invocation.command, invocation.args, {
    cwd: ctx.cwd,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
    setTimeout(() => {
      if (!child.killed) child.kill("SIGKILL");
    }, 5000).unref();
  }, EVALUATOR_TIMEOUT_MS);

  child.stdout?.on("data", (data) => {
    stdout += data.toString();
    if (stdout.length > EVALUATOR_OUTPUT_LIMIT * 4) stdout = stdout.slice(-EVALUATOR_OUTPUT_LIMIT * 2);
  });
  child.stderr?.on("data", (data) => {
    stderr += data.toString();
    if (stderr.length > EVALUATOR_OUTPUT_LIMIT * 2) stderr = stderr.slice(-EVALUATOR_OUTPUT_LIMIT);
  });

  const exitCode = await new Promise<number | null>((resolve) => {
    child.on("close", (code) => resolve(code));
    child.on("error", () => resolve(1));
  });
  clearTimeout(timeout);

  const durationMs = Date.now() - started;
  const evaluatedAt = new Date().toISOString();
  const rawOutput = trimText(finalAssistantOutputFromJsonMode(stdout) || stdout.trim(), EVALUATOR_OUTPUT_LIMIT);

  if (timedOut) {
    return evaluatorError(`timed out after ${Math.round(EVALUATOR_TIMEOUT_MS / 1000)}s`, rawOutput, exitCode, durationMs, evaluatedAt);
  }
  if (exitCode !== 0) {
    return evaluatorError(`exited ${exitCode}${stderr.trim() ? `: ${trimText(stderr.trim(), 1000)}` : ""}`, rawOutput, exitCode, durationMs, evaluatedAt);
  }

  const parsed = parseEvaluationJson(rawOutput);
  if (!parsed) {
    return evaluatorError("did not return valid evaluation JSON", rawOutput, exitCode, durationMs, evaluatedAt);
  }

  return {
    status: parsed.status,
    confidence: parsed.confidence,
    reason: parsed.reason,
    nextInstruction: parsed.nextInstruction,
    rawOutput,
    exitCode: exitCode ?? undefined,
    durationMs,
    evaluatedAt,
  };
}

function evaluatorError(
  error: string,
  rawOutput: string,
  exitCode: number | null,
  durationMs: number,
  evaluatedAt: string,
): GoalEvaluation {
  return {
    status: "continue",
    confidence: "low",
    reason: error,
    error,
    rawOutput,
    exitCode: exitCode ?? undefined,
    durationMs,
    evaluatedAt,
  };
}

function evaluatorSystemPrompt(): string {
  return [
    "You are a strict goal completion evaluator for a coding agent.",
    "Judge whether the worker's latest response and repository snapshot satisfy the user's goal and exit criteria.",
    "Do not reward intention or progress. Mark complete only when the exit criteria are actually satisfied by the provided evidence.",
    "Return only JSON with this shape:",
    '{"status":"complete|continue|blocked","confidence":"low|medium|high","reason":"short reason","nextInstruction":"optional next instruction for the worker"}',
    "Use blocked only when the worker cannot make progress without user input or an external system change.",
  ].join("\n");
}

function buildEvaluatorPrompt(goal: GoalState, assistantText: string, marker: GoalMarker | undefined, repoSnapshot: string): string {
  return [
    "Evaluate this goal.",
    "",
    "Goal and exit criteria:",
    goal.prompt,
    "",
    `Worker marker hint: ${marker ?? "none"}. Treat markers as claims to verify, not proof.`,
    "",
    "Latest worker response:",
    trimText(assistantText || "(empty)", 12000),
    "",
    "Repository snapshot:",
    repoSnapshot || "(unavailable)",
    "",
    "Return only JSON. If the evidence is insufficient to prove the exit criteria, use status \"continue\" and explain what the worker should check next.",
  ].join("\n");
}

function parseEvaluationJson(text: string): Pick<GoalEvaluation, "status" | "confidence" | "reason" | "nextInstruction"> | undefined {
  const candidate = extractJsonObject(text);
  if (!candidate) return undefined;

  try {
    const parsed = JSON.parse(candidate) as Record<string, unknown>;
    const status = parsed.status;
    const confidence = parsed.confidence;
    const reason = parsed.reason;
    const nextInstruction = parsed.nextInstruction;
    if (status !== "complete" && status !== "continue" && status !== "blocked") return undefined;
    if (confidence !== "low" && confidence !== "medium" && confidence !== "high") return undefined;
    if (typeof reason !== "string" || reason.trim() === "") return undefined;
    return {
      status,
      confidence,
      reason: reason.trim(),
      nextInstruction: typeof nextInstruction === "string" && nextInstruction.trim() ? nextInstruction.trim() : undefined,
    };
  } catch {
    return undefined;
  }
}

function extractJsonObject(text: string): string | undefined {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const source = fenced ? fenced[1] : text;
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return undefined;
  return source.slice(start, end + 1);
}

function finalAssistantOutputFromJsonMode(stdout: string): string {
  let output = "";
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const event = JSON.parse(trimmed) as {
        type?: unknown;
        message?: { role?: unknown; content?: unknown };
        messages?: Array<{ role?: unknown; content?: unknown }>;
      };
      const message = event.message;
      if ((event.type === "message_end" || event.type === "turn_end") && message?.role === "assistant") {
        const text = textFromContent(message.content);
        if (text) output = text;
        continue;
      }
      if (event.type === "agent_end" && Array.isArray(event.messages)) {
        const text = latestAssistantText(event);
        if (text) output = text;
      }
    } catch {
      // Ignore non-JSON noise from the child process.
    }
  }
  return output;
}

function getPiInvocation(args: string[]): { command: string; args: string[] } {
  const currentScript = process.argv[1];
  const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");
  if (currentScript && !isBunVirtualScript && fs.existsSync(currentScript)) {
    return { command: process.execPath, args: [currentScript, ...args] };
  }

  const execName = path.basename(process.execPath).toLowerCase();
  const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName);
  if (!isGenericRuntime) {
    return { command: process.execPath, args };
  }

  return { command: "pi", args };
}

function modelSpecFor(ctx: ExtensionContext): string | undefined {
  if (!ctx.model) return undefined;
  return `${ctx.model.provider}/${ctx.model.id}`;
}

function buildSystemGoalBlock(goal: GoalState): string {
  return [
    "A goal is active.",
    "The user's goal prompt and exit criteria are:",
    goal.prompt,
    "",
    `After each response, check your work against that goal. If the goal and exit criteria are satisfied, put ${COMPLETE_MARKER} at the start of a line in your response.`,
    `If you cannot continue without user input or an external blocker is present, put ${BLOCKED_MARKER} at the start of a line and explain why.`,
    `If neither marker applies, continue working toward the goal. Remaining automatic continuation attempts: ${Math.max(0, goal.maxAttempts - goal.attempts)}.`,
  ].join("\n");
}

function buildKickoffPrompt(goal: GoalState): string {
  return [
    "Start working on this goal.",
    "",
    "Goal and exit criteria:",
    goal.prompt,
    "",
    `When the goal and exit criteria are satisfied, put ${COMPLETE_MARKER} at the start of a line in your response.`,
    `If blocked, put ${BLOCKED_MARKER} at the start of a line and explain what user input or external change is needed.`,
  ].join("\n");
}

function buildSelfCheckFollowUp(goal: GoalState, reason: string): string {
  const nextInstruction = goal.lastEvaluation?.nextInstruction;
  return [
    `The goal evaluator says the goal is not complete (attempt ${goal.attempts}/${goal.maxAttempts}).`,
    "",
    "Goal and exit criteria:",
    goal.prompt,
    "",
    "Evaluator reason:",
    reason || "The goal is not complete yet.",
    nextInstruction ? `\nNext instruction from evaluator:\n${nextInstruction}` : "",
    "",
    `When the goal and exit criteria are satisfied, put ${COMPLETE_MARKER} at the start of a line and give a concise summary.`,
    `If you are blocked, put ${BLOCKED_MARKER} at the start of a line and describe the blocker.`,
    "If the goal is not complete and you are not blocked, continue working now. Do not stop just to summarize progress.",
  ].filter(Boolean).join("\n");
}

function latestAssistantText(event: unknown): string {
  const messages = Array.isArray((event as { messages?: unknown }).messages) ? (event as { messages: unknown[] }).messages : [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i] as { role?: unknown; content?: unknown };
    if (message?.role === "assistant") return textFromContent(message.content);
  }
  return "";
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      if (typeof block === "string") return block;
      if (!block || typeof block !== "object") return "";
      const item = block as { type?: unknown; text?: unknown; content?: unknown };
      if (typeof item.text === "string") return item.text;
      if (typeof item.content === "string") return item.content;
      return "";
    })
    .filter((text) => text !== "")
    .join("\n");
}

function markerFromText(text: string): GoalMarker | undefined {
  const normalized = text.toLowerCase();
  if (/(^|\n)\s*\[goal:complete\](\s|$)/i.test(normalized)) return "complete";
  if (/(^|\n)\s*\[goal:blocked\](\s|$)/i.test(normalized)) return "blocked";
  return undefined;
}

function trimText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `[truncated to last ${maxChars} chars]\n${text.slice(Math.max(0, text.length - maxChars))}`;
}

function usage(): string {
  return [
    "Usage:",
    '  /goal "prompt describing the goal and exit criteria"',
    '  /goal --max-attempts 5 --evaluator-model "provider/model" "prompt describing the goal and exit criteria"',
    "  /goal status",
    "  /goal clear",
  ].join("\n");
}

function formatSet(goal: GoalState): string {
  return [
    "Set /goal prompt:",
    goal.prompt,
    "",
    `Attempts: 0/${goal.maxAttempts}. A separate evaluator will check completion after each turn.`,
    goal.evaluatorModel ? `Evaluator model: ${goal.evaluatorModel}.` : "Evaluator model: Pi default.",
  ].join("\n");
}

function formatStatus(goal: GoalState): string {
  return [
    "Active /goal prompt:",
    goal.prompt,
    "",
    `Attempts: ${goal.attempts}/${goal.maxAttempts}.`,
    goal.evaluatorModel ? `Evaluator model: ${goal.evaluatorModel}.` : "Evaluator model: Pi default.",
    goal.lastEvaluation ? `Last evaluator result: ${goal.lastEvaluation.status} (${goal.lastEvaluation.confidence}) - ${goal.lastEvaluation.reason}` : "Last evaluator result: none.",
    goal.lastMarker ? `Last worker marker: ${goal.lastMarker}.` : "Last worker marker: none.",
  ].join("\n");
}

function oneLine(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length <= 120 ? compact : `${compact.slice(0, 117)}...`;
}

function isGoalEntry(value: unknown): value is GoalEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<GoalEntry>;
  return entry.schemaVersion === 1 && typeof entry.action === "string";
}

function isPromptGoalState(value: unknown): value is GoalState {
  if (!value || typeof value !== "object") return false;
  const goal = value as Partial<PromptGoalState>;
  return (
    goal.schemaVersion === 2 &&
    goal.kind === "prompt" &&
    goal.active === true &&
    typeof goal.id === "string" &&
    typeof goal.prompt === "string" &&
    typeof goal.attempts === "number" &&
    typeof goal.maxAttempts === "number" &&
    (goal.evaluatorFailures === undefined || typeof goal.evaluatorFailures === "number") &&
    typeof goal.createdAt === "string" &&
    typeof goal.updatedAt === "string"
  );
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
