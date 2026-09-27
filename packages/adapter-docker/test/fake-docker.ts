import { PassThrough } from "node:stream";
import type { ContainerDetails, ContainerHandle, DockerClient, LogRequest } from "../src/client";

export interface FakeContainer {
  details: ContainerDetails;
  lines: string[];
  logRequests: LogRequest[];
  streams: PassThrough[];
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
  } satisfies FakeContainer;
}

const httpError = (statusCode: number) => Object.assign(new Error(`HTTP ${statusCode}`), { statusCode });

export class FakeDocker implements DockerClient {
  readonly containers = new Map<string, FakeContainer>();

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
