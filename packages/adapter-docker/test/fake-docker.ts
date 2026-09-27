import { PassThrough } from "node:stream";
import type { ContainerDetails, ContainerHandle, CreateRequest, DockerClient, LogRequest } from "../src/client";

export interface FakeContainer {
  details: ContainerDetails;
  lines: string[];
  logRequests: LogRequest[];
  streams: PassThrough[];
  created?: CreateRequest;
  archives: { tar: Buffer; path: string }[];
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
      logs: (request) =>
        Promise.resolve().then(() => {
          const c = get();
          c.logRequests.push(request);
          const data = Buffer.concat(c.lines.slice(-request.tail).map((l) => frame(`${l}\n`)));
          if (!request.follow) return data;
          const stream = new PassThrough();
          stream.write(data);
          c.streams.push(stream);
          return stream;
        }),
    };
  }
}
