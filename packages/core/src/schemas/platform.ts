import Type from "typebox";
import { IsoTime } from "./common";

/** The image new instances run on, for a platform that ships as one (BrokerAdapter.image). */
export const PlatformImage = Type.Object({
  image: Type.String(),
  repository: Type.String(),
  /** Stable versions of the repository, newest first; empty before the first check or with UPDATE_CHECK=off. */
  versions: Type.Array(Type.String()),
  /** The newest stable version, when newer than the one in use. */
  latest: Type.Optional(Type.String()),
  checkedAt: Type.Optional(IsoTime),
  /** The runtime is fetching the image (`running`), or could not (`failed`); missing once it has it. */
  download: Type.Optional(Type.Union([Type.Literal("running"), Type.Literal("failed")])),
});
export type PlatformImage = Type.Static<typeof PlatformImage>;

export const PlatformInfo = Type.Object({
  /** Missing for a platform that does not ship as an image (e.g. the demo with a local CLI). */
  platform: Type.Optional(PlatformImage),
  /** wickwatch's own version; `checkedAt` once the registry answered, `latest` when a newer stable one is there. */
  wickwatch: Type.Object({
    current: Type.String(),
    latest: Type.Optional(Type.String()),
    checkedAt: Type.Optional(IsoTime),
  }),
  /** Whether the server asks the registries for new versions (UPDATE_CHECK). */
  updateCheck: Type.Boolean(),
});
export type PlatformInfo = Type.Static<typeof PlatformInfo>;

/** An update of all instances to the platform image ("update all"), running in the background or done. */
export const ImageRollout = Type.Object({
  image: Type.String(),
  running: Type.Boolean(),
  startedAt: IsoTime,
  finishedAt: Type.Optional(IsoTime),
  /** The instance being updated now. */
  current: Type.Optional(Type.String()),
  /** Still to do, in order. */
  pending: Type.Array(Type.String()),
  updated: Type.Array(Type.String()),
  skipped: Type.Array(
    Type.Object({
      name: Type.String(),
      reason: Type.Union([Type.Literal("open_position"), Type.Literal("positions_unknown"), Type.Literal("failed")]),
      error: Type.Optional(Type.String()),
    }),
  ),
});
export type ImageRollout = Type.Static<typeof ImageRollout>;
