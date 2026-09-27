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
  /** Extracts a tar archive into the container's file system at `path`. */
  putArchive(tar: Buffer, path: string): Promise<unknown>;
  rename(name: string): Promise<unknown>;
  remove(): Promise<unknown>;
}

export interface CreateRequest {
  name: string;
  image: string;
  command: string[];
  labels: Record<string, string>;
  restartPolicy: "on-failure" | "unless-stopped" | "no";
  /** Seconds `docker stop` waits for a clean exit before killing. */
  stopTimeout: number;
}

export interface DockerClient {
  listByLabel(label: string): Promise<ContainerSummary[]>;
  container(idOrName: string): ContainerHandle;
  hasImage(ref: string): Promise<boolean>;
  pull(ref: string): Promise<void>;
  /** Creates a stopped container; returns its id. */
  create(request: CreateRequest): Promise<string>;
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
    async hasImage(ref) {
      try {
        await docker.getImage(ref).inspect();
        return true;
      } catch (error) {
        if (typeof error === "object" && error !== null && "statusCode" in error && error.statusCode === 404) {
          return false;
        }
        throw error;
      }
    },
    async pull(ref) {
      const stream = await docker.pull(ref);
      await new Promise((resolve, reject) => {
        docker.modem.followProgress(stream, (error) => {
          if (error) reject(error);
          else resolve(undefined);
        });
      });
    },
    async create({ name, image, command, labels, restartPolicy, stopTimeout }) {
      const container = await docker.createContainer({
        name,
        Image: image,
        Cmd: command,
        Labels: labels,
        StopTimeout: stopTimeout,
        HostConfig: {
          RestartPolicy: { Name: restartPolicy },
          LogConfig: { Type: "json-file", Config: { "max-size": "10m", "max-file": "5" } },
          // Bots get no extra kernel capabilities; Linux has no algo sandbox of its own.
          CapDrop: ["ALL"],
          SecurityOpt: ["no-new-privileges:true"],
        },
      });
      return container.id;
    },
    listByLabel: (label) => docker.listContainers({ all: true, filters: JSON.stringify({ label: [label] }) }),
    container(idOrName) {
      const c = docker.getContainer(idOrName);
      return {
        inspect: () => c.inspect() as Promise<ContainerDetails>,
        start: () => c.start(),
        stop: () => c.stop(),
        restart: () => c.restart(),
        putArchive: (tar, path) => c.putArchive(tar, { path }),
        rename: (name) => c.rename({ name }),
        remove: () => c.remove(),
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
