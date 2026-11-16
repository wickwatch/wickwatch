import type { BrokerAdapter, PlatformImage, RuntimeAdapter, Updates } from "@wickwatch/core";
import { newerVersion, splitImage, stableVersions } from "@wickwatch/core/rules";
import type { FastifyBaseLogger } from "fastify";
import type { Db } from "../db";
import { listTags } from "./registry";

const DAY_MS = 24 * 60 * 60 * 1000;
/** The first check waits a little, so the start of the server is not held up by a registry. */
const FIRST_CHECK_MS = 60_000;
/** After a failed check, the next one comes sooner than a day. */
const RETRY_MS = 60 * 60 * 1000;
/** Versions offered to choose from, newest first. */
const MAX_VERSIONS = 20;
export const PLATFORM_IMAGE_KEY = "platform_image";
export const WICKWATCH_REPOSITORY = "ghcr.io/wickwatch/wickwatch";

/** A pinned tag of the platform's own repository: what the setting may name. */
export function isAllowedImage(image: string, repository: string): boolean {
  const { repository: own, tag } = splitImage(image);
  return own === repository && tag !== undefined && tag !== "" && tag !== "latest";
}

interface Checked {
  tags: string[];
  at: string;
}

/** A download of an image by the runtime: running, or failed (a done one is forgotten). */
interface Download {
  state: "running" | "failed";
  done: Promise<void>;
}

/**
 * The platform image new instances and the broker's tools run on: the one from the adapter's settings, or the version
 * an admin chose (stored as `platform_image`). With `check`, asks the registries once a day for newer stable versions
 * of it and of wickwatch, for the info alerts and the choice in the dashboard.
 */
export class Images {
  /** The repository of the adapter's own image; the setting can only pick another version of it. */
  private readonly repository: string | undefined;
  private readonly checked = new Map<string, Checked>();
  private readonly downloads = new Map<string, Download>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly fetch: typeof fetch;
  private readonly now: () => Date;

  constructor(
    private readonly options: {
      db: Db;
      broker: BrokerAdapter;
      /** Fetches a chosen image ahead, so updating an instance to it does not wait for the download. */
      runtime?: RuntimeAdapter;
      log: FastifyBaseLogger;
      /** wickwatch's own version, e.g. `0.8.7`. */
      version: string;
      /** Whether start() asks the registries (UPDATE_CHECK, not with the demo runtime). */
      check: boolean;
      fetch?: typeof fetch;
      now?: () => Date;
    },
  ) {
    const image = options.broker.image?.();
    this.repository = image === undefined ? undefined : splitImage(image).repository;
    this.fetch = options.fetch ?? fetch;
    this.now = options.now ?? (() => new Date());
  }

  /** Applies the stored choice; one for another repository (e.g. the adapter's setting changed) is ignored. */
  async load(): Promise<void> {
    const { db, broker, log } = this.options;
    if (!this.repository || !broker.useImage) return;
    const row = await db
      .selectFrom("settings")
      .select("value")
      .where("key", "=", PLATFORM_IMAGE_KEY)
      .executeTakeFirst();
    if (!row) return;
    if (isAllowedImage(row.value, this.repository)) broker.useImage(row.value);
    else log.warn({ image: row.value, repository: this.repository }, "Stored platform image ignored: other repository");
  }

  /** Stores and uses `image`; false when it is no pinned tag of the platform's repository. */
  async setImage(image: string): Promise<boolean> {
    const { db, broker } = this.options;
    if (!this.repository || !broker.useImage || !isAllowedImage(image, this.repository)) return false;
    const updated_at = this.now().toISOString();
    await db
      .insertInto("settings")
      .values({ key: PLATFORM_IMAGE_KEY, value: image, updated_at })
      .onConflict((oc) => oc.column("key").doUpdateSet({ value: image, updated_at }))
      .execute();
    broker.useImage(image);
    void this.prepare(image).catch(() => undefined);
    return true;
  }

  /**
   * Has the runtime fetch `image` if it lacks it; callers at the same time share one download. Fails like the runtime
   * (logged); a later call tries again.
   */
  prepare(image: string): Promise<void> {
    const prepareImage = this.options.runtime?.prepareImage?.bind(this.options.runtime);
    if (!prepareImage) return Promise.resolve();
    const running = this.downloads.get(image);
    if (running?.state === "running") return running.done;
    const download: Download = {
      state: "running",
      done: prepareImage(image).then(
        () => {
          if (this.downloads.get(image) === download) this.downloads.delete(image);
        },
        (error: unknown) => {
          download.state = "failed";
          this.options.log.warn({ err: error, image }, "Platform image could not be fetched");
          throw error;
        },
      ),
    };
    this.downloads.set(image, download);
    return download.done;
  }

  get version(): string {
    return this.options.version;
  }

  /** When the registry last told wickwatch's own versions. */
  get wickwatchCheckedAt(): string | undefined {
    return this.checked.get(WICKWATCH_REPOSITORY)?.at;
  }

  isAllowed(image: string): boolean {
    return this.repository !== undefined && isAllowedImage(image, this.repository);
  }

  platform(): PlatformImage | undefined {
    const image = this.options.broker.image?.();
    if (!image || !this.repository) return undefined;
    const checked = this.checked.get(this.repository);
    const versions = stableVersions(checked?.tags ?? []).slice(0, MAX_VERSIONS);
    const latest = this.latest(image, this.repository);
    const download = this.downloads.get(image);
    return {
      image,
      repository: this.repository,
      versions,
      ...(latest ? { latest } : {}),
      ...(checked ? { checkedAt: checked.at } : {}),
      ...(download ? { download: download.state } : {}),
    };
  }

  /** Newer stable versions than those in use, for the alerts. */
  updates(): Updates {
    const image = this.options.broker.image?.();
    const platformTag = image === undefined ? undefined : splitImage(image).tag;
    const platform = image && this.repository && platformTag ? this.latest(image, this.repository) : undefined;
    const wickwatch = this.latest(`${WICKWATCH_REPOSITORY}:${this.options.version}`, WICKWATCH_REPOSITORY);
    return {
      ...(platform && platformTag ? { platform: { current: platformTag, latest: platform } } : {}),
      ...(wickwatch ? { wickwatch: { current: this.options.version, latest: wickwatch } } : {}),
    };
  }

  /** Whether the registries are asked at all. */
  get checking(): boolean {
    return this.options.check;
  }

  start(): void {
    if (this.options.check) this.schedule(FIRST_CHECK_MS);
  }

  stop(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  /** Asks the registries once; a failure keeps the last answer and is logged. True when all answered. */
  async check(): Promise<boolean> {
    const repositories = [...new Set([this.repository, WICKWATCH_REPOSITORY].filter((r) => r !== undefined))];
    const results = await Promise.all(
      repositories.map(async (repository) => {
        try {
          const tags = await listTags(repository, this.fetch);
          this.checked.set(repository, { tags, at: this.now().toISOString() });
          return true;
        } catch (error) {
          this.options.log.warn({ err: error, repository }, "Update check failed");
          return false;
        }
      }),
    );
    return results.every(Boolean);
  }

  private latest(image: string, repository: string): string | undefined {
    const tag = splitImage(image).tag;
    const tags = this.checked.get(repository)?.tags;
    return tag && tags ? newerVersion(tag, tags) : undefined;
  }

  private schedule(ms: number): void {
    this.timer = setTimeout(() => {
      void this.check().then((ok) => {
        if (this.timer) this.schedule(ok ? DAY_MS : RETRY_MS);
      });
    }, ms);
    this.timer.unref();
  }
}
