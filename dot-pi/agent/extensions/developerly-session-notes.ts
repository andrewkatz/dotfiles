import { DynamicBorder, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Container, type SelectItem, SelectList, Text } from "@earendil-works/pi-tui";
import { randomUUID } from "node:crypto";

const CUSTOM_TYPE = "session-notes";
const STATUS_ID = "session-notes";
const WIDGET_ID = "session-notes-widget";
const MAX_VISIBLE_NOTES = 12;

type SessionNote = {
	id: string;
	text: string;
	createdAt: string;
};

type NoteEntryData =
	| { action: "add"; note: SessionNote }
	| { action: "consume"; id: string; consumedAt: string }
	| { action: "clear"; ids: string[]; clearedAt: string };

type CustomEntryLike = {
	type?: string;
	customType?: string;
	data?: unknown;
};

function isSessionNote(value: unknown): value is SessionNote {
	if (!value || typeof value !== "object") return false;
	const note = value as Partial<SessionNote>;
	return typeof note.id === "string" && typeof note.text === "string" && typeof note.createdAt === "string";
}

function isNoteEntryData(value: unknown): value is NoteEntryData {
	if (!value || typeof value !== "object") return false;
	const data = value as {
		action?: unknown;
		note?: unknown;
		id?: unknown;
		consumedAt?: unknown;
		ids?: unknown;
		clearedAt?: unknown;
	};

	if (data.action === "add") return isSessionNote(data.note);
	if (data.action === "consume") return typeof data.id === "string" && typeof data.consumedAt === "string";
	if (data.action === "clear") {
		return Array.isArray(data.ids) && data.ids.every((id) => typeof id === "string") && typeof data.clearedAt === "string";
	}

	return false;
}

function collapseWhitespace(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

function noteLabel(note: SessionNote): string {
	return collapseWhitespace(note.text) || "(blank note)";
}

function formatTimestamp(value: string): string {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return "unknown time";
	return date.toLocaleString();
}

function appendToEditor(existing: string, addition: string): string {
	if (!existing) return addition;
	if (existing.endsWith("\n")) return `${existing}${addition}`;
	return `${existing}\n${addition}`;
}

function pendingNotesText(count: number): string {
	return `${count} note${count === 1 ? "" : "s"} pending`;
}

async function chooseInsertionText(noteText: string, ctx: ExtensionContext): Promise<string | null> {
	const currentText = ctx.ui.getEditorText();
	if (!currentText.trim()) return noteText;

	const choice = await ctx.ui.select("Editor already has text. Insert selected note how?", [
		"Replace editor text",
		"Append to editor text",
		"Cancel",
	]);

	if (choice === "Replace editor text") return noteText;
	if (choice === "Append to editor text") return appendToEditor(currentText, noteText);
	return null;
}

export default function sessionNotes(pi: ExtensionAPI) {
	let notes: SessionNote[] = [];
	let latestCtx: ExtensionContext | undefined;

	function syncStatus(ctx = latestCtx): void {
		if (!ctx?.hasUI) return;
		latestCtx = ctx;

		if (notes.length === 0) {
			ctx.ui.setStatus(STATUS_ID, undefined);
			ctx.ui.setWidget(WIDGET_ID, undefined);
			return;
		}

		ctx.ui.setStatus(STATUS_ID, ctx.ui.theme.fg("accent", `notes ${notes.length}`));
		ctx.ui.setWidget(WIDGET_ID, (_tui, theme) => new Text(
			`${theme.fg("accent", theme.bold(`📝 ${pendingNotesText(notes.length)}`))}${theme.fg("dim", " — /notes")}`,
			0,
			0,
		));
	}

	function reconstructState(ctx: ExtensionContext): void {
		const active = new Map<string, SessionNote>();

		for (const entry of ctx.sessionManager.getBranch() as CustomEntryLike[]) {
			if (entry.type !== "custom" || entry.customType !== CUSTOM_TYPE || !isNoteEntryData(entry.data)) continue;

			if (entry.data.action === "add") {
				active.set(entry.data.note.id, entry.data.note);
			} else if (entry.data.action === "consume") {
				active.delete(entry.data.id);
			} else if (entry.data.action === "clear") {
				for (const id of entry.data.ids) active.delete(id);
			}
		}

		notes = Array.from(active.values());
	}

	function addNote(text: string, ctx: ExtensionContext): void {
		const note: SessionNote = {
			id: randomUUID(),
			text,
			createdAt: new Date().toISOString(),
		};

		pi.appendEntry<NoteEntryData>(CUSTOM_TYPE, { action: "add", note });
		notes.push(note);
		syncStatus(ctx);
		ctx.ui.notify(`Saved note (${notes.length} pending). Use /notes to pick it later.`, "info");
	}

	function consumeNote(id: string, ctx: ExtensionContext): void {
		pi.appendEntry<NoteEntryData>(CUSTOM_TYPE, {
			action: "consume",
			id,
			consumedAt: new Date().toISOString(),
		});
		notes = notes.filter((note) => note.id !== id);
		syncStatus(ctx);
	}

	function clearNotes(ctx: ExtensionContext): void {
		const ids = notes.map((note) => note.id);
		if (ids.length === 0) return;

		pi.appendEntry<NoteEntryData>(CUSTOM_TYPE, {
			action: "clear",
			ids,
			clearedAt: new Date().toISOString(),
		});
		notes = [];
		syncStatus(ctx);
	}

	async function selectNote(ctx: ExtensionContext): Promise<SessionNote | null> {
		const items: SelectItem[] = notes.map((note, index) => ({
			value: note.id,
			label: `${index + 1}. ${noteLabel(note)}`,
			description: `added ${formatTimestamp(note.createdAt)}`,
		}));

		const selectedId = await ctx.ui.custom<string | null>((tui, theme, _keybindings, done) => {
			const container = new Container();
			container.addChild(new DynamicBorder((text) => theme.fg("accent", text)));
			container.addChild(new Text(theme.fg("accent", theme.bold("Session Notes"))));

			const selectList = new SelectList(items, Math.min(items.length, MAX_VISIBLE_NOTES), {
				selectedPrefix: (text) => theme.fg("accent", text),
				selectedText: (text) => theme.fg("accent", text),
				description: (text) => theme.fg("muted", text),
				scrollInfo: (text) => theme.fg("dim", text),
				noMatch: (text) => theme.fg("warning", text),
			});

			selectList.onSelect = (item) => done(item.value);
			selectList.onCancel = () => done(null);

			container.addChild(selectList);
			container.addChild(new Text(theme.fg("dim", "↑↓ navigate • enter select/use note • esc cancel")));
			container.addChild(new DynamicBorder((text) => theme.fg("accent", text)));

			return {
				render(width: number) {
					return container.render(width);
				},
				invalidate() {
					container.invalidate();
				},
				handleInput(data: string) {
					selectList.handleInput(data);
					tui.requestRender();
				},
			};
		});

		if (!selectedId) return null;
		return notes.find((note) => note.id === selectedId) ?? null;
	}

	pi.registerCommand("note", {
		description: "Store a session-local note for later prompting",
		handler: async (args, ctx) => {
			latestCtx = ctx;
			const text = args.trim();

			if (!text) {
				ctx.ui.notify("Usage: /note <note text>", "warning");
				return;
			}

			addNote(text, ctx);
		},
	});

	pi.registerCommand("notes", {
		description: "Pick a stored session note and put it in the prompt editor",
		getArgumentCompletions: (prefix) => {
			const commands = ["clear"];
			const filtered = commands.filter((command) => command.startsWith(prefix));
			return filtered.length > 0 ? filtered.map((command) => ({ value: command, label: command })) : null;
		},
		handler: async (args, ctx) => {
			latestCtx = ctx;
			reconstructState(ctx);
			syncStatus(ctx);

			const subcommand = args.trim();
			if (subcommand === "clear") {
				if (notes.length === 0) {
					ctx.ui.notify("No stored session notes", "info");
					return;
				}

				const confirmed = await ctx.ui.confirm("Clear session notes?", `Remove ${notes.length} pending note${notes.length === 1 ? "" : "s"}?`);
				if (!confirmed) return;

				clearNotes(ctx);
				ctx.ui.notify("Session notes cleared", "info");
				return;
			}

			if (subcommand) {
				ctx.ui.notify("Usage: /notes or /notes clear", "warning");
				return;
			}

			if (!ctx.hasUI) {
				ctx.ui.notify("/notes requires interactive UI", "warning");
				return;
			}

			if (notes.length === 0) {
				ctx.ui.notify("No stored session notes", "info");
				return;
			}

			const note = await selectNote(ctx);
			if (!note) return;

			const editorText = await chooseInsertionText(note.text, ctx);
			if (editorText === null) return;

			ctx.ui.setEditorText(editorText);
			consumeNote(note.id, ctx);
			ctx.ui.notify("Note moved to prompt editor", "info");
		},
	});

	pi.on("session_start", (_event, ctx) => {
		latestCtx = ctx;
		reconstructState(ctx);
		syncStatus(ctx);
	});

	pi.on("session_tree", (_event, ctx) => {
		latestCtx = ctx;
		reconstructState(ctx);
		syncStatus(ctx);
	});

	pi.on("session_shutdown", () => {
		notes = [];
		latestCtx = undefined;
	});
}
