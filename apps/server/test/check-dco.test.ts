import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const script = fileURLToPath(new URL("../../../.github/scripts/check-dco.sh", import.meta.url));
const dependabot = { name: "dependabot[bot]", email: "49699333+dependabot[bot]@users.noreply.github.com" };
const alice = { name: "Alice Example", email: "alice@example.com" };

let repo = "";
const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();

/** An empty commit by `author`, signed off when `signOff` is set; returns its SHA. */
function commit(author: { name: string; email: string }, signOff: boolean): string {
  const id = `${author.name} <${author.email}>`;
  git(
    "commit",
    "--allow-empty",
    "-q",
    "-m",
    "chore: change",
    ...(signOff ? ["-m", `Signed-off-by: ${id}`] : []),
    `--author=${id}`,
  );
  return git("rev-parse", "HEAD");
}

function check(base: string, head: string) {
  const result = spawnSync("bash", [script, base, head], { cwd: repo, encoding: "utf8" });
  return { ok: result.status === 0, output: result.stdout };
}

describe("check-dco.sh", () => {
  let base = "";

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "wickwatch-dco-"));
    git("init", "-q");
    git("config", "user.name", alice.name);
    git("config", "user.email", alice.email);
    git("config", "commit.gpgsign", "false");
    base = commit(alice, true);
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it("passes signed-off commits", () => {
    expect(check(base, commit(alice, true)).ok).toBe(true);
  });

  it("fails a commit without sign-off", () => {
    const result = check(base, commit(alice, false));
    expect(result.ok).toBe(false);
    expect(result.output).toContain(`lacks 'Signed-off-by: ${alice.name} <${alice.email}>'`);
  });

  it("exempts Dependabot's commits", () => {
    commit(dependabot, false);
    expect(check(base, commit(alice, true)).ok).toBe(true);
  });

  it("does not exempt a commit that only borrows Dependabot's name", () => {
    expect(check(base, commit({ name: dependabot.name, email: alice.email }, false)).ok).toBe(false);
  });
});
