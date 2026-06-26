import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Message } from "@earendil-works/pi-ai";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Text } from "@earendil-works/pi-tui";
import { Type, type Static } from "typebox";

const DEFAULT_MODEL = "openai-codex/gpt-5.3-codex-spark";
const DEFAULT_TOOLS = "read,grep,find,ls";
const DEFAULT_TIMEOUT_SECONDS = 300;
const DEFAULT_MAX_OUTPUT_CHARS = 12_000;
const READ_ONLY_TOOLS = new Set(DEFAULT_TOOLS.split(","));

const subagentSchema = Type.Object({
  prompt: Type.String({ description: "Task or question for the Pi subagent." }),
  model: Type.Optional(Type.String({ description: `Model to use. Defaults to the parent model when available, then ${DEFAULT_MODEL}.` })),
  cwd: Type.Optional(Type.String({ description: "Working directory for the subagent. Defaults to the current Pi working directory." })),
  tools: Type.Optional(Type.String({ description: `Comma-separated Pi tool allowlist. Defaults to read-only tools: ${DEFAULT_TOOLS}.` })),
  allowWriteTools: Type.Optional(Type.Boolean({ description: "Allow non-read-only tools in the subagent. Defaults to false." })),
  timeoutSeconds: Type.Optional(Type.Number({ description: `Maximum subagent runtime in seconds. Defaults to ${DEFAULT_TIMEOUT_SECONDS}.` })),
  maxOutputChars: Type.Optional(Type.Number({ description: `Maximum returned output characters. Defaults to ${DEFAULT_MAX_OUTPUT_CHARS}.` })),
  systemPrompt: Type.Optional(Type.String({ description: "Additional system instructions for the subagent." })),
  thinking: Type.Optional(Type.String({ description: "Thinking level to request from Pi, for example minimal, low, medium, or high. Defaults to minimal." })),
});

type SubagentInput = Static<typeof subagentSchema>;

type UsageStats = {
  turns: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  contextTokens: number;
  model: string;
};

type SubagentResult = {
  output: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
  usage: UsageStats;
};

function resolveModel(currentModel: { provider: string; id: string } | undefined): string {
  return currentModel ? `${currentModel.provider}/${currentModel.id}` : DEFAULT_MODEL;
}

function baseSystemPrompt(extra?: string): string {
  return [
    "You are a focused Pi subagent spawned by another coding agent.",
    "Complete only the delegated task and return a concise report to the parent agent.",
    "Include exact file paths, commands, and errors needed by the parent to continue.",
    "Do not ask follow-up questions unless the task is impossible without clarification.",
    extra?.trim() || "",
  ].filter(Boolean).join("\n");
}

function getPiInvocation(args: string[]): { command: string; args: string[] } {
  const executable = process.argv[1] && process.argv[1].includes("pi") ? process.argv[1] : "pi";
  return { command: executable, args };
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      if (typeof block === "string") return block;
      if (!block || typeof block !== "object") return "";
      const item = block as { text?: unknown; content?: unknown };
      if (typeof item.text === "string") return item.text;
      if (typeof item.content === "string") return item.content;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function outputFromMessages(messages: Message[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role === "assistant") return textFromContent(message.content);
  }
  return "";
}

function toolsFor(input: SubagentInput): string {
  return input.tools?.trim() || DEFAULT_TOOLS;
}

function nonReadOnlyTools(tools: string): string[] {
  return tools
    .split(",")
    .map((tool) => tool.trim())
    .filter(Boolean)
    .filter((tool) => !READ_ONLY_TOOLS.has(tool));
}

function validateToolPolicy(input: SubagentInput): string | undefined {
  const unsafe = nonReadOnlyTools(toolsFor(input));
  if (unsafe.length > 0 && input.allowWriteTools !== true) {
    return `run_subagent tools include non-read-only tools (${unsafe.join(", ")}). Set allowWriteTools: true only when the user explicitly wants delegated write-capable work.`;
  }
  return undefined;
}

function maxOutputChars(input: SubagentInput): number {
  const value = Math.floor(input.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS);
  return Math.min(Math.max(value, 1_000), 50_000);
}

function timeoutMs(input: SubagentInput): number {
  const seconds = Math.floor(input.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS);
  return Math.min(Math.max(seconds, 1), 3_600) * 1_000;
}

function trimOutput(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const head = Math.floor(maxChars * 0.65);
  const tail = maxChars - head;
  return `${text.slice(0, head).trimEnd()}\n\n[run_subagent output truncated: ${text.length.toLocaleString()} chars total]\n\n${text.slice(-tail).trimStart()}`;
}

async function runSubagent(input: SubagentInput, defaultCwd: string, signal?: AbortSignal): Promise<SubagentResult> {
  const policyError = validateToolPolicy(input);
  if (policyError) throw new Error(policyError);

  const model = input.model ?? DEFAULT_MODEL;
  const tools = toolsFor(input);
  const outputLimit = maxOutputChars(input);
  const promptDir = mkdtempSync(join(tmpdir(), "pi-run_subagent-"));
  const systemPath = join(promptDir, "SYSTEM.md");
  writeFileSync(systemPath, baseSystemPrompt(input.systemPrompt), { encoding: "utf8", mode: 0o600 });

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
    "--thinking", input.thinking ?? "minimal",
    "--tools", tools,
    "--system-prompt", systemPath,
    input.prompt,
  ];

  const usage: UsageStats = { turns: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, model };
  const messages: Message[] = [];
  let stderr = "";
  let stdoutBuffer = "";
  let aborted = false;
  let timedOut = false;

  try {
    const exitCode = await new Promise<number>((resolve) => {
      const invocation = getPiInvocation(args);
      const proc = spawn(invocation.command, invocation.args, {
        cwd: input.cwd ?? defaultCwd,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });

      const cleanup = () => {
        signal?.removeEventListener("abort", abort);
        clearTimeout(timeout);
      };
      const abort = () => {
        aborted = true;
        proc.kill("SIGTERM");
      };
      const timeout = setTimeout(() => {
        timedOut = true;
        proc.kill("SIGTERM");
      }, timeoutMs(input));
      signal?.addEventListener("abort", abort, { once: true });

      const handleLine = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        try {
          const event = JSON.parse(trimmed) as {
            type?: unknown;
            message?: Message;
            messages?: Message[];
            usage?: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number; cost?: number; contextTokens?: number };
          };
          if (event.message?.role === "assistant") messages.push(event.message);
          if (event.type === "agent_end" && Array.isArray(event.messages)) {
            messages.push(...event.messages.filter((message) => message.role === "assistant"));
          }
          if (event.type === "agent_end" && event.usage) {
              usage.turns += 1;
              usage.input += event.usage.inputTokens ?? 0;
              usage.output += event.usage.outputTokens ?? 0;
              usage.cacheRead += event.usage.cacheReadTokens ?? 0;
              usage.cacheWrite += event.usage.cacheWriteTokens ?? 0;
              usage.cost += event.usage.cost ?? 0;
            usage.contextTokens = event.usage.contextTokens ?? usage.contextTokens;
          }
        } catch {
          stderr += `${line}\n`;
        }
      };

      proc.stdout.on("data", (chunk: Buffer) => {
        stdoutBuffer += chunk.toString("utf8");
        const lines = stdoutBuffer.split("\n");
        stdoutBuffer = lines.pop() ?? "";
        for (const line of lines) handleLine(line);
      });
      proc.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
      proc.on("close", (code) => {
        if (stdoutBuffer) handleLine(stdoutBuffer);
        cleanup();
        resolve(code ?? (aborted ? 130 : timedOut ? 124 : 1));
      });
      proc.on("error", () => {
        cleanup();
        resolve(1);
      });
    });

    const timeoutPrefix = timedOut ? `Subagent timed out after ${Math.round(timeoutMs(input) / 1000)}s.\n\n` : "";
    const output = trimOutput(timeoutPrefix + (outputFromMessages(messages) || stderr.trim() || "(run_subagent returned no text)"), outputLimit);
    return { output, stderr: trimOutput(stderr.trim(), outputLimit), exitCode, timedOut, usage };
  } finally {
    rmSync(promptDir, { recursive: true, force: true });
  }
}

function usageLine(usage: UsageStats): string {
  const cost = usage.cost > 0 ? `, $${usage.cost.toFixed(4)}` : "";
  return `subagent usage: ${usage.model}, in ${usage.input}, out ${usage.output}, cache read ${usage.cacheRead}, cache write ${usage.cacheWrite}${cost}`;
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "run_subagent",
    label: "Subagent",
    description: "Spawn a focused Pi subagent with configurable model, tools, working directory, and system prompt.",
    promptSnippet: "Use run_subagent for delegated work that should run in an isolated Pi process and return a concise report.",
    promptGuidelines: [
      "Use run_subagent for self-contained tasks that benefit from isolation or a separate context window.",
      "Use the default read-only tools for investigation; only pass write-capable tools with allowWriteTools: true when the user explicitly wants delegated implementation.",
      "Prefer explore_codebase for broad read-only codebase discovery because it has stronger exploration-specific defaults.",
    ],
    parameters: subagentSchema,
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const input = { ...params, model: params.model ?? resolveModel(ctx.model) };
      onUpdate?.({ content: [{ type: "text", text: `Starting subagent with ${input.model}` }] });
      const result = await runSubagent(input, ctx.cwd, signal);
      const text = result.exitCode === 0 ? result.output : `Subagent failed with exit ${result.exitCode}.\n\n${result.output}`;
      return { content: [{ type: "text" as const, text }], details: { ...result, usageLine: usageLine(result.usage) } };
    },
    renderCall(args, theme) {
      const prompt = typeof args.prompt === "string" ? args.prompt : "";
      return new Text(`${theme.fg("toolTitle", theme.bold("run_subagent"))} ${theme.fg("muted", prompt.slice(0, 120))}`, 0, 0);
    },
    renderResult(result, _options, theme) {
      const text = result.content[0]?.type === "text" ? result.content[0].text : "(no output)";
      const usage = (result.details as { usageLine?: string } | undefined)?.usageLine;
      return new Text(usage ? `${text}\n${theme.fg("dim", usage)}` : text, 0, 0);
    },
  });

}
