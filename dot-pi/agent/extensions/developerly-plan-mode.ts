import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key, Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const PLAN_CONFIG_VERSION = 1;
const MCP_TOOL_NAME = "mcp";
const MCP_ALLOW_ONCE = "Allow once";
const MCP_ALLOW_SESSION = "Allow for this plan session";
const MCP_ALLOW_ALWAYS = "Always allow in plan";
const MCP_BLOCK = "Block";

type McpToolApproval = {
  server: string;
  tool: string;
};

type PlanModeConfig = {
  version: typeof PLAN_CONFIG_VERSION;
  allowedMcpTools: McpToolApproval[];
};

const STATE_ENTRY = "developerly-plan-mode";
const CONTEXT_ENTRY = "developerly-plan-mode-context";
const SENTINEL = "DEVELOPERLY_PI_PLAN_MODE=1";
const PROMPT_DELIMITER = "Developerly launch prompt:";

const READ_ONLY_TOOLS = new Set([
  "read",
  "bash",
  "grep",
  "find",
  "ls",
  "ask_user_question",
  "questionnaire",
  "explore_codebase",
  "run_subagent",
  "exit_plan_mode",
]);

const WRITE_TOOLS = new Set([
  "edit",
  "write",
  "apply_patch",
  "monitor_command",
  "monitor_github_pr_checks",
  "stop_monitor",
  "update_task_list",
]);

const ALWAYS_BLOCKED_BASH = [
  /(^|\s)(rm|rmdir|mv|cp|mkdir|touch|chmod|chown|chgrp|ln|tee|truncate|dd|shred)\b/i,
  /(^|\s)(sudo|su|kill|pkill|killall|reboot|shutdown)\b/i,
  /(^|\s)(vim?|nano|emacs|code|subl)\b/i,
  /\b(git\s+(add|commit|push|pull|merge|rebase|reset|checkout|switch|restore|stash|cherry-pick|revert|tag|init|clone|fetch))\b/i,
  /\b(npm\s+(install|uninstall|update|ci|link|publish|run))\b/i,
  /\b(yarn\s+(add|remove|install|publish|run))\b/i,
  /\b(pnpm\s+(add|remove|install|publish|run))\b/i,
  /\b(bundle\s+(install|update|exec))\b/i,
  /\b(pip\s+(install|uninstall))\b/i,
  /\b(apt|apt-get|brew|systemctl|service)\b/i,
  /(^|\s)(python|python3|ruby|node|perl|php|sh|bash|zsh|fish)\b/i,
];

const SAFE_COMMANDS = new Set([
  "cat",
  "head",
  "tail",
  "less",
  "more",
  "grep",
  "rg",
  "find",
  "fd",
  "ls",
  "pwd",
  "echo",
  "printf",
  "wc",
  "sort",
  "uniq",
  "diff",
  "file",
  "stat",
  "du",
  "df",
  "tree",
  "which",
  "whereis",
  "type",
  "env",
  "printenv",
  "uname",
  "whoami",
  "id",
  "date",
  "cal",
  "uptime",
  "ps",
  "top",
  "htop",
  "free",
]);

const SAFE_GIT_COMMANDS = new Set(["status", "log", "diff", "show", "blame", "grep", "ls-files", "ls-tree"]);
const SAFE_PACKAGE_COMMANDS = new Set(["list", "ls", "view", "info", "search", "outdated", "audit", "why"]);

type StateEntry = {
  enabled?: boolean;
  previousActiveTools?: string[];
};

function stripPlanningEnvelope(text: string): string {
  const index = text.indexOf(PROMPT_DELIMITER);
  if (index >= 0) {
    return text.slice(index + PROMPT_DELIMITER.length).trimStart();
  }
  return text.replace(SENTINEL, "").trimStart();
}

function messageIncludesPlanningContext(message: AgentMessage): boolean {
  const customType = (message as AgentMessage & { customType?: string }).customType;
  if (customType === CONTEXT_ENTRY) return true;

  const content = (message as AgentMessage & { content?: unknown }).content;
  if (typeof content === "string") return content.includes(SENTINEL);
  if (!Array.isArray(content)) return false;

  return content.some((part) => {
    if (!part || typeof part !== "object") return false;
    const text = (part as { text?: unknown }).text;
    return typeof text === "string" && text.includes(SENTINEL);
  });
}

function shellWords(input: string): string[] {
  const words = input.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
  return words.map((word) => {
    if ((word.startsWith('"') && word.endsWith('"')) || (word.startsWith("'") && word.endsWith("'"))) {
      return word.slice(1, -1);
    }
    return word;
  });
}

function basename(command: string): string {
  return command.split("/").pop() ?? command;
}

function hasUnsafeShellSyntax(command: string): boolean {
  return /[;&`]|\|\||\$\(|\$\{|\n|\r|(^|[^<])>{1,2}|<{1,2}|\b(xargs|tee)\b/i.test(command);
}

function isSafeFind(tokens: string[]): boolean {
  return !tokens.some((token) => ["-delete", "-exec", "-execdir", "-ok", "-okdir"].includes(token));
}

function isSafeGit(tokens: string[]): boolean {
  const subcommand = tokens[1];
  if (!subcommand) return false;
  if (SAFE_GIT_COMMANDS.has(subcommand)) return true;
  if (subcommand === "branch") {
    return !tokens.slice(2).some((token) => /^-[dDmM]/.test(token));
  }
  if (subcommand === "remote") {
    return !tokens.slice(2).some((token) => ["add", "remove", "rename", "set-url", "update", "prune"].includes(token));
  }
  if (subcommand === "config") {
    return tokens[2] === "--get" || tokens[2] === "--list" || tokens[2] === "-l";
  }
  return false;
}

function isSafePackageCommand(tokens: string[]): boolean {
  const subcommand = tokens[1];
  return Boolean(subcommand && SAFE_PACKAGE_COMMANDS.has(subcommand));
}

function isSafeSegment(segment: string): boolean {
  const tokens = shellWords(segment.trim());
  while (tokens[0] && /^[A-Za-z_][A-Za-z0-9_]*=.*$/.test(tokens[0])) tokens.shift();
  if (tokens.length === 0) return false;

  const command = basename(tokens[0]);
  if (SAFE_COMMANDS.has(command)) {
    return command !== "find" || isSafeFind(tokens);
  }
  if (command === "git") return isSafeGit(tokens);
  if (["npm", "yarn", "pnpm"].includes(command)) return isSafePackageCommand(tokens);
  return false;
}

function isSafeBash(command: string): boolean {
  const trimmed = command.trim();
  if (trimmed.length === 0) return false;
  if (ALWAYS_BLOCKED_BASH.some((pattern) => pattern.test(trimmed))) return false;
  if (hasUnsafeShellSyntax(trimmed)) return false;

  const segments = trimmed.split("|").map((segment) => segment.trim());
  return segments.length > 0 && segments.every((segment) => segment.length > 0 && isSafeSegment(segment));
}

function isReadOnlySubagent(input: unknown): boolean {
  if (!input || typeof input !== "object") return true;
  const params = input as { allowWriteTools?: unknown; tools?: unknown };
  if (params.allowWriteTools === true) return false;
  if (typeof params.tools !== "string" || params.tools.trim() === "") return true;
  const readOnly = new Set(["read", "grep", "find", "ls"]);
  return params.tools.split(",").map((tool) => tool.trim()).filter(Boolean).every((tool) => readOnly.has(tool));
}

function planModeConfigPath(): string {
  const configHome = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(configHome, "developerly", "pi-plan-mode.json");
}

function approvalKey(approval: McpToolApproval): string {
  return JSON.stringify([approval.server, approval.tool]);
}

function parsePlanModeConfig(value: unknown): PlanModeConfig {
  if (!value || typeof value !== "object") throw new Error("config must be an object");
  const config = value as { version?: unknown; allowedMcpTools?: unknown };
  if (config.version !== PLAN_CONFIG_VERSION) throw new Error(`unsupported config version: ${String(config.version)}`);
  if (!Array.isArray(config.allowedMcpTools)) throw new Error("allowedMcpTools must be an array");

  const allowedMcpTools = config.allowedMcpTools.map((entry, index) => {
    if (!entry || typeof entry !== "object") throw new Error(`allowedMcpTools[${index}] must be an object`);
    const approval = entry as { server?: unknown; tool?: unknown };
    if (typeof approval.server !== "string" || approval.server.trim() === "") {
      throw new Error(`allowedMcpTools[${index}].server must be a non-empty string`);
    }
    if (typeof approval.tool !== "string" || approval.tool.trim() === "") {
      throw new Error(`allowedMcpTools[${index}].tool must be a non-empty string`);
    }
    return { server: approval.server, tool: approval.tool };
  });

  return { version: PLAN_CONFIG_VERSION, allowedMcpTools };
}

function readPlanModeConfig(): PlanModeConfig {
  const path = planModeConfigPath();
  if (!existsSync(path)) return { version: PLAN_CONFIG_VERSION, allowedMcpTools: [] };
  try {
    return parsePlanModeConfig(JSON.parse(readFileSync(path, "utf8")));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not read ${path}: ${message}`);
  }
}

function persistMcpApproval(approval: McpToolApproval): void {
  const path = planModeConfigPath();
  const config = readPlanModeConfig();
  const approvals = new Map(config.allowedMcpTools.map((entry) => [approvalKey(entry), entry]));
  approvals.set(approvalKey(approval), approval);
  const allowedMcpTools = [...approvals.values()].sort((left, right) =>
    left.server.localeCompare(right.server) || left.tool.localeCompare(right.tool));
  const next: PlanModeConfig = { version: PLAN_CONFIG_VERSION, allowedMcpTools };
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;

  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  try {
    writeFileSync(tempPath, `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    renameSync(tempPath, path);
  } finally {
    rmSync(tempPath, { force: true });
  }
}

function isMcpInspection(input: Record<string, unknown>): boolean {
  const hasUnsafeSelector = input.action !== undefined || input.tool !== undefined || input.connect !== undefined;
  return !hasUnsafeSelector && (typeof input.search === "string" || typeof input.describe === "string");
}

function mcpToolApproval(input: Record<string, unknown>): McpToolApproval | undefined {
  const server = typeof input.server === "string" ? input.server.trim() : "";
  const tool = typeof input.tool === "string" ? input.tool.trim() : "";
  if (!server || !tool) return undefined;
  return { server, tool };
}

function displayedMcpArgs(input: Record<string, unknown>): string {
  const args = typeof input.args === "string" ? input.args : "{}";
  const maxLength = 2_000;
  return args.length <= maxLength ? args : `${args.slice(0, maxLength)}…`;
}

export default function developerlyPlanMode(pi: ExtensionAPI): void {
  let planModeEnabled = false;
  let previousActiveTools: string[] | undefined;
  let approvedPlanExit = false;
  let mcpApprovalQueue: Promise<void> = Promise.resolve();
  const sessionMcpApprovals = new Set<string>();

  function readOnlyTools(): string[] {
    const available = new Set(pi.getAllTools().map((tool) => tool.name));
    const active = pi.getActiveTools();
    const selected = active.filter((tool) => READ_ONLY_TOOLS.has(tool) && available.has(tool));

    for (const tool of READ_ONLY_TOOLS) {
      if (available.has(tool) && !selected.includes(tool)) selected.push(tool);
    }
    if (available.has(MCP_TOOL_NAME) && !selected.includes(MCP_TOOL_NAME)) selected.push(MCP_TOOL_NAME);

    return selected;
  }

  function queuedMcpApproval<T>(callback: () => Promise<T>): Promise<T> {
    const result = mcpApprovalQueue.then(callback, callback);
    mcpApprovalQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  function isAlwaysAllowed(approval: McpToolApproval): boolean {
    return readPlanModeConfig().allowedMcpTools.some((entry) => approvalKey(entry) === approvalKey(approval));
  }

  async function approveMcpToolCall(input: Record<string, unknown>, ctx: ExtensionContext): Promise<string | undefined> {
    const approval = mcpToolApproval(input);
    if (approval) {
      const key = approvalKey(approval);
      try {
        if (isAlwaysAllowed(approval)) return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (ctx.hasUI) ctx.ui.notify(message, "error");
        return `Developerly plan mode blocked the MCP call because its approval config is invalid. ${message}`;
      }
      if (sessionMcpApprovals.has(key)) return;
    }

    if (!ctx.hasUI) {
      return "Developerly plan mode blocks unapproved MCP tool calls without an interactive Pi TUI.";
    }

    return queuedMcpApproval(async () => {
      if (approval) {
        const key = approvalKey(approval);
        try {
          if (isAlwaysAllowed(approval)) return;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          ctx.ui.notify(message, "error");
          return `Developerly plan mode blocked the MCP call because its approval config is invalid. ${message}`;
        }
        if (sessionMcpApprovals.has(key)) return;
      }

      const server = approval?.server ?? "(server not provided)";
      const tool = typeof input.tool === "string" && input.tool.trim() ? input.tool.trim() : "(tool not provided)";
      const choices = [MCP_ALLOW_ONCE, MCP_ALLOW_SESSION];
      if (approval) choices.push(MCP_ALLOW_ALWAYS);
      choices.push(MCP_BLOCK);
      const choice = await ctx.ui.select(
        `Allow MCP call in plan mode?\nServer: ${server}\nTool: ${tool}\nArguments: ${displayedMcpArgs(input)}\nPermanent approval allows every argument for this tool.`,
        choices,
      );

      if (choice === MCP_ALLOW_ONCE) return;
      if (choice === MCP_ALLOW_SESSION) {
        if (!approval) return "Retry the MCP call with an explicit server to approve it for this plan session.";
        sessionMcpApprovals.add(approvalKey(approval));
        return;
      }
      if (choice === MCP_ALLOW_ALWAYS) {
        if (!approval) return "Retry the MCP call with an explicit server to approve it permanently.";
        try {
          persistMcpApproval(approval);
          return;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          ctx.ui.notify(`Could not save MCP plan approval: ${message}`, "error");
          return `Developerly plan mode blocked the MCP call because its permanent approval could not be saved. ${message}`;
        }
      }

      return `Developerly plan mode blocked MCP tool ${tool}.`;
    });
  }

  function updateStatus(ctx: ExtensionContext): void {
    if (planModeEnabled) {
      ctx.ui.setStatus("developerly-plan-mode", ctx.ui.theme.fg("warning", "⏸ plan"));
    } else {
      ctx.ui.setStatus("developerly-plan-mode", undefined);
    }
  }

  function persistState(): void {
    pi.appendEntry(STATE_ENTRY, {
      enabled: planModeEnabled,
      previousActiveTools,
    } satisfies StateEntry);
  }

  function activeToolsWithoutPlanExit(): string[] {
    return pi.getActiveTools().filter((tool) => tool !== "exit_plan_mode");
  }

  function enterPlanMode(ctx: ExtensionContext, notify = true): void {
    if (!planModeEnabled) previousActiveTools = activeToolsWithoutPlanExit();
    approvedPlanExit = false;
    sessionMcpApprovals.clear();
    planModeEnabled = true;
    pi.setActiveTools(readOnlyTools());
    updateStatus(ctx);
    persistState();
    if (notify && ctx.hasUI) ctx.ui.notify("Developerly plan mode enabled. Edits are blocked until exit_plan_mode is approved.", "info");
  }

  function exitPlanMode(ctx: ExtensionContext, notify = true): void {
    approvedPlanExit = false;
    planModeEnabled = false;
    sessionMcpApprovals.clear();
    const restore = previousActiveTools && previousActiveTools.length > 0
      ? previousActiveTools
      : pi.getAllTools().map((tool) => tool.name).filter((tool) => tool !== "exit_plan_mode");
    previousActiveTools = undefined;
    pi.setActiveTools(restore);
    updateStatus(ctx);
    persistState();
    if (notify && ctx.hasUI) ctx.ui.notify("Developerly plan mode disabled. Full tool access restored.", "info");
  }

  pi.registerCommand("plan", {
    description: "Toggle Developerly plan mode for Pi",
    handler: async (_args, ctx) => {
      if (planModeEnabled) exitPlanMode(ctx);
      else enterPlanMode(ctx);
    },
  });

  pi.registerShortcut(Key.ctrlAlt("p"), {
    description: "Toggle Developerly plan mode",
    handler: async (ctx) => {
      if (planModeEnabled) exitPlanMode(ctx);
      else enterPlanMode(ctx);
    },
  });

  pi.registerTool({
    name: "exit_plan_mode",
    label: "Plan Exit",
    description: "Use when the implementation plan is complete and ready for user approval before switching out of read-only plan mode.",
    promptSnippet: "Ask the user to approve the completed plan and switch from plan mode to build mode",
    promptGuidelines: [
      "Use exit_plan_mode after presenting a complete implementation plan and resolving open questions.",
      "Do not use exit_plan_mode if requirements are still ambiguous; ask the user a clarifying question instead.",
    ],
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, signal, _onUpdate, ctx) {
      if (!planModeEnabled) {
        return { content: [{ type: "text" as const, text: "Plan mode is not active." }] };
      }

      if (!ctx.hasUI) {
        return { content: [{ type: "text" as const, text: "Plan approval requires an interactive Pi TUI." }] };
      }

      const choice = await ctx.ui.select(
        "Plan complete. Switch to build mode and start implementing?",
        [
          "Yes, approve the plan and implement it",
          "No, stay in plan mode",
        ],
        { signal },
      );

      if (choice?.startsWith("Yes")) {
        approvedPlanExit = true;
        return { content: [{ type: "text" as const, text: "Plan approved. Finish this turn now; Developerly will switch to build mode and queue implementation after the planning turn ends." }] };
      }

      approvedPlanExit = false;
      return { content: [{ type: "text" as const, text: "User chose to stay in plan mode. Continue refining the plan." }] };
    },
    renderCall(_args, theme, _context) {
      return new Text(theme.fg("toolTitle", theme.bold("exit_plan_mode ")) + theme.fg("muted", "request approval"), 0, 0);
    },
    renderResult(toolResult, _options, theme, _context) {
      const first = toolResult.content[0];
      const text = first?.type === "text" ? first.text : "";
      const color = text.includes("approved") ? "success" : "warning";
      return new Text(theme.fg(color, text), 0, 0);
    },
  });

  pi.on("input", async (event, ctx) => {
    if (event.source === "extension" || !event.text.includes(SENTINEL)) return { action: "continue" as const };
    enterPlanMode(ctx, false);
    return { action: "transform" as const, text: stripPlanningEnvelope(event.text) };
  });

  pi.on("before_agent_start", async (_event, ctx) => {
    if (!planModeEnabled) return;
    pi.setActiveTools(readOnlyTools());
    updateStatus(ctx);

    return {
      message: {
        customType: CONTEXT_ENTRY,
        content: `<system-reminder>
${SENTINEL}
Developerly plan mode is active. The user wants a researched implementation plan before any changes.

Hard restrictions:
- Do not modify files, create files, run formatters, start servers, install packages, commit, push, or otherwise change the system.
- You may inspect the repository with read-only tools only.
- Bash is allowed only for conservative read-only inspection commands; use separate tool calls instead of shell chains.
- If requirements are ambiguous, ask concise clarifying questions instead of guessing.

Planning workflow:
1. Read project instructions and relevant code.
2. Use explore_codebase or read-only run_subagent calls when broader isolated discovery is useful.
3. Identify the recommended implementation approach, critical files, tests/checks, risks, and open questions.
4. Present a concise final plan in your response.
5. End by either asking a necessary clarifying question or calling exit_plan_mode to request approval. Do not ask for plan approval with ask_user_question; use exit_plan_mode for approval.
</system-reminder>`,
        display: false,
      },
    };
  });

  pi.on("context", async (event) => {
    if (planModeEnabled) return;
    return {
      messages: event.messages.filter((message) => !messageIncludesPlanningContext(message as AgentMessage)),
    };
  });

  pi.on("agent_end", async (_event, ctx) => {
    if (!approvedPlanExit || !planModeEnabled) return;
    approvedPlanExit = false;
    exitPlanMode(ctx, false);
    await pi.sendUserMessage("The plan has been approved. You are now in build mode with full tool access. Execute the approved plan.", { deliverAs: "followUp" });
  });

  pi.on("tool_call", async (event, ctx) => {
    if (!planModeEnabled) return;

    if (event.toolName === "exit_plan_mode") return;
    if (event.toolName === MCP_TOOL_NAME) {
      if (isMcpInspection(event.input)) return;
      if (event.input.action !== undefined || event.input.connect !== undefined) {
        return {
          block: true,
          reason: "Developerly plan mode blocks MCP connect and action operations.",
        };
      }
      if (typeof event.input.tool !== "string" || event.input.tool.trim() === "") {
        return {
          block: true,
          reason: "Developerly plan mode allows MCP search and describe operations, but blocks connect, authentication, status, listing, and other gateway actions.",
        };
      }
      const reason = await approveMcpToolCall(event.input, ctx);
      if (!reason) return;
      return { block: true, reason };
    }
    if (event.toolName === "run_subagent" && !isReadOnlySubagent(event.input)) {
      return {
        block: true,
        reason: "Developerly plan mode blocked a write-capable run_subagent. Call exit_plan_mode and get approval before delegated write-capable work.",
      };
    }
    if (event.toolName === "bash") {
      const command = typeof event.input.command === "string" ? event.input.command : "";
      if (isSafeBash(command)) return;
      return {
        block: true,
        reason: `Developerly plan mode blocked a non-read-only bash command. Ask for approval with exit_plan_mode before making changes.\nCommand: ${command}`,
      };
    }

    if (WRITE_TOOLS.has(event.toolName) || !READ_ONLY_TOOLS.has(event.toolName)) {
      return {
        block: true,
        reason: `Developerly plan mode blocked ${event.toolName}. Call exit_plan_mode and get approval before making changes.`,
      };
    }
  });

  pi.on("session_start", async (_event, ctx) => {
    const entries = ctx.sessionManager.getEntries();
    const stateEntry = entries
      .filter((entry: { type: string; customType?: string }) => entry.type === "custom" && entry.customType === STATE_ENTRY)
      .pop() as { data?: StateEntry } | undefined;

    if (stateEntry?.data) {
      planModeEnabled = stateEntry.data.enabled ?? false;
      previousActiveTools = stateEntry.data.previousActiveTools;
    }

    if (planModeEnabled) {
      pi.setActiveTools(readOnlyTools());
    } else if (pi.getActiveTools().includes("exit_plan_mode")) {
      pi.setActiveTools(activeToolsWithoutPlanExit());
    }
    updateStatus(ctx);
  });
}
