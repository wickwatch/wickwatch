// Docker runtime adapter: finds bot instances by container label and starts, stops and follows them.
export { DockerRuntimeAdapter, mapError, toStatus, type DockerRuntimeOptions } from "./runtime";
export { connectionOptions, createDockerClient, type DockerClient } from "./client";
