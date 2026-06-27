import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Personal per-model system-prompt additions, kept in a uniquely-named file the
 * Developerly updater does not own.
 *
 * Why this exists separately from `developerly-model-system-prompt.ts`:
 * the updater regenerates every `developerly-*` extension on each sync. Anything
 * personal merged into that file would be clobbered, and a renamed copy would
 * collide with the re-synced original (that is the exact bug that kept breaking
 * `ask_user_question`). Keeping these rules in `katz-*` means they survive syncs
 * and never duplicate the developerly extension.
 *
 * Only put rules here that developerly's version does NOT already inject. The
 * no-compliments / concise-style block lives in `developerly-model-system-prompt.ts`
 * and must NOT be repeated here, or it would be appended to the system prompt twice.
 */

type Rule = {
  /** Return true to append `text` for the active model. */
  match: (model: { provider: string; id: string }) => boolean;
  text: string;
};

// Time-zone instructions. Applied to every model so all reported times stay
// consistent regardless of the underlying source timestamps.
const TIMEZONE_GUIDANCE = `
TIME ZONES:
- Always express times in PST. This includes future events, schedules, debugging
  timelines, log analysis, CI/build runs, deploys, and status updates.
- When source data is in another zone (UTC, local machine time, server/log time),
  convert it to PST before presenting it. Include the original timestamp only
  when needed for traceability, after the PST time.
`.trim();

// Design-fidelity instructions. Applied to every model: matching a design
// exactly is task behavior, not a per-model style quirk.
const DESIGN_FIDELITY_GUIDANCE = `
DESIGN IMPLEMENTATION (exact, not approximate):
- When given a design, implement it pixel-perfect. Match every value exactly:
  spacing, sizing, color, typography, font weight, radii, shadows, line-height,
  letter-spacing.
- If given code/CSS generated from a design, you may rename selectors and
  refactor the structure to fit the project's CSS conventions and design
  system -- design tools often emit garbage that does not fit the setup, and
  adapting it is expected. But preserve every value exactly so it renders
  identically: do not round, drop, or alter spacing, sizes, colors, weights,
  etc. Adapt the structure, keep the values.
- If a design value conflicts with the design system (a token, a component, or
  an existing convention), STOP and ask before deviating. Do not silently pick one.
- If given only a screenshot (no source values), measure it -- do not eyeball
  it. Extract exact pixel values, colors, and spacing from the image, or ask
  for the source file if you cannot measure it reliably.
- The bar: a screenshot of your implementation placed next to the design should
  be indistinguishable from it. If you cannot hit that, say what is blocking it
  instead of shipping an approximation.
`.trim();

const RULES: Rule[] = [
  {
    match: () => true,
    text: TIMEZONE_GUIDANCE,
  },
  {
    match: () => true,
    text: DESIGN_FIDELITY_GUIDANCE,
  },
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
