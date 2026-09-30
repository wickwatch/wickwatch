import Type from "typebox";

/** What a broker adapter supports. The UI hides features that are not supported. */
export const Capabilities = Type.Object({
  backtest: Type.Boolean(),
  optimize: Type.Boolean(),
  partialClose: Type.Boolean(),
  pendingOrders: Type.Boolean(),
  emergencyStop: Type.Boolean(),
  /**
   * The runtime refuses to start a bot while a text parameter is empty or missing (it has no "empty" value). The
   * forms and the server then treat such a parameter as required.
   */
  requiresTextValues: Type.Optional(Type.Boolean()),
  /** Parameter file format ids the adapter can export; defined by the adapter. */
  parameterExport: Type.Array(Type.String()),
});
export type Capabilities = Type.Static<typeof Capabilities>;
