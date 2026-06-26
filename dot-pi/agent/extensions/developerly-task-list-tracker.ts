import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { Text, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { Type, type Static } from "typebox";

type TaskStatus = "pending" | "in_progress" | "completed" | "cancelled";
type TaskPriority = "high" | "medium" | "low";

type TaskItem = {
  id: string;
  content: string;
  status: TaskStatus;
  priority?: TaskPriority;
};

type TaskListDetails = {
  todos: TaskItem[];
  summary: TaskSummary;
  updatedAt: string;
};

type TaskSummary = {
  total: number;
  pending: number;
  inProgress: number;
  completed: number;
  cancelled: number;
};

const TOOL_NAME = "update_task_list";
const MAX_RENDERED_TASKS = 14;

const TaskSchema = Type.Object({
  id: Type.Optional(Type.String({
    description: "Stable task id. Keep the same id when updating a task across calls.",
  })),
  content: Type.String({ description: "Short task description." }),
  status: StringEnum(["pending", "in_progress", "completed", "cancelled"] as const),
  priority: Type.Optional(StringEnum(["high", "medium", "low"] as const)),
});

const TodoWriteParams = Type.Object({
  todos: Type.Array(TaskSchema, {
    description: "The complete current task list. Send the full list every time; omit completed tasks only if intentionally clearing history.",
  }),
});

type TodoWriteInput = Static<typeof TodoWriteParams>;

function countTasks(todos: TaskItem[]): TaskSummary {
  return {
    total: todos.length,
    pending: todos.filter((todo) => todo.status === "pending").length,
    inProgress: todos.filter((todo) => todo.status === "in_progress").length,
    completed: todos.filter((todo) => todo.status === "completed").length,
    cancelled: todos.filter((todo) => todo.status === "cancelled").length,
  };
}

function uniqueId(base: string, used: Set<string>, fallback: string): string {
  const slug = (base || fallback)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32) || fallback;

  let id = slug;
  let suffix = 2;
  while (used.has(id)) {
    id = `${slug}-${suffix}`;
    suffix += 1;
  }
  used.add(id);
  return id;
}

function normalizeTodos(input: TodoWriteInput): TaskItem[] {
  const used = new Set<string>();
  return input.todos.map((todo, index) => {
    const content = todo.content.trim() || "(untitled task)";
    const fallback = `task-${index + 1}`;
    const id = uniqueId(todo.id?.trim() || content, used, fallback);
    return {
      id,
      content,
      status: todo.status,
      ...(todo.priority ? { priority: todo.priority } : {}),
    } satisfies TaskItem;
  });
}

function isTaskItem(value: unknown): value is TaskItem {
  if (!value || typeof value !== "object") return false;
  const item = value as { id?: unknown; content?: unknown; status?: unknown; priority?: unknown };
  return (
    typeof item.id === "string" &&
    typeof item.content === "string" &&
    ["pending", "in_progress", "completed", "cancelled"].includes(String(item.status)) &&
    (item.priority === undefined || ["high", "medium", "low"].includes(String(item.priority)))
  );
}

function isTaskList(value: unknown): value is TaskItem[] {
  return Array.isArray(value) && value.every(isTaskItem);
}

function plainTaskList(todos: TaskItem[]): string {
  if (todos.length === 0) return "Task list cleared.";

  return todos
    .map((todo) => {
      const priority = todo.priority ? ` ${todo.priority}` : "";
      return `- [${todo.status}] ${todo.id}:${priority} ${todo.content}`;
    })
    .join("\n");
}

function hasOpenTasks(todos: TaskItem[]): boolean {
  const summary = countTasks(todos);
  return summary.pending > 0 || summary.inProgress > 0;
}

function summaryText(todos: TaskItem[]): string {
  const summary = countTasks(todos);
  if (summary.total === 0) return "No tasks";

  const pieces = [`${summary.completed}/${summary.total} completed`];
  if (summary.inProgress > 0) pieces.push(`${summary.inProgress} in progress`);
  if (summary.pending > 0) pieces.push(`${summary.pending} pending`);
  if (summary.cancelled > 0) pieces.push(`${summary.cancelled} cancelled`);
  return pieces.join(" · ");
}

function renderTaskLine(todo: TaskItem, theme: Theme, width: number): string {
  const icon = (() => {
    switch (todo.status) {
      case "completed":
        return theme.fg("success", "✓ ");
      case "in_progress":
        return theme.fg("accent", "● ");
      case "cancelled":
        return theme.fg("warning", "⊘ ");
      case "pending":
        return theme.fg("dim", "○ ");
    }
  })();

  const priority = todo.priority === "high"
    ? theme.fg("warning", "! ")
    : todo.priority === "medium"
      ? theme.fg("muted", "• ")
      : "";
  const text = todo.status === "completed"
    ? theme.fg("dim", theme.strikethrough(todo.content))
    : todo.status === "cancelled"
      ? theme.fg("dim", todo.content)
      : todo.content;

  return truncateToWidth(`${icon}${priority}${text}`, width);
}

function padAnsi(text: string, width: number): string {
  const length = visibleWidth(text);
  return length >= width ? truncateToWidth(text, width) : `${text}${" ".repeat(width - length)}`;
}

class TaskPanel {
  private cachedWidth?: number;
  private cachedLines?: string[];

  constructor(
    private readonly theme: Theme,
    private readonly getTodos: () => TaskItem[],
  ) {}

  render(width: number): string[] {
    if (this.cachedWidth === width && this.cachedLines) return this.cachedLines;

    const innerWidth = Math.max(1, width - 2);
    const border = (text: string) => this.theme.fg("dim", text);
    const line = (text: string) => `${border("│")}${padAnsi(text, innerWidth)}${border("│")}`;
    const todos = this.getTodos();
    const summary = countTasks(todos);
    const lines: string[] = [];

    lines.push(border(`╭${"─".repeat(innerWidth)}╮`));
    lines.push(line(`${this.theme.bold("Tasks")} ${this.theme.fg("muted", `${summary.completed}/${summary.total}`)}`));
    lines.push(line(this.theme.fg("dim", summaryText(todos))));
    lines.push(border(`├${"─".repeat(innerWidth)}┤`));

    const visibleTodos = todos.slice(0, MAX_RENDERED_TASKS);
    for (const todo of visibleTodos) {
      lines.push(line(renderTaskLine(todo, this.theme, innerWidth)));
    }

    if (todos.length > visibleTodos.length) {
      lines.push(line(this.theme.fg("dim", `… ${todos.length - visibleTodos.length} more`)));
    }

    if (todos.length === 0) {
      lines.push(line(this.theme.fg("dim", "No active tasks")));
    }

    lines.push(border(`╰${"─".repeat(innerWidth)}╯`));

    this.cachedWidth = width;
    this.cachedLines = lines;
    return lines;
  }

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
  }
}

export default function taskListTracker(pi: ExtensionAPI) {
  let todos: TaskItem[] = [];
  let latestCtx: ExtensionContext | undefined;
  let panel: TaskPanel | undefined;
  let panelStarted = false;
  let requestPanelRender: (() => void) | undefined;
  let hidePanel: (() => void) | undefined;

  function updatePanel(): void {
    panel?.invalidate();
    requestPanelRender?.();
  }

  function ensurePanel(ctx: ExtensionContext): void {
    if (!ctx.hasUI || panelStarted) return;
    panelStarted = true;

    void ctx.ui.custom<void>((tui, theme) => {
      panel = new TaskPanel(theme, () => todos);
      requestPanelRender = () => tui.requestRender();
      return panel;
    }, {
      overlay: true,
      overlayOptions: {
        anchor: "top-right",
        width: "28%",
        minWidth: 32,
        maxHeight: "70%",
        margin: { top: 1, right: 1 },
        nonCapturing: true,
        visible: (termWidth) => termWidth >= 100 && hasOpenTasks(todos),
      },
      onHandle: (handle) => {
        hidePanel = () => handle.hide();
      },
    }).catch(() => {
      panelStarted = false;
      panel = undefined;
      requestPanelRender = undefined;
      hidePanel = undefined;
    });
  }

  function syncUi(ctx = latestCtx): void {
    if (!ctx?.hasUI) return;
    latestCtx = ctx;

    if (!hasOpenTasks(todos)) {
      ctx.ui.setStatus("tasks", undefined);
      updatePanel();
      return;
    }

    const summary = countTasks(todos);
    ctx.ui.setStatus("tasks", ctx.ui.theme.fg("accent", `tasks ${summary.completed}/${summary.total}`));
    ensurePanel(ctx);

    updatePanel();
  }

  function reconstructState(ctx: ExtensionContext): void {
    todos = [];

    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type !== "message") continue;
      const message = entry.message as { role?: string; toolName?: string; details?: unknown };
      if (message.role !== "toolResult" || message.toolName !== TOOL_NAME) continue;
      const details = message.details as { todos?: unknown } | undefined;
      if (isTaskList(details?.todos)) {
        todos = details.todos;
      }
    }
  }

  pi.registerTool({
    name: TOOL_NAME,
    label: "Tasks",
    description: "Create or update the current task list for complex, multi-step work. Always send the complete current list.",
    promptSnippet: "Track complex multi-step work with a persistent task list shown in the Pi TUI",
    promptGuidelines: [
      "Use update_task_list for complex or multi-step work so progress stays visible in Pi's task panel.",
      "Call update_task_list before substantive edits on complex projects, then update it as tasks move from pending to in_progress to completed.",
      "Keep exactly one task in_progress when actively working, unless the work is intentionally blocked or parallel.",
      "Send the complete current task list every time; use stable ids and concise task descriptions.",
      "Do not use update_task_list for trivial single-step requests where a task list would add noise.",
    ],
    parameters: TodoWriteParams,

    async execute(_toolCallId, params: TodoWriteInput, _signal, _onUpdate, ctx) {
      latestCtx = ctx;
      todos = normalizeTodos(params);
      const summary = countTasks(todos);
      const details: TaskListDetails = {
        todos: [...todos],
        summary,
        updatedAt: new Date().toISOString(),
      };

      syncUi(ctx);

      return {
        content: [{ type: "text" as const, text: plainTaskList(todos) }],
        details,
      };
    },

    renderCall(args, theme) {
      const count = Array.isArray(args.todos) ? args.todos.length : 0;
      return new Text(
        `${theme.fg("toolTitle", theme.bold(TOOL_NAME))} ${theme.fg("muted", `${count} task${count === 1 ? "" : "s"}`)}`,
        0,
        0,
      );
    },

    renderResult(result, { expanded }, theme) {
      const details = result.details as TaskListDetails | undefined;
      if (!details) {
        const first = result.content[0];
        return new Text(first?.type === "text" ? first.text : "", 0, 0);
      }

      if (expanded) {
        return new Text(plainTaskList(details.todos), 0, 0);
      }

      return new Text(theme.fg("success", "✓ ") + theme.fg("muted", summaryText(details.todos)), 0, 0);
    },
  });

  pi.on("session_start", (_event, ctx) => {
    latestCtx = ctx;
    reconstructState(ctx);
    syncUi(ctx);
  });

  pi.on("session_tree", (_event, ctx) => {
    latestCtx = ctx;
    reconstructState(ctx);
    syncUi(ctx);
  });

  pi.on("session_shutdown", () => {
    hidePanel?.();
    panelStarted = false;
    panel = undefined;
    requestPanelRender = undefined;
    hidePanel = undefined;
  });
}
