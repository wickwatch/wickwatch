import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import { AdapterError, type Credentials } from "@wickwatch/core";
import { cliError, SecretFile, type CliOptions } from "./cli";

const PROMPT = "> ";

/**
 * One long-running interactive CLI shell for one account. Commands go in via stdin and run one
 * at a time; an answer is everything between the echoed command line and the next prompt.
 * Keeping the session open avoids a 3–5 s login per query, and history commands only return
 * data once the session is warm (see the warm-up in start()).
 */
export class CliSession {
  private child: ChildProcessWithoutNullStreams | undefined;
  private buffer = "";
  private queue: Promise<unknown> = Promise.resolve();
  private waiter: ((text: string) => void) | undefined;
  private secret: SecretFile | undefined;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private closed = false;
  /** Set when the process ended; the pool then replaces the session. */
  dead = false;

  constructor(
    private readonly options: CliOptions,
    private readonly credentials: Credentials,
    private readonly account: string,
    private readonly onIdle: () => void,
  ) {}

  async start(): Promise<void> {
    this.secret = await SecretFile.create(this.credentials.secret);
    const args = [`--ctid=${this.credentials.login}`, `--pwd-file=${this.secret.path}`, `--account=${this.account}`];
    const child = spawn(this.options.binary, [...(this.options.binaryArgs ?? []), ...args], { stdio: "pipe" });
    this.child = child;
    child.stdout.on("data", (d: Buffer) => {
      this.buffer += d.toString();
      this.check();
    });
    child.stderr.on("data", (d: Buffer) => {
      this.buffer += d.toString();
    });
    child.on("close", () => {
      this.dead = true;
      void this.secret?.remove();
      this.check();
    });
    child.on("error", () => {
      this.dead = true;
    });

    try {
      await this.untilPrompt(this.options.connectTimeoutMs, true);
    } catch (error) {
      const output = this.buffer;
      await this.close();
      throw error instanceof AdapterError && error.code === "timeout"
        ? error
        : cliError(output, "cTrader CLI session failed");
    }
    this.buffer = "";
    // The first history query of a session comes back empty; this one is thrown away.
    await this.run("orders-history 1").catch(() => undefined);
    this.touch();
  }

  /** Runs one command and returns its raw answer (JSON or an "Error: …" line). */
  run(command: string): Promise<string> {
    const result = this.queue.then(() => this.exec(command));
    this.queue = result.catch(() => undefined);
    return result;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.idleTimer);
    if (this.child && !this.dead) {
      this.child.stdin.write("q\n");
      const child = this.child;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          resolve();
        }, 5000);
        child.once("close", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    this.dead = true;
    await this.secret?.remove();
  }

  private async exec(command: string): Promise<string> {
    if (this.dead || !this.child) throw new AdapterError("unavailable", "cTrader CLI session ended");
    this.buffer = "";
    this.child.stdin.write(`${command}\n`);
    const text = await this.untilPrompt(this.options.commandTimeoutMs, false);
    this.touch();
    // Drop the echo line "[2026-09-27 17:22:39 +02:00] account 123"; keep the answer.
    const answer = text.replace(/^\[[^\]]*\][^\n]*\n/, "").trim();
    if (/^error:/i.test(answer)) throw cliError(answer);
    return answer;
  }

  /** Waits for the prompt at the start of a line; resolves with everything before it. */
  private untilPrompt(timeoutMs: number, atStartup: boolean): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiter = undefined;
        if (!atStartup) void this.close();
        reject(new AdapterError("timeout", `cTrader CLI did not answer within ${String(timeoutMs)} ms`));
      }, timeoutMs);
      this.waiter = (text) => {
        clearTimeout(timer);
        this.waiter = undefined;
        if (text === "\u0000dead") reject(cliError(this.buffer, "cTrader CLI session ended"));
        else resolve(text);
      };
      this.check();
    });
  }

  private check(): void {
    if (!this.waiter) return;
    const at = this.buffer.startsWith(PROMPT) ? 0 : this.buffer.indexOf(`\n${PROMPT}`);
    if (at >= 0) {
      const text = this.buffer.slice(0, at);
      this.buffer = this.buffer.slice(at + (at === 0 ? 0 : 1) + PROMPT.length);
      this.waiter(text);
    } else if (this.dead) {
      this.waiter("\u0000dead");
    }
  }

  private touch(): void {
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      void this.close().then(this.onIdle);
    }, this.options.sessionIdleMs);
    this.idleTimer.unref();
  }
}

/** One session per cTrader ID, account and password; a changed password starts a new session. */
export class SessionPool {
  private readonly sessions = new Map<string, Promise<CliSession>>();

  constructor(private readonly options: CliOptions) {}

  async run(credentials: Credentials, account: string, command: string): Promise<string> {
    const session = await this.get(credentials, account);
    return session.run(command);
  }

  async closeAll(): Promise<void> {
    const sessions = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.all(sessions.map(async (s) => (await s.catch(() => undefined))?.close()));
  }

  private get(credentials: Credentials, account: string): Promise<CliSession> {
    const key = createHash("sha256")
      .update(`${credentials.login}\u0000${credentials.secret}\u0000${account}`)
      .digest("hex");
    const existing = this.sessions.get(key);
    if (existing) {
      return existing.then((s) => {
        if (!s.dead) return s;
        this.sessions.delete(key);
        return this.get(credentials, account);
      });
    }
    const session = new CliSession(this.options, credentials, account, () => this.sessions.delete(key));
    const started = session.start().then(() => session);
    this.sessions.set(key, started);
    started.catch(() => this.sessions.delete(key));
    return started;
  }
}
