import Type from "typebox";
import { ParameterSchema } from "./broker";

/** An uploaded algo version. */
export const Algo = Type.Object({
  id: Type.Integer(),
  name: Type.String(),
  version: Type.String(),
  sha256: Type.String(),
  size: Type.Integer(),
  buildTime: Type.Optional(Type.String()),
  fullAccess: Type.Boolean(),
  parameters: Type.Array(ParameterSchema),
  uploadedAt: Type.String(),
});
export type Algo = Type.Static<typeof Algo>;
