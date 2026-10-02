import { Duplex, PassThrough } from "node:stream";
import type {
  ContainerDetails,
  ContainerHandle,
  CreateRequest,
  DockerClient,
  LogRequest,
  ToolRequest,
} from "../src/client";

export interface FakeContainer {
  details: ContainerDetails;
  lines: string[];
  logRequests: LogRequest[];
  streams: PassThrough[];
  created?: CreateRequest;
  archives: { tar: Buffer; path: string }[];
  /** Tool containers: what was written to stdin, and how to end them. */
  tool?: FakeTool;
}

export interface FakeTool {
  request: ToolRequest;
  stdin: string[];
  /** Multiplexed output the tool sends. */
  output: PassThrough;
  /** Ends the tool with this exit code; it removes itself like with AutoRemove. */
  exit(code: number): void;
  /** Answers each stdin write; default: none. */
  reply?: (text: string) => string | undefined;
}

/** One multiplexed Docker log frame (stream 1 = stdout). */
export const frame = (text: string) => {
  const payload = Buffer.from(text);
  const header = Buffer.alloc(8);
  header.writeUInt8(1, 0);
  header.writeUInt32BE(payload.length, 4);
  return Buffer.concat([header, payload]);
};

export function fakeContainer(
  name: string,
  labels: Record<string, string>,
  state: Partial<ContainerDetails["State"]> = {},
) {
  return {
    details: {
      Name: `/${name}`,
      RestartCount: 0,
      Config: { Image: "example/bot:1.0", Tty: false, Labels: labels },
      State: {
        Status: "running",
        ExitCode: 0,
        StartedAt: "2026-09-25T08:00:00.123456789Z",
        Restarting: false,
        ...state,
      },
    },
    lines: ["2026-09-25T11:59:00.000000001Z Started", "2026-09-25T11:59:30.000000001Z Login failed: bad password"],
    logRequests: [],
    streams: [],
    archives: [],
  } satisfies FakeContainer;
}

const httpError = (statusCode: number) => Object.assign(new Error(`HTTP ${statusCode}`), { statusCode });

export class FakeDocker implements DockerClient {
  readonly containers = new Map<string, FakeContainer>();
  readonly images = new Set<string>();
  readonly pulls: string[] = [];
  /** Makes the next putArchive fail, e.g. to test the clean-up. */
  failArchive = false;

  hasImage(ref: string) {
    return Promise.resolve(this.images.has(ref));
  }

  pull(ref: string) {
    this.pulls.push(ref);
    this.images.add(ref);
    return Promise.resolve();
  }

  create(request: CreateRequest) {
    return Promise.resolve().then(() => {
      if (this.containers.has(request.name)) throw httpError(409);
      if (!this.images.has(request.image)) throw httpError(404);
      const c: FakeContainer = {
        ...fakeContainer(request.name, request.labels, { Status: "created", StartedAt: "0001-01-01T00:00:00Z" }),
        created: request,
        lines: [],
      };
      c.details.Config.Image = request.image;
      this.containers.set(request.name, c);
      return `id-${request.name}`;
    });
  }

  private tools = 0;

  createTool(request: ToolRequest) {
    return Promise.resolve().then(() => {
      if (!this.images.has(request.image)) throw httpError(404);
      const id = `tool-${String(++this.tools)}`;
      const c: FakeContainer = {
        ...fakeContainer(id, request.labels, { Status: "created", StartedAt: "0001-01-01T00:00:00Z" }),
        lines: [],
      };
      let finish: (code: number) => void = () => undefined;
      const ended = new Promise<number>((resolve) => (finish = resolve));
      const output = new PassThrough();
      c.tool = {
        request,
        stdin: [],
        output,
        exit: (code) => {
          c.details.State = { ...c.details.State, Status: "exited", ExitCode: code };
          output.end();
          this.containers.delete(id);
          finish(code);
        },
      };
      this.toolEnds.set(id, ended);
      this.containers.set(id, c);
      return id;
    });
  }

  private readonly toolEnds = new Map<string, Promise<number>>();
  /** Waits for a tool's exit never answer, as when a proxy dropped the idle connection. */
  lostWaits = false;

  add(container: FakeContainer): this {
    this.containers.set(container.details.Name.slice(1), container);
    return this;
  }

  listByLabel(label: string) {
    return Promise.resolve(
      [...this.containers.entries()]
        .filter(([, c]) => c.details.Config.Labels?.[label] !== undefined)
        .map(([Id]) => ({ Id })),
    );
  }

  container(name: string): ContainerHandle {
    const get = () => {
      const c = this.containers.get(name);
      if (!c) throw httpError(404);
      return c;
    };
    const setState = (status: string, exitCode = 0) => {
      const c = get();
      if (c.details.State.Status === status) throw httpError(304);
      c.details.State = { ...c.details.State, Status: status, ExitCode: exitCode, StartedAt: new Date().toISOString() };
    };
    return {
      inspect: () => Promise.resolve().then(() => structuredClone(get().details)),
      start: () =>
        Promise.resolve().then(() => {
          setState("running");
        }),
      stop: () =>
        Promise.resolve().then(() => {
          setState("exited", 143);
        }),
      restart: () =>
        Promise.resolve().then(() => {
          const c = get();
          c.details.RestartCount += 1;
          c.details.State = { ...c.details.State, Status: "running" };
        }),
      putArchive: (tar, path) =>
        Promise.resolve().then(() => {
          if (this.failArchive) throw httpError(500);
          get().archives.push({ tar, path });
        }),
      rename: (newName) =>
        Promise.resolve().then(() => {
          const c = get();
          if (this.containers.has(newName)) throw httpError(409);
          this.containers.delete(name);
          c.details.Name = `/${newName}`;
          this.containers.set(newName, c);
        }),
      remove: () =>
        Promise.resolve().then(() => {
          const c = get();
          if (c.details.State.Status === "running") throw httpError(409);
          this.containers.delete(name);
        }),
      attach: () =>
        Promise.resolve().then(() => {
          const tool = get().tool;
          if (!tool) throw httpError(409);
          const duplex = new Duplex({
            read() {},
            write(chunk: Buffer, _encoding, done) {
              const text = chunk.toString();
              tool.stdin.push(text);
              const answer = tool.reply?.(text);
              if (answer !== undefined) tool.output.write(frame(answer));
              done();
            },
          });
          tool.output.on("data", (d: Buffer) => duplex.push(d));
          tool.output.on("end", () => duplex.push(null));
          return duplex;
        }),
      wait: () => {
        if (this.lostWaits) return new Promise<number>(() => undefined);
        const ended = this.toolEnds.get(name);
        return ended ?? Promise.reject(httpError(404));
      },
      kill: () =>
        Promise.resolve().then(() => {
          const c = get();
          if (c.tool) c.tool.exit(137);
          else setState("exited", 137);
        }),
      logs: (request) =>
        Promise.resolve().then(() => {
          const c = get();
          c.logRequests.push(request);
          const data = Buffer.concat(
            (request.tail === undefined ? c.lines : c.lines.slice(-request.tail)).map((l) => frame(`${l}\n`)),
          );
          if (!request.follow) return data;
          const stream = new PassThrough();
          stream.write(data);
          c.streams.push(stream);
          return stream;
        }),
    };
  }
}
