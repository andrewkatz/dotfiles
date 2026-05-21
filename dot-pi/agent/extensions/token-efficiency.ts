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
const MAX_RECENT_TOOL_RESULT_CHARS = 12_000;
const RECENT_TOOL_RESULTS_TO_KEEP = 4;

function isTextBlock(block: unknown): block is TextBlock {
  return !!block && typeof block === "object" && (block as { type?: string }).type === "text" && typeof (block as { text?: unknown }).text === "string";
}

function isToolResult(message: AgentMessage): message is ToolResultMessage {
  return message.role === "toolResult" && Array.isArray((message as ToolResultMessage).content);
}

function compactText(text: string, maxChars: number, label: string): string {
  if (text.length <= maxChars) return text;

  const headChars = Math.floor(maxChars * 0.6);
  const tailChars = maxChars - headChars;
  return [
    text.slice(0, headChars).trimEnd(),
    `\n\n[${label}: ${text.length.toLocaleString()} chars total; middle omitted for token efficiency]`,
    text.slice(-tailChars).trimStart(),
  ].join("\n");
}

function compactToolResult(message: ToolResultMessage, maxChars: number): ToolResultMessage {
  let changed = false;
  const content = message.content.map((block) => {
    if (!isTextBlock(block) || block.text.length <= maxChars) return block;
    changed = true;
    return {
      ...block,
      text: compactText(block.text, maxChars, `${message.toolName} tool result compacted in live context`),
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
      systemPrompt: `${event.systemPrompt}\n\nToken-efficiency guidance:\n- For broad codebase discovery, architecture questions, locating symbols, or understanding flows across multiple files, use explore_subagent first and return only concise findings to main context.\n- Prefer targeted searches and line-range reads over reading whole files.\n- Use monitor_command or monitor_github_pr_checks automatically for long-running waits instead of polling in-context.\n- Keep tool outputs narrow; summarize large outputs and preserve exact paths/errors/commands needed to continue.`,
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
