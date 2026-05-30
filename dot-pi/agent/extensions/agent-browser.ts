import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, isAbsolute, join, resolve } from "node:path";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { DEFAULT_MAX_BYTES, formatSize, truncateTail, type TruncationResult } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type, type Static } from "typebox";

const MAX_IMAGE_BYTES = 4.5 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT_BYTES = Math.min(DEFAULT_MAX_BYTES, 24_000);

const BrowserActionSchema = Type.Union([
  Type.Literal("open"),
  Type.Literal("snapshot"),
  Type.Literal("screenshot"),
  Type.Literal("click"),
  Type.Literal("dblclick"),
  Type.Literal("focus"),
  Type.Literal("hover"),
  Type.Literal("fill"),
  Type.Literal("type"),
  Type.Literal("press"),
  Type.Literal("keyboard_type"),
  Type.Literal("keyboard_inserttext"),
  Type.Literal("check"),
  Type.Literal("uncheck"),
  Type.Literal("select"),
  Type.Literal("scroll"),
  Type.Literal("scrollintoview"),
  Type.Literal("drag"),
  Type.Literal("upload"),
  Type.Literal("wait"),
  Type.Literal("eval"),
  Type.Literal("mouse_move"),
  Type.Literal("mouse_down"),
  Type.Literal("mouse_up"),
  Type.Literal("mouse_wheel"),
  Type.Literal("mouse_click"),
  Type.Literal("tab"),
  Type.Literal("back"),
  Type.Literal("forward"),
  Type.Literal("reload"),
  Type.Literal("get"),
  Type.Literal("is"),
  Type.Literal("find"),
  Type.Literal("console"),
  Type.Literal("errors"),
  Type.Literal("close"),
  Type.Literal("raw"),
], { description: "agent-browser operation to run" });

const AgentBrowserSchema = Type.Object({
  action: BrowserActionSchema,

  // Common targeting/input fields.
  url: Type.Optional(Type.String({ description: "URL for open/tab new/push-style navigation actions." })),
  selector: Type.Optional(Type.String({ description: "CSS selector, XPath, or agent-browser ref such as @e3." })),
  target: Type.Optional(Type.String({ description: "Second selector/ref for drag, tab id/label, find value, wait condition, or raw target." })),
  text: Type.Optional(Type.String({ description: "Text to type/fill/search/wait for, or JavaScript source for eval/wait --fn." })),
  value: Type.Optional(Type.String({ description: "Value for fill/type/select/set-style actions." })),
  values: Type.Optional(Type.Array(Type.String(), { description: "Multiple values, primarily for select or upload file paths." })),
  key: Type.Optional(Type.String({ description: "Key name for press, e.g. Enter, Tab, Control+a." })),

  // Snapshot/screenshot options.
  interactive: Type.Optional(Type.Boolean({ description: "For snapshot: only include interactive elements. Defaults to true." })),
  compact: Type.Optional(Type.Boolean({ description: "For snapshot: remove empty structural elements." })),
  includeUrls: Type.Optional(Type.Boolean({ description: "For snapshot: include href URLs for links." })),
  depth: Type.Optional(Type.Number({ description: "For snapshot: maximum tree depth." })),
  full: Type.Optional(Type.Boolean({ description: "For screenshot: capture the full page." })),
  annotate: Type.Optional(Type.Boolean({ description: "For screenshot: overlay numbered labels that map to @e refs." })),
  path: Type.Optional(Type.String({ description: "Output path for screenshot/upload/download-like actions. Relative paths resolve from the current working directory." })),
  screenshotFormat: Type.Optional(Type.Union([Type.Literal("png"), Type.Literal("jpeg")], { description: "Screenshot format. Defaults to png." })),
  screenshotQuality: Type.Optional(Type.Number({ description: "JPEG screenshot quality, 0-100." })),
  includeImage: Type.Optional(Type.Boolean({ description: "For screenshot: attach the image to the tool result. Defaults to true." })),

  // Scrolling/mouse/wait/tab/get/find options.
  direction: Type.Optional(Type.Union([Type.Literal("up"), Type.Literal("down"), Type.Literal("left"), Type.Literal("right")], { description: "Scroll direction." })),
  pixels: Type.Optional(Type.Number({ description: "Pixels for scroll or wheel delta." })),
  x: Type.Optional(Type.Number({ description: "Mouse x coordinate." })),
  y: Type.Optional(Type.Number({ description: "Mouse y coordinate." })),
  button: Type.Optional(Type.Union([Type.Literal("left"), Type.Literal("right"), Type.Literal("middle")], { description: "Mouse button." })),
  waitFor: Type.Optional(Type.Union([
    Type.Literal("selector"),
    Type.Literal("ms"),
    Type.Literal("url"),
    Type.Literal("load"),
    Type.Literal("fn"),
    Type.Literal("text"),
  ], { description: "Wait mode. Defaults to selector if selector is provided, otherwise ms if milliseconds is provided." })),
  milliseconds: Type.Optional(Type.Number({ description: "Milliseconds for wait action." })),
  loadState: Type.Optional(Type.Union([Type.Literal("load"), Type.Literal("domcontentloaded"), Type.Literal("networkidle")], { description: "Load state for wait action." })),
  tabAction: Type.Optional(Type.Union([Type.Literal("list"), Type.Literal("new"), Type.Literal("close"), Type.Literal("switch")], { description: "Tab operation. Defaults to list." })),
  label: Type.Optional(Type.String({ description: "Optional tab label for tab new." })),
  getWhat: Type.Optional(Type.Union([
    Type.Literal("text"),
    Type.Literal("html"),
    Type.Literal("value"),
    Type.Literal("attr"),
    Type.Literal("title"),
    Type.Literal("url"),
    Type.Literal("count"),
    Type.Literal("box"),
    Type.Literal("styles"),
    Type.Literal("cdp-url"),
  ], { description: "What to retrieve for get action." })),
  attrName: Type.Optional(Type.String({ description: "Attribute name for get attr." })),
  isWhat: Type.Optional(Type.Union([Type.Literal("visible"), Type.Literal("enabled"), Type.Literal("checked")], { description: "Predicate for is action." })),
  findBy: Type.Optional(Type.Union([
    Type.Literal("role"),
    Type.Literal("text"),
    Type.Literal("label"),
    Type.Literal("placeholder"),
    Type.Literal("alt"),
    Type.Literal("title"),
    Type.Literal("testid"),
    Type.Literal("first"),
    Type.Literal("last"),
    Type.Literal("nth"),
  ], { description: "Locator type for find action." })),
  findAction: Type.Optional(Type.Union([Type.Literal("click"), Type.Literal("fill"), Type.Literal("type"), Type.Literal("hover"), Type.Literal("focus"), Type.Literal("check"), Type.Literal("uncheck")], { description: "Action for find command." })),

  // Browser/session/global options.
  session: Type.Optional(Type.String({ description: "agent-browser isolated session name." })),
  profile: Type.Optional(Type.String({ description: "Chrome profile name/path for persistent login state." })),
  sessionName: Type.Optional(Type.String({ description: "agent-browser auth/session-name for auto-save/restore." })),
  statePath: Type.Optional(Type.String({ description: "Saved auth state JSON path to load. Avoid paths in public repos." })),
  autoConnect: Type.Optional(Type.Boolean({ description: "Connect to a running Chrome to reuse auth state." })),
  headed: Type.Optional(Type.Boolean({ description: "Show the browser window." })),
  cdp: Type.Optional(Type.String({ description: "Chrome DevTools Protocol port or URL." })),
  enableReactDevtools: Type.Optional(Type.Boolean({ description: "Open Chrome with React DevTools hook injected before page JS." })),
  json: Type.Optional(Type.Boolean({ description: "Ask agent-browser for JSON output where supported." })),
  maxOutputChars: Type.Optional(Type.Number({ description: "Pass --max-output to agent-browser and use it as the wrapper truncation budget." })),
  timeoutMs: Type.Optional(Type.Number({ description: "Execution timeout in milliseconds. Defaults to 30000." })),

  // Escape hatch: still safe from shell injection because args are passed directly to agent-browser.
  rawArgs: Type.Optional(Type.Array(Type.String(), { description: "Arguments after the agent-browser executable when action is raw." })),
});

type AgentBrowserInput = Static<typeof AgentBrowserSchema>;

type AgentBrowserDetails = {
  action: string;
  command: string[];
  exitCode: number;
  killed: boolean;
  outputPreview?: string;
  stderrPreview?: string;
  screenshotPath?: string;
  imageAttached?: boolean;
  imageSkippedReason?: string;
  truncation?: TruncationResult;
  fullOutputPath?: string;
};

function requireString(input: AgentBrowserInput, field: keyof AgentBrowserInput, action = input.action): string {
  const value = input[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`agent_browser action=${action} requires ${String(field)}`);
  }
  return value;
}

function requireNumber(input: AgentBrowserInput, field: keyof AgentBrowserInput, action = input.action): number {
  const value = input[field];
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new Error(`agent_browser action=${action} requires numeric ${String(field)}`);
  }
  return value;
}

function resolvePathFromCwd(cwd: string, path: string): string {
  return isAbsolute(path) ? path : resolve(cwd, path);
}

function outputExtension(format?: "png" | "jpeg", path?: string): string {
  if (path) {
    const extension = extname(path).toLowerCase();
    if (extension === ".jpg" || extension === ".jpeg") return "jpg";
    if (extension === ".png") return "png";
  }
  return format === "jpeg" ? "jpg" : "png";
}

async function defaultScreenshotPath(format?: "png" | "jpeg"): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pi-agent-browser-"));
  return join(dir, `screenshot-${randomUUID()}.${format === "jpeg" ? "jpg" : "png"}`);
}

function appendGlobalArgs(input: AgentBrowserInput): string[] {
  const args: string[] = [];
  if (input.session) args.push("--session", input.session);
  if (input.profile) args.push("--profile", input.profile);
  if (input.sessionName) args.push("--session-name", input.sessionName);
  if (input.statePath) args.push("--state", input.statePath);
  if (input.autoConnect) args.push("--auto-connect");
  if (input.headed) args.push("--headed");
  if (input.cdp) args.push("--cdp", input.cdp);
  if (input.json) args.push("--json");
  args.push("--max-output", String(Math.floor(input.maxOutputChars && input.maxOutputChars > 0 ? input.maxOutputChars : DEFAULT_MAX_OUTPUT_BYTES)));
  return args;
}

async function buildAgentBrowserArgs(input: AgentBrowserInput, cwd: string): Promise<{ args: string[]; screenshotPath?: string }> {
  const args = appendGlobalArgs(input);
  let screenshotPath: string | undefined;

  switch (input.action) {
    case "open": {
      args.push("open");
      if (input.url) args.push(input.url);
      if (input.enableReactDevtools) args.push("--enable", "react-devtools");
      break;
    }

    case "snapshot": {
      args.push("snapshot");
      if (input.interactive !== false) args.push("--interactive");
      if (input.compact !== false) args.push("--compact");
      if (input.includeUrls) args.push("--urls");
      if (typeof input.depth === "number") args.push("--depth", String(Math.floor(input.depth)));
      if (input.selector) args.push("--selector", input.selector);
      break;
    }

    case "screenshot": {
      args.push("screenshot");
      if (input.full) args.push("--full");
      if (input.annotate) args.push("--annotate");
      if (input.screenshotFormat) args.push("--screenshot-format", input.screenshotFormat);
      if (typeof input.screenshotQuality === "number") args.push("--screenshot-quality", String(Math.floor(input.screenshotQuality)));
      if (input.selector) args.push(input.selector);
      screenshotPath = input.path ? resolvePathFromCwd(cwd, input.path) : await defaultScreenshotPath(input.screenshotFormat);
      await mkdir(dirname(screenshotPath), { recursive: true });
      args.push(screenshotPath);
      break;
    }

    case "click":
    case "dblclick":
    case "focus":
    case "hover":
    case "check":
    case "uncheck":
    case "scrollintoview": {
      args.push(input.action, requireString(input, "selector"));
      break;
    }

    case "fill":
    case "type": {
      args.push(input.action, requireString(input, "selector"), input.value ?? input.text ?? "");
      break;
    }

    case "press": {
      args.push("press", requireString(input, "key"));
      break;
    }

    case "keyboard_type": {
      args.push("keyboard", "type", requireString(input, "text"));
      break;
    }

    case "keyboard_inserttext": {
      args.push("keyboard", "inserttext", requireString(input, "text"));
      break;
    }

    case "select": {
      args.push("select", requireString(input, "selector"));
      const values = input.values?.length ? input.values : [input.value ?? input.text ?? ""];
      args.push(...values);
      break;
    }

    case "scroll": {
      args.push("scroll", input.direction ?? "down");
      if (typeof input.pixels === "number") args.push(String(Math.floor(input.pixels)));
      if (input.selector) args.push("--selector", input.selector);
      break;
    }

    case "drag": {
      args.push("drag", requireString(input, "selector"), requireString(input, "target"));
      break;
    }

    case "upload": {
      args.push("upload", requireString(input, "selector"));
      const files = input.values?.length ? input.values : [requireString(input, "path")];
      args.push(...files.map((file) => resolvePathFromCwd(cwd, file)));
      break;
    }

    case "wait": {
      const mode = input.waitFor ?? (input.selector ? "selector" : typeof input.milliseconds === "number" ? "ms" : undefined);
      if (mode === "selector") args.push("wait", requireString(input, "selector"));
      else if (mode === "ms") args.push("wait", String(Math.floor(requireNumber(input, "milliseconds"))));
      else if (mode === "url") args.push("wait", "--url", requireString(input, "target"));
      else if (mode === "load") args.push("wait", "--load", input.loadState ?? "networkidle");
      else if (mode === "fn") args.push("wait", "--fn", requireString(input, "text"));
      else if (mode === "text") args.push("wait", "--text", requireString(input, "text"));
      else throw new Error("agent_browser action=wait requires selector, milliseconds, or waitFor");
      break;
    }

    case "eval": {
      const script = Buffer.from(requireString(input, "text"), "utf8").toString("base64");
      args.push("eval", "--base64", script);
      break;
    }

    case "mouse_move": {
      args.push("mouse", "move", String(Math.floor(requireNumber(input, "x"))), String(Math.floor(requireNumber(input, "y"))));
      break;
    }

    case "mouse_down": {
      args.push("mouse", "down");
      if (input.button) args.push(input.button);
      break;
    }

    case "mouse_up": {
      args.push("mouse", "up");
      if (input.button) args.push(input.button);
      break;
    }

    case "mouse_wheel": {
      args.push("mouse", "wheel", String(Math.floor(input.pixels ?? 300)));
      if (typeof input.x === "number") args.push(String(Math.floor(input.x)));
      break;
    }

    case "mouse_click": {
      const x = Math.floor(requireNumber(input, "x"));
      const y = Math.floor(requireNumber(input, "y"));
      const button = input.button ?? "left";
      args.push("batch", "--bail", `mouse move ${x} ${y}`, `mouse down ${button}`, `mouse up ${button}`);
      break;
    }

    case "tab": {
      args.push("tab");
      const op = input.tabAction ?? "list";
      if (op === "list") args.push("list");
      else if (op === "new") {
        args.push("new");
        if (input.label) args.push("--label", input.label);
        if (input.url) args.push(input.url);
      } else if (op === "close") {
        args.push("close");
        if (input.target) args.push(input.target);
      } else if (op === "switch") {
        args.push(requireString(input, "target"));
      }
      break;
    }

    case "back":
    case "forward":
    case "reload":
    case "console":
    case "errors": {
      args.push(input.action);
      break;
    }

    case "close": {
      args.push("close");
      if (input.target === "all") args.push("--all");
      break;
    }

    case "get": {
      const what = input.getWhat ?? requireString(input, "target");
      args.push("get", what);
      if (["text", "html", "value", "count", "box", "styles"].includes(what)) {
        args.push(requireString(input, "selector"));
      } else if (what === "attr") {
        args.push(requireString(input, "selector"), requireString(input, "attrName"));
      }
      break;
    }

    case "is": {
      args.push("is", input.isWhat ?? requireString(input, "target"), requireString(input, "selector"));
      break;
    }

    case "find": {
      const action = input.findAction ?? "click";
      const locatorValue = input.target ?? input.selector ?? input.text ?? input.value ?? "";
      args.push("find", input.findBy ?? "text", locatorValue, action);
      if (["fill", "type"].includes(action)) args.push(input.value ?? input.text ?? "");
      break;
    }

    case "raw": {
      if (!input.rawArgs?.length) throw new Error("agent_browser action=raw requires rawArgs");
      args.push(...input.rawArgs);
      break;
    }

    default: {
      const neverAction: never = input.action;
      throw new Error(`Unsupported agent_browser action: ${neverAction}`);
    }
  }

  return { args, screenshotPath };
}

async function maybeWriteFullOutput(fullOutput: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pi-agent-browser-output-"));
  const path = join(dir, "output.txt");
  await writeFile(path, fullOutput, "utf8");
  return path;
}

function truncateOutput(output: string, maxBytes: number): TruncationResult {
  return truncateTail(output, { maxBytes, maxLines: 2_000 });
}

async function buildScreenshotContent(path: string, format?: "png" | "jpeg", includeImage = true) {
  const bytes = await readFile(path);
  const mediaType = outputExtension(format, path) === "jpg" ? "image/jpeg" : "image/png";

  if (!includeImage) {
    return { imageContent: undefined, imageAttached: false, imageSkippedReason: "includeImage=false", imageBytes: bytes.length, mediaType };
  }

  if (bytes.length > MAX_IMAGE_BYTES) {
    return {
      imageContent: undefined,
      imageAttached: false,
      imageSkippedReason: `image is ${formatSize(bytes.length)}, larger than ${formatSize(MAX_IMAGE_BYTES)}`,
      imageBytes: bytes.length,
      mediaType,
    };
  }

  return {
    imageContent: { type: "image" as const, data: bytes.toString("base64"), mimeType: mediaType },
    imageAttached: true,
    imageSkippedReason: undefined,
    imageBytes: bytes.length,
    mediaType,
  };
}

function renderArgs(args: string[]): string {
  return ["agent-browser", ...args].map((arg) => (/[\s"']/.test(arg) ? JSON.stringify(arg) : arg)).join(" ");
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "agent_browser",
    label: "Agent Browser",
    description: "Control Chrome/Chromium using the agent-browser CLI. Supports accessibility snapshots, annotated screenshots returned as images, element refs, keyboard/mouse actions, JavaScript eval, tabs, and session/profile options.",
    promptSnippet: "Control Chrome through agent-browser, including snapshots, clicks, typing, screenshots, and mouse actions.",
    promptGuidelines: [
      "Use agent_browser when the user asks to interact with, inspect, test, or screenshot a website or browser app.",
      "Use agent_browser action=snapshot before clicking refs; @e refs become stale after navigation, rerenders, dialogs, or other page changes, so re-snapshot after interactions.",
      "Use agent_browser action=screenshot with annotate=true when the accessibility snapshot is incomplete, ambiguous, visual/canvas-heavy, or you need coordinates; labels [N] map to @eN refs.",
      "Use agent_browser mouse actions only after inspecting a screenshot; prefer refs/selectors when available.",
      "Do not save cookies, auth state, screenshots, or other sensitive browser artifacts into this public repo unless the user explicitly asks; prefer temp paths or files outside the repo.",
    ],
    parameters: AgentBrowserSchema,
    executionMode: "sequential",

    async execute(_toolCallId, input, signal, onUpdate, ctx) {
      const { args, screenshotPath } = await buildAgentBrowserArgs(input, ctx.cwd);
      const command = renderArgs(args);
      onUpdate?.({
        content: [{ type: "text", text: `Running ${command}` }],
        details: { action: input.action, command: ["agent-browser", ...args] },
      });

      let result;
      try {
        result = await pi.exec("agent-browser", args, {
          cwd: ctx.cwd,
          signal,
          timeout: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: `Failed to run ${command}: ${message}` }],
          details: {
            action: input.action,
            command: ["agent-browser", ...args],
            exitCode: -1,
            killed: false,
            stderrPreview: message,
          } satisfies AgentBrowserDetails,
        };
      }

      const outputParts = [];
      if (result.stdout.trim().length > 0) outputParts.push(result.stdout.trimEnd());
      if (result.stderr.trim().length > 0) outputParts.push(`[stderr]\n${result.stderr.trimEnd()}`);
      const rawOutput = outputParts.join("\n\n");
      const maxBytes = Math.max(1_000, Math.floor(input.maxOutputChars ?? DEFAULT_MAX_OUTPUT_BYTES));
      const truncation = truncateOutput(rawOutput, maxBytes);
      const fullOutputPath = truncation.truncated ? await maybeWriteFullOutput(rawOutput) : undefined;

      const textLines = [
        `Command: ${command}`,
        `Exit code: ${result.code}${result.killed ? " (killed)" : ""}`,
      ];
      if (screenshotPath) textLines.push(`Screenshot: ${screenshotPath}`);
      if (truncation.content.length > 0) textLines.push("", truncation.content);
      if (fullOutputPath) textLines.push("", `Output truncated (${formatSize(truncation.totalBytes)} total). Full output: ${fullOutputPath}`);

      const content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> = [
        { type: "text", text: textLines.join("\n") },
      ];

      let imageAttached: boolean | undefined;
      let imageSkippedReason: string | undefined;
      if (screenshotPath && result.code === 0) {
        try {
          const screenshot = await buildScreenshotContent(screenshotPath, input.screenshotFormat, input.includeImage !== false);
          imageAttached = screenshot.imageAttached;
          imageSkippedReason = screenshot.imageSkippedReason;
          if (screenshot.imageContent) content.push(screenshot.imageContent);
          if (screenshot.imageSkippedReason) {
            content[0].text += `\nImage not attached: ${screenshot.imageSkippedReason}`;
          } else if (screenshot.imageAttached) {
            content[0].text += `\nImage attached (${formatSize(screenshot.imageBytes)}, ${screenshot.mediaType}).`;
          }
        } catch (error) {
          imageAttached = false;
          imageSkippedReason = error instanceof Error ? error.message : String(error);
          content[0].text += `\nImage not attached: ${imageSkippedReason}`;
        }
      }

      return {
        content,
        details: {
          action: input.action,
          command: ["agent-browser", ...args],
          exitCode: result.code,
          killed: result.killed,
          outputPreview: truncation.content,
          stderrPreview: result.stderr ? truncateOutput(result.stderr, 4_000).content : undefined,
          screenshotPath,
          imageAttached,
          imageSkippedReason,
          truncation,
          fullOutputPath,
        } satisfies AgentBrowserDetails,
      };
    },

    renderCall(args, theme) {
      const action = typeof args.action === "string" ? args.action : "unknown";
      const target = typeof args.url === "string" ? args.url : typeof args.selector === "string" ? args.selector : typeof args.target === "string" ? args.target : "";
      const suffix = target ? ` ${theme.fg("muted", target)}` : "";
      return new Text(theme.fg("toolTitle", theme.bold("agent-browser ")) + theme.fg("accent", action) + suffix, 0, 0);
    },

    renderResult(toolResult, options, theme) {
      const details = toolResult.details as AgentBrowserDetails | undefined;
      const status = details?.exitCode === 0 ? theme.fg("success", "✓") : theme.fg("warning", `exit ${details?.exitCode ?? "?"}`);
      let text = `${status} ${theme.fg("muted", details?.command?.join(" ") ?? "agent-browser")}`;
      if (details?.screenshotPath) text += `\n${theme.fg("dim", `screenshot: ${details.screenshotPath}`)}`;
      if (details?.imageAttached) text += `\n${theme.fg("success", "image attached")}`;
      if (details?.imageSkippedReason) text += `\n${theme.fg("warning", `image not attached: ${details.imageSkippedReason}`)}`;
      if (details?.fullOutputPath) text += `\n${theme.fg("warning", `output truncated: ${details.fullOutputPath}`)}`;

      if (options.expanded) {
        const first = toolResult.content[0];
        if (first?.type === "text") {
          const lines = first.text.split("\n").slice(0, 40);
          text += `\n${theme.fg("dim", lines.join("\n"))}`;
        }
      }

      return new Text(text, 0, 0);
    },
  });
}
