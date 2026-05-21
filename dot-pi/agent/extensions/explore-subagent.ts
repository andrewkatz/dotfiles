import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Message } from "@earendil-works/pi-ai";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Text } from "@earendil-works/pi-tui";
import { Type, type Static } from "typebox";

const CODEX_EXPLORE_MODEL = "openai-codex/gpt-5.3-codex-spark";
const FALLBACK_MODEL = CODEX_EXPLORE_MODEL;
const READ_ONLY_TOOLS = "read,grep,find,ls";
const MAX_OUTPUT_CHARS = 8_000;
const MAX_PARALLEL_TASKS = 8;
const MAX_CONCURRENCY = 4;
const PARALLEL_PROGRESS_THROTTLE_MS = 1_000;

const exploreTaskSchema = Type.Object({
  task: Type.String({
    description:
      "A focused codebase exploration task. Ask for specific files, symbols, flows, or questions to answer. The subagent returns a concise report.",
  }),
  model: Type.Optional(Type.String({
    description: `Model to use for this exploration task. Defaults to the parent/default explore model; fallback is ${FALLBACK_MODEL}.`,
  })),
  cwd: Type.Optional(Type.String({
    description: "Working directory for this subagent process. Defaults to the current Pi working directory.",
  })),
});

const exploreSubagentSchema = Type.Object({
  task: Type.Optional(Type.String({
    description:
      "A focused codebase exploration task for single-subagent mode. Use tasks for parallel mode.",
  })),
  tasks: Type.Optional(Type.Array(exploreTaskSchema, {
    description: `Independent exploration tasks to run in parallel. Limited to ${MAX_PARALLEL_TASKS} tasks, with up to ${MAX_CONCURRENCY} running at once.`,
    maxItems: MAX_PARALLEL_TASKS,
  })),
  model: Type.Optional(Type.String({
    description: `Model to use for the exploration subagent(s). Defaults automatically from the current main model; fallback is ${FALLBACK_MODEL}.`,
  })),
  cwd: Type.Optional(Type.String({
    description: "Working directory for the subagent process(es). Defaults to the current Pi working directory.",
  })),
});

type ExploreSubagentInput = Static<typeof exploreTaskSchema>;

type UsageStats = {
  turns: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  contextTokens: number;
  model?: string;
};

type ExploreProgress = {
  text: string;
  usage: UsageStats;
};

function getPiInvocation(args: string[]): { command: string; args: string[] } {
  const currentScript = process.argv[1];
  if (currentScript && !currentScript.startsWith("/$bunfs/root/")) {
    return { command: process.execPath, args: [currentScript, ...args] };
  }

  return { command: "pi", args };
}

function finalAssistantText(messages: Message[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role !== "assistant") continue;

    for (const part of message.content) {
      if (part.type === "text") return part.text.trim();
    }
  }

  return "";
}

function truncateOutput(text: string): string {
  if (text.length <= MAX_OUTPUT_CHARS) return text;
  return `${text.slice(0, MAX_OUTPUT_CHARS)}\n\n[explore_subagent output truncated to ${MAX_OUTPUT_CHARS} chars]`;
}

function describeToolStep(toolName: string, args: any): string {
  if (toolName === "read") return `Reading ${args?.path ?? "a relevant file"}`;
  if (toolName === "grep") {
    const pattern = args?.pattern ?? args?.query ?? "a pattern";
    return `Searching for ${JSON.stringify(pattern)}${args?.path ? ` in ${args.path}` : " across the codebase"}`;
  }
  if (toolName === "find") return `Scanning files under ${args?.path ?? args?.dir ?? "."}${args?.name ? ` matching ${args.name}` : ""}`;
  if (toolName === "ls") return `Looking at ${args?.path ?? "the current directory"}`;
  return `Using ${toolName} to gather more context`;
}

function formatCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

function friendlyUsageLine(usage: UsageStats): string {
  const tokens = usage.input || usage.output || usage.cacheRead || usage.cacheWrite
    ? `Tokens: ${formatCount(usage.input)} in / ${formatCount(usage.output)} out${usage.cacheRead ? ` / ${formatCount(usage.cacheRead)} cached` : ""}`
    : "Tokens: waiting for first response";
  const cost = usage.cost ? ` · Cost: $${usage.cost.toFixed(4)}` : "";
  const turns = usage.turns ? ` · ${usage.turns} turn${usage.turns === 1 ? "" : "s"}` : "";
  return `${tokens}${cost}${turns}`;
}

function resolveExploreModel(currentModel?: { provider?: string; id?: string }): string {
  const provider = currentModel?.provider ?? "";
  const id = currentModel?.id ?? "";
  const normalized = `${provider}/${id}`.toLowerCase();

  if (provider === "openai-codex" || normalized.includes("codex") || normalized.includes("openai/gpt-5")) {
    return CODEX_EXPLORE_MODEL;
  }

  if (provider === "anthropic") {
    return "anthropic/claude-haiku-4-5";
  }

  if (provider === "openrouter" && id.startsWith("anthropic/")) {
    return "openrouter/anthropic/claude-haiku-4.5";
  }

  if (provider === "openrouter" && id.startsWith("openai/")) {
    return "openrouter/openai/gpt-5.4-mini";
  }

  return FALLBACK_MODEL;
}

function makeSystemPrompt(): string {
  return `You are explore, a fast read-only codebase exploration subagent.

Goal: answer the parent agent's specific codebase question with the least context and tool usage possible.

Rules:
- Read-only: never modify files or claim you did.
- Use only read/search/list tools.
- Prefer grep/find first; read only the smallest relevant sections.
- Stop once you can answer with useful confidence. Avoid exhaustive audits unless explicitly requested.
- Do not paste large code excerpts. Use paths, line numbers, symbols, and tiny snippets only when necessary.
- Keep the final report under ~900 words unless the task explicitly asks for more.

Return:
- Conclusion.
- Key files/symbols and why they matter.
- Relevant flow/details.
- Recommended next steps.
- Open questions/confidence, if useful.`;
}

async function runExploreSubagent(input: ExploreSubagentInput, defaultCwd: string, signal?: AbortSignal, onProgress?: (progress: ExploreProgress) => void): Promise<{
  exitCode: number;
  output: string;
  stderr: string;
  usage: UsageStats;
}> {
  const model = input.model ?? FALLBACK_MODEL;
  const promptDir = mkdtempSync(join(tmpdir(), "pi-explore-subagent-"));
  const promptPath = join(promptDir, "SYSTEM.md");
  writeFileSync(promptPath, makeSystemPrompt(), { encoding: "utf8", mode: 0o600 });

  const args = [
    "--mode", "json",
    "-p",
    "--no-session",
    "--no-extensions",
    "--no-skills",
    "--no-prompt-templates",
    "--no-themes",
    "--no-context-files",
    "--model", model,
    "--thinking", "minimal",
    "--tools", READ_ONLY_TOOLS,
    "--system-prompt", promptPath,
    `Explore task: ${input.task}`,
  ];

  const messages: Message[] = [];
  const usage: UsageStats = {
    turns: 0,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0,
    contextTokens: 0,
    model,
  };
  let stderr = "";
  let wasAborted = false;

  const progress = (text: string) => onProgress?.({ text, usage: { ...usage } });

  try {
    const exitCode = await new Promise<number>((resolve) => {
      const invocation = getPiInvocation(args);
      const proc = spawn(invocation.command, invocation.args, {
        cwd: input.cwd ?? defaultCwd,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let buffer = "";
      const processLine = (line: string) => {
        if (!line.trim()) return;

        let event: any;
        try {
          event = JSON.parse(line);
        } catch {
          return;
        }

        if (event.type === "turn_start") {
          progress(usage.turns === 0 ? "Making an exploration plan" : "Following up on the first findings");
          return;
        }

        if (event.type === "tool_execution_start") {
          progress(describeToolStep(event.toolName, event.args));
          return;
        }

        if (event.type !== "message_end" || !event.message) return;

        const message = event.message as Message;
        messages.push(message);
        if (message.role !== "assistant") return;

        usage.turns += 1;
        if (message.model) usage.model = message.model;
        if (!message.usage) return;

        usage.input += message.usage.input || 0;
        usage.output += message.usage.output || 0;
        usage.cacheRead += message.usage.cacheRead || 0;
        usage.cacheWrite += message.usage.cacheWrite || 0;
        usage.cost += message.usage.cost?.total || 0;
        usage.contextTokens = message.usage.totalTokens || usage.contextTokens;
        progress("Summarizing what was found");
      };

      proc.stdout.on("data", (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) processLine(line);
      });

      proc.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      proc.on("close", (code) => {
        if (buffer.trim()) processLine(buffer);
        resolve(code ?? 0);
      });

      proc.on("error", (error) => {
        stderr += `\n${error.message}`;
        resolve(1);
      });

      const abort = () => {
        wasAborted = true;
        proc.kill("SIGTERM");
        setTimeout(() => proc.kill("SIGKILL"), 5000).unref();
      };

      if (signal?.aborted) abort();
      else signal?.addEventListener("abort", abort, { once: true });
    });

    if (wasAborted) throw new Error("Explore subagent was aborted");

    return {
      exitCode,
      output: truncateOutput(finalAssistantText(messages) || "(no output)"),
      stderr,
      usage,
    };
  } finally {
    rmSync(promptDir, { recursive: true, force: true });
  }
}

function usageLine(usage: UsageStats): string {
  const parts = [`${usage.turns} turn${usage.turns === 1 ? "" : "s"}`];
  if (usage.input) parts.push(`in:${usage.input}`);
  if (usage.output) parts.push(`out:${usage.output}`);
  if (usage.cacheRead) parts.push(`cache-read:${usage.cacheRead}`);
  if (usage.cacheWrite) parts.push(`cache-write:${usage.cacheWrite}`);
  if (usage.cost) parts.push(`$${usage.cost.toFixed(4)}`);
  if (usage.contextTokens) parts.push(`ctx:${usage.contextTokens}`);
  if (usage.model) parts.push(usage.model);
  return parts.join(" ");
}

function emptyUsage(model?: string): UsageStats {
  return {
    turns: 0,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0,
    contextTokens: 0,
    model,
  };
}

function mergeUsage(usages: UsageStats[], fallbackModel?: string): UsageStats {
  const total = emptyUsage(fallbackModel);
  for (const usage of usages) {
    total.turns += usage.turns;
    total.input += usage.input;
    total.output += usage.output;
    total.cacheRead += usage.cacheRead;
    total.cacheWrite += usage.cacheWrite;
    total.cost += usage.cost;
    total.contextTokens = Math.max(total.contextTokens, usage.contextTokens);
    total.model = total.model === usage.model ? total.model : "multiple";
  }
  return total;
}

function taskPreview(task: string, length = 80): string {
  const singleLine = task.replace(/\s+/g, " ").trim();
  return singleLine.length > length ? `${singleLine.slice(0, length)}...` : singleLine;
}

async function mapWithConcurrencyLimit<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await mapper(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "explore_subagent",
    label: "Explore Subagent",
    description:
      "Delegate focused codebase exploration to a lower-cost, isolated, read-only Pi subagent. Use this to search/read broadly without filling the main context.",
    promptSnippet:
      "Delegate focused codebase exploration to a lower-cost isolated read-only subagent and receive a concise report.",
    promptGuidelines: [
      "Use explore_subagent before implementation when you need to discover files, symbols, architecture, or behavior across a codebase.",
      "Use explore_subagent instead of doing broad read/search loops in the main context; give it a focused task and rely on its concise report.",
      "For independent codebase questions, pass a tasks array so multiple explorers can run concurrently.",
      "Do not use explore_subagent for edits or commands that need to change files; it is read-only.",
    ],
    parameters: exploreSubagentSchema,
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const model = params.model ?? resolveExploreModel(ctx.model);

      if (params.task && params.tasks?.length) {
        return {
          content: [{ type: "text", text: "Invalid parameters. Provide either task for single mode or tasks for parallel mode, not both." }],
          isError: true,
        };
      }

      if (params.tasks?.length) {
        if (params.tasks.length > MAX_PARALLEL_TASKS) {
          return {
            content: [{ type: "text", text: `Too many explore tasks: ${params.tasks.length}. Maximum is ${MAX_PARALLEL_TASKS}.` }],
            isError: true,
          };
        }

        type ParallelResult = Awaited<ReturnType<typeof runExploreSubagent>> & {
          task: string;
          index: number;
        };

        const results: Array<ParallelResult | undefined> = new Array(params.tasks.length);
        const statuses = params.tasks.map(() => "queued");
        let lastParallelProgressAt = 0;
        let pendingParallelProgress: ReturnType<typeof setTimeout> | undefined;
        const emitParallelProgress = (force = false) => {
          if (!onUpdate) return;

          const now = Date.now();
          const elapsed = now - lastParallelProgressAt;
          const render = () => {
            if (pendingParallelProgress) clearTimeout(pendingParallelProgress);
            pendingParallelProgress = undefined;
            lastParallelProgressAt = Date.now();
            const done = results.filter(Boolean).length;
            const running = statuses.filter((status) => status === "running").length;
            const failed = statuses.filter((status) => status === "failed").length;
            const queued = statuses.filter((status) => status === "queued").length;
            onUpdate({
              content: [{
                type: "text",
                text: `Parallel explore: ${done}/${params.tasks!.length} done, ${running} running, ${queued} queued${failed ? `, ${failed} failed` : ""}`,
              }],
            });
          };

          if (force || elapsed >= PARALLEL_PROGRESS_THROTTLE_MS) {
            render();
          } else if (!pendingParallelProgress) {
            pendingParallelProgress = setTimeout(render, PARALLEL_PROGRESS_THROTTLE_MS - elapsed);
          }
        };
        emitParallelProgress(true);

        const completed = await mapWithConcurrencyLimit(params.tasks, MAX_CONCURRENCY, async (task, index) => {
          const taskModel = task.model ?? model;
          statuses[index] = "running";
          emitParallelProgress();

          let result: Awaited<ReturnType<typeof runExploreSubagent>>;
          try {
            result = await runExploreSubagent(
              { task: task.task, model: taskModel, cwd: task.cwd ?? params.cwd },
              ctx.cwd,
              signal,
              () => emitParallelProgress(),
            );
          } catch (error) {
            if (signal?.aborted) throw error;
            result = {
              exitCode: 1,
              output: "(no output)",
              stderr: error instanceof Error ? error.message : String(error),
              usage: emptyUsage(taskModel),
            };
          }

          const parallelResult = { ...result, task: task.task, index };
          results[index] = parallelResult;
          statuses[index] = result.exitCode === 0 ? "done" : "failed";
          emitParallelProgress(true);
          return parallelResult;
        });
        if (pendingParallelProgress) clearTimeout(pendingParallelProgress);
        emitParallelProgress(true);

        const successCount = completed.filter((result) => result.exitCode === 0).length;
        const usage = mergeUsage(completed.map((result) => result.usage), model);
        const sections = completed.map((result) => {
          const heading = `## ${result.index + 1}. ${taskPreview(result.task)}`;
          if (result.exitCode === 0) return `${heading}\n${result.output}`;
          return `${heading}\nExplore subagent failed with exit code ${result.exitCode}.\n\nSTDERR:\n${result.stderr}\n\nOutput:\n${result.output}`;
        });

        return {
          content: [{
            type: "text",
            text: `Parallel explore: ${successCount}/${completed.length} succeeded\n\n${sections.join("\n\n")}`,
          }],
          details: {
            mode: "parallel",
            results: completed,
            model: usage.model,
            usage,
            usageLine: usageLine(usage),
          },
          isError: successCount !== completed.length,
        };
      }

      if (!params.task) {
        return {
          content: [{ type: "text", text: "Invalid parameters. Provide either task for single mode or tasks for parallel mode." }],
          isError: true,
        };
      }

      const progressLines = [`Exploring with ${model}...`];
      const emitProgress = (usage?: UsageStats) => {
        const recentLines = progressLines.slice(-12).map((line) => `• ${line}`);
        const tokenLine = usage ? `\n\n${friendlyUsageLine(usage)}` : "";
        onUpdate?.({ content: [{ type: "text", text: `${recentLines.join("\n")}${tokenLine}` }] });
      };
      emitProgress();

      const result = await runExploreSubagent({ task: params.task, model, cwd: params.cwd }, ctx.cwd, signal, (progress) => {
        progressLines.push(progress.text);
        emitProgress(progress.usage);
      });
      const text = result.exitCode === 0
        ? result.output
        : `Explore subagent failed with exit code ${result.exitCode}.\n\nSTDERR:\n${result.stderr}\n\nOutput:\n${result.output}`;

      return {
        content: [{ type: "text", text }],
        details: {
          exitCode: result.exitCode,
          model: result.usage.model,
          usage: result.usage,
          usageLine: usageLine(result.usage),
          stderr: result.stderr,
        },
      };
    },
    renderCall(args, theme) {
      if (args.tasks?.length) {
        const lines = args.tasks.slice(0, 3).map((task, index) =>
          `  ${theme.fg("muted", `${index + 1}.`)} ${theme.fg("dim", taskPreview(task.task, 60))}`
        );
        if (args.tasks.length > 3) lines.push(`  ${theme.fg("muted", `... +${args.tasks.length - 3} more`)}`);
        return new Text(
          `${theme.fg("toolTitle", theme.bold("explore_subagent"))} ${theme.fg("accent", `parallel (${args.tasks.length} tasks)`)} ${theme.fg("muted", args.model ?? "auto")}\n` +
            lines.join("\n"),
          0,
          0,
        );
      }

      const task = args.task ? taskPreview(args.task) : "...";
      return new Text(
        `${theme.fg("toolTitle", theme.bold("explore_subagent"))} ${theme.fg("muted", args.model ?? "auto")}\n` +
          `  ${theme.fg("dim", task)}`,
        0,
        0,
      );
    },
    renderResult(result, _options, theme) {
      const text = result.content[0]?.type === "text" ? result.content[0].text : "(no output)";
      const usage = (result.details as { usageLine?: string } | undefined)?.usageLine;
      return new Text(usage ? `${text}\n${theme.fg("dim", usage)}` : text, 0, 0);
    },
  });

  pi.registerCommand("explore", {
    description: "Run the read-only explore subagent for a focused codebase question",
    handler: async (args, ctx) => {
      const task = args.trim();
      if (!task) {
        ctx.ui.notify("Usage: /explore <focused codebase question>", "error");
        return;
      }

      const result = await runExploreSubagent({ task, model: resolveExploreModel(ctx.model) }, ctx.cwd, ctx.signal);
      ctx.ui.notify(result.exitCode === 0 ? result.output : `Explore failed: ${result.stderr || result.output}`, result.exitCode === 0 ? "info" : "error");
    },
  });
}
