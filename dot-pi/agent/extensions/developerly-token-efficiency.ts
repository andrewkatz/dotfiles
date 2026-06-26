import { complete } from "@earendil-works/pi-ai";
import type { AgentMessage, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { convertToLlm, serializeConversation } from "@earendil-works/pi-coding-agent";

type TextBlock = { type: "text"; text: string };
type ToolResultMessage = AgentMessage & {
  role: "toolResult";
  toolName: string;
  content: Array<TextBlock | { type: string; [key: string]: unknown }>;
};

const MAX_OLD_TOOL_RESULT_CHARS = 3_000;
const MAX_RECENT_TOOL_RESULT_CHARS = 8_000;
const RECENT_TOOL_RESULTS_TO_KEEP = 4;
const MIN_NOISY_LINE_FILTER_CHARS = 6_000;
const MIN_REPEATED_NOISY_LINE_RUN = 4;
const COMPACTION_MARKER = "middle omitted for token efficiency";

const ANSI_ESCAPE_PATTERN = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
const DIAGNOSTIC_LINE_PATTERN = /\b(error|failed|failure|exception|traceback|panic|fatal|assert|expected|received|exit code|non-zero|segmentation fault|FAIL)\b|\b(?:npm|pnpm|yarn) ERR!|[✖✗❌]/i;
const STACK_TRACE_LINE_PATTERN = /^\s+(at\s+\S+\s+\(|File "[^"]+", line \d+|from\s+\S+)/;

function isTextBlock(block: unknown): block is TextBlock {
  return !!block && typeof block === "object" && (block as { type?: string }).type === "text" && typeof (block as { text?: unknown }).text === "string";
}

function isToolResult(message: AgentMessage): message is ToolResultMessage {
  return message.role === "toolResult" && Array.isArray((message as ToolResultMessage).content);
}

function looksLikeStructuredPayload(text: string): boolean {
  const trimmed = text.trimStart();
  return (trimmed.startsWith("{") || trimmed.startsWith("[")) && trimmed.slice(0, 1_000).includes('"');
}

function isDiagnosticLine(line: string): boolean {
  return DIAGNOSTIC_LINE_PATTERN.test(line) || STACK_TRACE_LINE_PATTERN.test(line);
}

function noisyLineKey(line: string): string | undefined {
  if (isDiagnosticLine(line)) return undefined;

  const normalized = line
    .replace(ANSI_ESCAPE_PATTERN, "")
    .trim()
    .replace(/\b\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?\b/g, "<timestamp>")
    .replace(/\b\d{2}:\d{2}:\d{2}(?:\.\d+)?\b/g, "<time>")
    .replace(/\b\d+(?:\.\d+)?\s?(?:ms|s|sec|secs|seconds|min|mins|m)\b/gi, "<duration>")
    .replace(/\b\d+%\b/g, "<percent>")
    .replace(/\s+/g, " ");

  if (normalized.length < 8) return undefined;
  return normalized;
}

function collapseRepeatedNoisyLines(text: string): string {
  if (text.length < MIN_NOISY_LINE_FILTER_CHARS || looksLikeStructuredPayload(text)) return text;

  const lines = text.split("\n");
  const output: string[] = [];
  let changed = false;

  for (let i = 0; i < lines.length;) {
    const key = noisyLineKey(lines[i]);
    if (!key) {
      output.push(lines[i]);
      i += 1;
      continue;
    }

    let end = i + 1;
    while (end < lines.length && noisyLineKey(lines[end]) === key) end += 1;

    const runLength = end - i;
    if (runLength >= MIN_REPEATED_NOISY_LINE_RUN) {
      output.push(lines[i], lines[i + 1]);
      output.push(`[omitted ${(runLength - 3).toLocaleString()} repeated similar non-diagnostic log lines]`);
      output.push(lines[end - 1]);
      changed = true;
    } else {
      output.push(...lines.slice(i, end));
    }

    i = end;
  }

  if (!changed) return text;

  const collapsed = output.join("\n");
  return collapsed.length <= text.length * 0.9 ? collapsed : text;
}

function diagnosticExcerpt(text: string, maxChars: number): string {
  const lines = text.split("\n");
  const selected = new Set<number>();

  for (let i = 0; i < lines.length; i++) {
    if (!isDiagnosticLine(lines[i])) continue;
    if (i > 0) selected.add(i - 1);
    selected.add(i);
    if (i + 1 < lines.length) selected.add(i + 1);
  }

  if (selected.size === 0) return "";

  const ordered = [...selected].sort((a, b) => a - b);
  const excerpt: string[] = [];
  let last = -1;
  let used = 0;

  for (const index of ordered) {
    const gap = last >= 0 && index > last + 1 ? "..." : undefined;
    const line = lines[index];
    const addition = `${gap ? `${gap}\n` : ""}${line}`;
    if (used + addition.length > maxChars) {
      excerpt.push("[additional diagnostic lines omitted]");
      break;
    }
    if (gap) excerpt.push(gap);
    excerpt.push(line);
    used += addition.length;
    last = index;
  }

  return excerpt.join("\n").trim();
}

function compactText(text: string, maxChars: number, label: string): string {
  if (text.length <= maxChars || text.includes(COMPACTION_MARKER)) return text;

  const collapsed = collapseRepeatedNoisyLines(text);
  if (collapsed.length <= maxChars) return collapsed;

  const diagnostics = diagnosticExcerpt(collapsed, Math.floor(maxChars * 0.2));
  const diagnosticsSection = diagnostics ? `\n\nImportant diagnostic lines preserved:\n${diagnostics}` : "";
  const marker = `\n\n[${label}: ${text.length.toLocaleString()} chars total${collapsed.length < text.length ? `; reduced to ${collapsed.length.toLocaleString()} chars after repeated-log filtering` : ""}; middle omitted for token efficiency]`;
  const remainingChars = Math.max(1_000, maxChars - marker.length - diagnosticsSection.length);
  const headChars = Math.floor(remainingChars * 0.6);
  const tailChars = remainingChars - headChars;

  return [
    collapsed.slice(0, headChars).trimEnd(),
    marker,
    diagnosticsSection.trimEnd(),
    collapsed.slice(-tailChars).trimStart(),
  ].filter(Boolean).join("\n");
}

function compactToolResult(message: ToolResultMessage, maxChars: number): ToolResultMessage {
  let changed = false;
  const content = message.content.map((block) => {
    if (!isTextBlock(block) || block.text.length <= maxChars) return block;
    const text = compactText(block.text, maxChars, `${message.toolName} tool result compacted in live context`);
    if (text === block.text) return block;
    changed = true;
    return {
      ...block,
      text,
    };
  });

  return changed ? { ...message, content } : message;
}

function fileOpsDetails(preparation: any) {
  const readFiles = [...(preparation.fileOps?.read ?? [])].sort();
  const modifiedFiles = [...(preparation.fileOps?.edited ?? [])].sort();
  return { readFiles, modifiedFiles };
}

function summaryPrompt(conversationText: string, previousSummary?: string, customInstructions?: string): string {
  return `Summarize this pi coding-agent conversation for future context. Optimize for token efficiency without losing task quality.

Rules:
- Preserve exact file paths, commands, branch names, PR numbers, failing test names, and error messages.
- Summarize large tool outputs; do not copy them verbatim.
- For read/bash outputs, keep what was learned and any important line ranges or failure snippets.
- Include current user preferences and constraints that affect future work.
- Keep the summary concise and structured.
${customInstructions ? `\nAdditional user instructions: ${customInstructions}\n` : ""}
${previousSummary ? `<previous-summary>\n${previousSummary}\n</previous-summary>\n\n` : ""}<conversation>\n${conversationText}\n</conversation>

Use this format:
## Goal
## Constraints & Preferences
## Progress
### Done
### In Progress
### Blocked
## Key Decisions
## Important Files / Commands
## Next Steps
## Critical Context`;
}

export default function (pi: ExtensionAPI) {
  pi.on("before_agent_start", async (event) => {
    return {
      systemPrompt: `${event.systemPrompt}\n\nToken-efficiency guidance:\n- For broad codebase discovery, architecture questions, locating symbols, or understanding flows across multiple files, use explore_codebase first and return only concise findings to main context.\n- Prefer targeted searches and line-range reads over reading whole files.\n- Use monitor_command or monitor_github_pr_checks automatically for long-running waits instead of polling in-context.\n- Keep tool outputs narrow; summarize large outputs and preserve exact paths/errors/commands needed to continue.`,
    };
  });

  pi.on("context", async (event) => {
    let seenToolResults = 0;
    let changed = false;

    const messages = [...event.messages];
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];
      if (!isToolResult(message)) continue;

      seenToolResults += 1;
      const maxChars = seenToolResults <= RECENT_TOOL_RESULTS_TO_KEEP ? MAX_RECENT_TOOL_RESULT_CHARS : MAX_OLD_TOOL_RESULT_CHARS;
      const compacted = compactToolResult(message, maxChars);
      if (compacted !== message) {
        messages[i] = compacted;
        changed = true;
      }
    }

    return changed ? { messages } : undefined;
  });

  pi.on("session_before_compact", async (event, ctx) => {
    const { preparation, customInstructions, signal } = event;
    const allMessages = [...preparation.messagesToSummarize, ...preparation.turnPrefixMessages];
    if (allMessages.length === 0) return;

    const model = ctx.modelRegistry.find("openai-codex", "gpt-5.3-codex-spark")
      ?? ctx.modelRegistry.find("google", "gemini-2.5-flash");
    if (!model) return;

    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
    if (!auth.ok || !auth.apiKey) return;

    if (ctx.hasUI) {
      ctx.ui.notify(`Token-efficient compaction: summarizing ${allMessages.length} messages with ${model.id}`, "info");
    }

    const conversationText = serializeConversation(convertToLlm(allMessages));
    const response = await complete(
      model,
      {
        messages: [{
          role: "user" as const,
          content: [{ type: "text" as const, text: summaryPrompt(conversationText, preparation.previousSummary, customInstructions) }],
          timestamp: Date.now(),
        }],
      },
      { apiKey: auth.apiKey, headers: auth.headers, maxTokens: 6_000, signal },
    );

    const summary = response.content
      .filter((part): part is { type: "text"; text: string } => part.type === "text")
      .map((part) => part.text)
      .join("\n")
      .trim();

    if (!summary || signal.aborted) return;

    return {
      compaction: {
        summary,
        firstKeptEntryId: preparation.firstKeptEntryId,
        tokensBefore: preparation.tokensBefore,
        details: fileOpsDetails(preparation),
      },
    };
  });
}
