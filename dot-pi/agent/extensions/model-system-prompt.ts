import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Append extra system-prompt instructions conditional on the active model.
 *
 * Pi has no built-in per-model system prompt, but `before_agent_start` can
 * rewrite the system prompt for the turn and `ctx.model` tells us which model
 * is active (`.provider` like "anthropic"/"openai", `.id` like the model id).
 *
 * Add/adjust entries in RULES below. Matching is additive: every block whose
 * predicate matches is appended, in order.
 */

type Rule = {
  /** Return true to append `text` for the active model. */
  match: (model: { provider: string; id: string }) => boolean;
  text: string;
};

// Instructions appended for model families that tend to add social filler.
const CONCISE_STYLE_GUIDANCE = `
NO COMPLIMENTS / NO VALIDATION (override default style where it conflicts):
- Never affirm, validate, or compliment the user. Ban these and any paraphrase:
  "You're absolutely right", "You're right", "You're right to push back",
  "Good point", "Good catch", "Great question", "Great idea", "Excellent",
  "Fair enough", "That makes sense", "Nice work", "Smart", "Love it".
- Do not start a reply by agreeing with or praising the user. Start with the
  substance: the answer, the fix, or the disagreement.
- When the user corrects you, do not say they're right. Just state what's
  actually true and move on. If they're wrong, say so plainly.
- Do not praise the user's idea, code, plan, or approach unless explicitly asked
  to evaluate it -- and then be honest, including the downsides.
- No filler preambles ("Let me", "I'll go ahead and", "Sure!", "Of course!") and
  no summary postambles restating what you just did. Lead with the result.
- Don't hedge with "I think" / "it seems" when you can verify. Verify, then state.
- No emoji unless the user uses them first.
- Match the user's brevity. Short question gets a short answer, not an essay.
`.trim();

function isOpenAiOrGptFamily(model: { provider: string; id: string }): boolean {
  const provider = model.provider.toLowerCase();
  const id = model.id.toLowerCase();
  return provider === "openai" || id.includes("gpt") || id.includes("codex");
}

const RULES: Rule[] = [
  {
    match: (m) => m.provider.toLowerCase() === "anthropic" || isOpenAiOrGptFamily(m),
    text: CONCISE_STYLE_GUIDANCE,
  },
  // Example: target a specific model id instead of a whole provider:
  // {
  //   match: (m) => m.id.includes("gpt-5"),
  //   text: "Be terse. No bullet-point spam.",
  // },
];

export default function (pi: ExtensionAPI) {
  pi.on("before_agent_start", async (event, ctx) => {
    const model = ctx.model;
    if (!model) return;

    const additions = RULES.filter((r) => r.match(model)).map((r) => r.text);
    if (additions.length === 0) return;

    return {
      systemPrompt: `${event.systemPrompt}\n\n${additions.join("\n\n")}`,
    };
  });
}
