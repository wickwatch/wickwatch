import Docker from "dockerode";

// The small part of the Docker API the adapter uses. Keeps the adapter testable without a daemon.

export interface ContainerSummary {
  Id: string;
}

export interface ContainerDetails {
  Name: string;
  RestartCount: number;
  Config: { Image: string; Tty: boolean; Labels: Record<string, string> | null };
  State: {
    Status: string;
    ExitCode: number;
    StartedAt: string;
    Restarting: boolean;
    Health?: { Status: string };
  };
}

export interface LogRequest {
  tail: number;
  since?: number;
  follow: boolean;
}

export interface ContainerHandle {
  inspect(): Promise<ContainerDetails>;
  start(): Promise<unknown>;
  stop(): Promise<unknown>;
  restart(): Promise<unknown>;
  /** Raw log bytes (multiplexed unless the container has a TTY), with Docker timestamps. */
  logs(request: LogRequest): Promise<NodeJS.ReadableStream | Buffer>;
}

export interface DockerClient {
  listByLabel(label: string): Promise<ContainerSummary[]>;
  container(idOrName: string): ContainerHandle;
}

/** Connects to DOCKER_HOST (tcp://, http(s)://, unix://) or the default socket. */
export function createDockerClient(dockerHost?: string): DockerClient {
  return wrap(new Docker(connectionOptions(dockerHost)));
}

export function connectionOptions(dockerHost?: string): Docker.DockerOptions {
  if (!dockerHost) return {};
  const url = new URL(dockerHost);
  if (url.protocol === "unix:") return { socketPath: url.pathname };
  const protocol = url.protocol === "https:" ? "https" : "http";
  return { protocol, host: url.hostname, port: Number(url.port || (protocol === "https" ? 443 : 2375)) };
}

function wrap(docker: Docker): DockerClient {
  return {
    listByLabel: (label) => docker.listContainers({ all: true, filters: JSON.stringify({ label: [label] }) }),
    container(idOrName) {
      const c = docker.getContainer(idOrName);
      return {
        inspect: () => c.inspect() as Promise<ContainerDetails>,
        start: () => c.start(),
        stop: () => c.stop(),
        restart: () => c.restart(),
        logs: ({ tail, since, follow }) => {
          const base = {
            stdout: true,
            stderr: true,
            timestamps: true,
            tail,
            ...(since === undefined ? {} : { since }),
          };
          return follow ? c.logs({ ...base, follow: true }) : c.logs({ ...base, follow: false });
        },
      };
    },
  };
}
