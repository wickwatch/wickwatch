import Type from "typebox";

/** What a broker adapter supports. The UI hides features that are not supported. */
export const Capabilities = Type.Object({
  backtest: Type.Boolean(),
  optimize: Type.Boolean(),
  partialClose: Type.Boolean(),
  pendingOrders: Type.Boolean(),
  emergencyStop: Type.Boolean(),
  /** Parameter file format ids the adapter can export; defined by the adapter. */
  parameterExport: Type.Array(Type.String()),
});
export type Capabilities = Type.Static<typeof Capabilities>;
