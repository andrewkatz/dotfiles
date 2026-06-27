import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type, type Static } from "typebox";
import { execFileSync } from "node:child_process";
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Mirrors developerly-status-pi.ts so the prompt file lands beside the
// state file the status extension writes.
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

function promptFile(): string | undefined {
  const session = tmuxSession();
  if (!session) return undefined;
  return join(statusDir(), `${sanitize(session)}.prompt`);
}

// Publishes the pending question for the mobile web view (already in the
// daemon's normalized shape). Best-effort: a failure to write must never
// break the in-TUI question flow.
function writePrompt(params: AskUserQuestionInput, allowCustom: boolean) {
  const file = promptFile();
  if (!file) return;
  try {
    mkdirSync(statusDir(), { recursive: true });
    const payload = JSON.stringify({
      agent: "pi",
      questions: [{
        question: params.question,
        multiSelect: false,
        allowCustom,
        options: (params.options ?? []).map((o) => ({ label: o.label, description: o.description })),
      }],
    });
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, payload);
    renameSync(tmp, file);
  } catch {
    // ignore
  }
}

function clearPrompt() {
  const file = promptFile();
  if (!file) return;
  try {
    rmSync(file, { force: true });
  } catch {
    // ignore
  }
}

const OptionSchema = Type.Object({
  label: Type.String({ description: "Short answer label shown to the user" }),
  description: Type.Optional(Type.String({ description: "Optional detail shown next to the label" })),
});

const AskUserQuestionSchema = Type.Object({
  question: Type.String({ description: "The question to ask the user" }),
  options: Type.Optional(Type.Array(OptionSchema, {
    description: "Suggested answers the user can choose from. Omit or leave empty for free-form input.",
  })),
  allowCustomResponse: Type.Optional(Type.Boolean({
    description: "Whether the user may type a custom answer. Defaults to true when no options are provided, false otherwise.",
  })),
  placeholder: Type.Optional(Type.String({ description: "Placeholder text for a custom/free-form answer" })),
});

type AskUserQuestionInput = Static<typeof AskUserQuestionSchema>;

type AskUserQuestionDetails = {
  question: string;
  options: string[];
  answer: string | null;
  wasCustom: boolean;
  cancelled: boolean;
};

function optionDisplay(option: { label: string; description?: string }, index: number): string {
  const description = option.description ? ` — ${option.description}` : "";
  return `${index + 1}. ${option.label}${description}`;
}

function result(question: string, options: string[], answer: string | null, wasCustom: boolean) {
  const cancelled = answer === null;
  const details: AskUserQuestionDetails = { question, options, answer, wasCustom, cancelled };
  const text = cancelled ? "User cancelled the question." : `User answered: ${answer}`;
  return { content: [{ type: "text" as const, text }], details };
}

export default function askUserQuestion(pi: ExtensionAPI) {
  let promptQueue: Promise<void> = Promise.resolve();
  let queuedPrompts = 0;

  function enqueuePrompt<T>(task: () => Promise<T>): Promise<T> {
    const run = promptQueue.catch(() => undefined).then(task);
    promptQueue = run.then(() => undefined, () => undefined);
    return run;
  }

  pi.registerTool({
    name: "ask_user_question",
    label: "Ask User",
    description: "Ask the user a blocking question in the Pi TUI and return their answer.",
    promptSnippet: "Ask the user a blocking question via the Pi TUI and return their selected or typed answer",
    promptGuidelines: [
      "Use ask_user_question when you need clarification, a preference, or a decision from the user before proceeding.",
      "Prefer ask_user_question over guessing when multiple reasonable implementation paths exist.",
      "For ask_user_question, provide concise suggested options when possible and set allowCustomResponse when a free-form answer would be useful.",
    ],
    parameters: AskUserQuestionSchema,

    async execute(_toolCallId, params: AskUserQuestionInput, signal, onUpdate, ctx) {
      const options = params.options ?? [];
      const optionLabels = options.map((option) => option.label);
      const allowCustomResponse = params.allowCustomResponse ?? options.length === 0;

      if (!ctx.hasUI) {
        return {
          content: [{ type: "text" as const, text: "Error: ask_user_question requires an interactive Pi TUI." }],
          details: {
            question: params.question,
            options: optionLabels,
            answer: null,
            wasCustom: false,
            cancelled: true,
          } satisfies AskUserQuestionDetails,
        };
      }

      queuedPrompts += 1;
      if (queuedPrompts > 1) {
        onUpdate?.({ content: [{ type: "text" as const, text: `Queued ask_user_question behind ${queuedPrompts - 1} pending question${queuedPrompts === 2 ? "" : "s"}.` }] });
      }

      try {
        return await enqueuePrompt(async () => {
          if (signal?.aborted) return result(params.question, optionLabels, null, false);

          writePrompt(params, allowCustomResponse);
          try {
            if (options.length === 0 || allowCustomResponse) {
              if (options.length > 0) {
                const customChoice = `${options.length + 1}. Type a custom response`;
                const choices = [...options.map(optionDisplay), customChoice];
                const choice = await ctx.ui.select(params.question, choices, { signal });
                if (!choice) return result(params.question, optionLabels, null, false);

                const selectedIndex = choices.indexOf(choice);
                if (selectedIndex >= 0 && selectedIndex < options.length) {
                  return result(params.question, optionLabels, options[selectedIndex].label, false);
                }
              }

              const answer = await ctx.ui.input(params.question, params.placeholder ?? "Type your answer...", { signal });
              if (answer === undefined) return result(params.question, optionLabels, null, true);
              return result(params.question, optionLabels, answer, true);
            }

            const choices = options.map(optionDisplay);
            const choice = await ctx.ui.select(params.question, choices, { signal });
            if (!choice) return result(params.question, optionLabels, null, false);

            const selectedIndex = choices.indexOf(choice);
            const answer = selectedIndex >= 0 ? options[selectedIndex].label : choice;
            return result(params.question, optionLabels, answer, false);
          } finally {
            clearPrompt();
          }
        });
      } finally {
        queuedPrompts -= 1;
      }
    },

    renderCall(args, theme, _context) {
      const question = typeof args.question === "string" ? args.question : "";
      const options = Array.isArray(args.options) ? args.options : [];
      let text = theme.fg("toolTitle", theme.bold("ask user ")) + theme.fg("muted", question);
      if (options.length > 0) {
        const labels = options.map((option: { label?: unknown }, index: number) => `${index + 1}. ${String(option.label ?? "")}`);
        text += `\n${theme.fg("dim", `  Options: ${labels.join(", ")}`)}`;
      }
      return new Text(text, 0, 0);
    },

    renderResult(toolResult, _options, theme, _context) {
      const details = toolResult.details as AskUserQuestionDetails | undefined;
      if (!details) {
        const first = toolResult.content[0];
        return new Text(first?.type === "text" ? first.text : "", 0, 0);
      }

      if (details.cancelled || details.answer === null) {
        return new Text(theme.fg("warning", "Cancelled"), 0, 0);
      }

      const prefix = details.wasCustom ? theme.fg("muted", "(typed) ") : "";
      return new Text(theme.fg("success", "✓ ") + prefix + theme.fg("accent", details.answer), 0, 0);
    },
  });
}
