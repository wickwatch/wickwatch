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
});
export type PlatformImage = Type.Static<typeof PlatformImage>;

export const PlatformInfo = Type.Object({
  /** Missing for a platform that does not ship as an image (e.g. the demo with a local CLI). */
  platform: Type.Optional(PlatformImage),
  wickwatch: Type.Object({ current: Type.String(), latest: Type.Optional(Type.String()) }),
  /** Whether the server asks the registries for new versions (UPDATE_CHECK). */
  updateCheck: Type.Boolean(),
});
export type PlatformInfo = Type.Static<typeof PlatformInfo>;
