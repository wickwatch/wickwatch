const REQUEST_TIMEOUT_MS = 10_000;
/** A registry that pages its tag list this often is not followed further. */
const MAX_PAGES = 20;
const DOCKER_HUB = "registry-1.docker.io";

/**
 * Where an image repository lives: `ghcr.io/org/app` → host `ghcr.io`, name `org/app`. A first part without a dot or
 * port (and not `localhost`) is a Docker Hub name, single names there are under `library/`.
 */
export function registryOf(repository: string): { host: string; name: string } {
  const [first = "", ...rest] = repository.split("/");
  if (rest.length && (first.includes(".") || first.includes(":") || first === "localhost")) {
    return { host: first, name: rest.join("/") };
  }
  return { host: DOCKER_HUB, name: rest.length ? repository : `library/${repository}` };
}

/** The parameters of a `WWW-Authenticate: Bearer realm="…",service="…",scope="…"` challenge. */
function bearerChallenge(header: string | null): Record<string, string> | undefined {
  if (!header || !/^bearer\s/i.test(header)) return undefined;
  const params: Record<string, string> = {};
  for (const [, key, value] of header.matchAll(/(\w+)="([^"]*)"/g)) {
    if (key && value !== undefined) params[key.toLowerCase()] = value;
  }
  return params;
}

/** The next page of a `Link: </v2/…/tags/list?last=…>; rel="next"` header, resolved against `base`. */
function nextPage(header: string | null, base: URL): URL | undefined {
  const match = header && /<([^>]+)>\s*;\s*rel="?next"?/i.exec(header);
  return match?.[1] ? new URL(match[1], base) : undefined;
}

/**
 * The tags of a public image repository, by the OCI distribution API (`/v2/<name>/tags/list`), with the anonymous
 * token the registry hands out on its 401 challenge (ghcr.io, Docker Hub). No credentials are sent; private
 * repositories answer with an error.
 */
export async function listTags(repository: string, fetchFn: typeof fetch = fetch): Promise<string[]> {
  const { host, name } = registryOf(repository);
  let url: URL | undefined = new URL(`https://${host}/v2/${name}/tags/list?n=1000`);
  let token: string | undefined;
  const tags: string[] = [];
  for (let page = 0; url && page < MAX_PAGES; page++) {
    const at: URL = url;
    const ask = (bearer?: string) =>
      fetchFn(at, {
        headers: { accept: "application/json", ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    let response = await ask(token);
    if (response.status === 401 && !token) {
      token = await anonymousToken(response.headers.get("www-authenticate"), fetchFn);
      response = await ask(token);
    }
    if (!response.ok) throw new Error(`Registry ${host} answered ${String(response.status)} for ${name}`);
    const body = (await response.json()) as { tags?: unknown };
    if (Array.isArray(body.tags)) tags.push(...body.tags.filter((t): t is string => typeof t === "string"));
    url = nextPage(response.headers.get("link"), at);
  }
  return tags;
}

async function anonymousToken(challenge: string | null, fetchFn: typeof fetch): Promise<string> {
  const params = bearerChallenge(challenge);
  if (!params?.["realm"]) throw new Error("Registry asked for authentication without a token service");
  const url = new URL(params["realm"]);
  for (const key of ["service", "scope"]) {
    const value = params[key];
    if (value) url.searchParams.set(key, value);
  }
  const response = await fetchFn(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`Registry token service answered ${String(response.status)}`);
  const body = (await response.json()) as { token?: unknown; access_token?: unknown };
  const token = typeof body.token === "string" ? body.token : body.access_token;
  if (typeof token !== "string") throw new Error("Registry token service sent no token");
  return token;
}
