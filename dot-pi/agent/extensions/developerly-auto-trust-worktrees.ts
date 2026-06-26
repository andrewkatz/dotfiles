import {
  getAgentDir,
  type ExtensionAPI,
  type ProjectTrustEventResult,
} from "@earendil-works/pi-coding-agent";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

// Automatically trust disposable git worktrees when their root/main worktree is
// already trusted. The inherited decision is intentionally not remembered: Pi
// will ask this extension again on future starts, which avoids filling
// ~/.pi/agent/trust.json with short-lived worktree paths.

type TrustStore = Record<string, boolean | undefined>;

interface WorktreeInheritance {
  parentRoot: string;
  currentRoot: string;
  correspondingParentPath: string;
}

function normalizePath(path: string): string {
  try {
    return realpathSync.native(path);
  } catch {
    return resolve(path);
  }
}

function pathIsInsideOrEqual(path: string, ancestor: string): boolean {
  const rel = relative(ancestor, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function gitOutput(cwd: string, args: string[]): string | undefined {
  try {
    const output = execFileSync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return output.length > 0 ? output : undefined;
  } catch {
    return undefined;
  }
}

function gitPath(cwd: string, revParseArg: "--show-toplevel" | "--git-common-dir"): string | undefined {
  const output = gitOutput(cwd, ["rev-parse", "--path-format=absolute", revParseArg]);
  return output ? normalizePath(output) : undefined;
}

function readTrustStore(): TrustStore {
  const trustPath = join(getAgentDir(), "trust.json");
  if (!existsSync(trustPath)) return {};

  try {
    const parsed = JSON.parse(readFileSync(trustPath, "utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return {};
    }

    const trust: TrustStore = {};
    for (const [path, decision] of Object.entries(parsed)) {
      if (decision === true || decision === false) {
        trust[normalizePath(path)] = decision;
      }
    }
    return trust;
  } catch {
    // Never break Pi startup because the trust store is temporarily unreadable
    // or being written by another process.
    return {};
  }
}

function nearestTrustDecision(path: string, stopAt: string, trust: TrustStore): boolean | undefined {
  let current = normalizePath(path);
  const stop = normalizePath(stopAt);

  if (!pathIsInsideOrEqual(current, stop)) return undefined;

  while (true) {
    const decision = trust[current];
    if (decision !== undefined) return decision;
    if (current === stop) return undefined;

    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function getWorktreeInheritance(cwd: string): WorktreeInheritance | undefined {
  const normalizedCwd = normalizePath(cwd);
  const currentRoot = gitPath(normalizedCwd, "--show-toplevel");
  const commonGitDir = gitPath(normalizedCwd, "--git-common-dir");

  if (!currentRoot || !commonGitDir) return undefined;
  if (basename(commonGitDir) !== ".git") return undefined;

  const parentRoot = normalizePath(dirname(commonGitDir));
  if (parentRoot === currentRoot) return undefined;

  // Make sure the common .git directory actually belongs to a worktree root and
  // not a bare repo, submodule gitdir, or other custom git layout.
  const parentTopLevel = gitPath(parentRoot, "--show-toplevel");
  if (parentTopLevel !== parentRoot) return undefined;

  const relFromCurrentRoot = relative(currentRoot, normalizedCwd);
  if (relFromCurrentRoot.startsWith("..") || isAbsolute(relFromCurrentRoot)) {
    return undefined;
  }

  const correspondingParentPath = normalizePath(resolve(parentRoot, relFromCurrentRoot));
  if (!pathIsInsideOrEqual(correspondingParentPath, parentRoot)) return undefined;

  return { parentRoot, currentRoot, correspondingParentPath };
}

function shouldInheritTrust(cwd: string): WorktreeInheritance | undefined {
  const inheritance = getWorktreeInheritance(cwd);
  if (!inheritance) return undefined;

  const decision = nearestTrustDecision(
    inheritance.correspondingParentPath,
    inheritance.parentRoot,
    readTrustStore(),
  );

  // A matching false decision blocks inheritance but falls through to Pi's
  // normal trust flow instead of silently auto-denying the worktree.
  return decision === true ? inheritance : undefined;
}

export default function (pi: ExtensionAPI) {
  pi.on("project_trust", (event, ctx): ProjectTrustEventResult => {
    const inheritance = shouldInheritTrust(event.cwd);
    if (!inheritance) return { trusted: "undecided" };

    if (process.env.PI_AUTO_TRUST_WORKTREES_DEBUG && ctx.hasUI) {
      ctx.ui.notify(
        `Trusting ${inheritance.currentRoot} because parent worktree is trusted: ${inheritance.parentRoot}`,
        "info",
      );
    }

    return { trusted: "yes" };
  });
}
