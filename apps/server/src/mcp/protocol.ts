import { AdapterError } from "@wickwatch/core";
import type { FastifyBaseLogger } from "fastify";
import type { Static, TSchema } from "typebox";
import Value from "typebox/value";
import type { SessionUser } from "../auth/sessions";

// A small Model Context Protocol server: JSON-RPC 2.0 over Streamable HTTP, stateless, tools only. Enough for MCP
// clients to list and call read-only tools; no sessions, no server-sent requests, no resources or prompts.

/** Newest first; a client asking for another version gets the newest and decides whether it can use it. */
export const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"] as const;

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;

export interface ToolContext {
  user: SessionUser;
  log: FastifyBaseLogger;
}

export interface McpTool<S extends TSchema = TSchema> {
  name: string;
  title: string;
  description: string;
  input: S;
  /** Listed and callable for admins only. */
  adminOnly?: boolean;
  run(args: Static<S>, context: ToolContext): Promise<unknown>;
}

/** Keeps the argument type of each tool when they are put into one list. */
export const defineTool = <S extends TSchema>(tool: McpTool<S>): McpTool => tool;

export interface ServerInfo {
  name: string;
  version: string;
  /** Shown to the model by most clients: what the server is for and how to treat its data. */
  instructions: string;
}

type Id = string | number | null;

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: Id;
  result?: unknown;
  error?: { code: number; message: string };
}

const fail = (id: Id, code: number, message: string): JsonRpcResponse => ({
  jsonrpc: "2.0",
  id,
  error: { code, message },
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function negotiateVersion(requested: unknown): string {
  return PROTOCOL_VERSIONS.find((v) => v === requested) ?? PROTOCOL_VERSIONS[0];
}

/** An error answer for a body that is no JSON-RPC message at all (e.g. invalid JSON). */
export const parseError = (): JsonRpcResponse => fail(null, PARSE_ERROR, "Parse error");
export const invalidRequest = (message: string): JsonRpcResponse => fail(null, INVALID_REQUEST, message);

export class McpServer {
  constructor(
    private readonly info: ServerInfo,
    private readonly tools: McpTool[],
  ) {}

  private visibleTools(user: SessionUser) {
    return this.tools.filter((t) => !t.adminOnly || user.role === "admin");
  }

  /**
   * Handles one message or a batch. Returns undefined when nothing needs an answer (only notifications or responses),
   * which the transport turns into 202 Accepted.
   */
  async handle(body: unknown, context: ToolContext): Promise<JsonRpcResponse | JsonRpcResponse[] | undefined> {
    if (Array.isArray(body)) {
      if (body.length === 0) return fail(null, INVALID_REQUEST, "Empty batch");
      const answers = (await Promise.all(body.map((m) => this.handleOne(m, context)))).filter((a) => a !== undefined);
      return answers.length ? answers : undefined;
    }
    return this.handleOne(body, context);
  }

  private async handleOne(message: unknown, context: ToolContext): Promise<JsonRpcResponse | undefined> {
    if (!isRecord(message) || message["jsonrpc"] !== "2.0") return fail(null, INVALID_REQUEST, "Invalid request");
    const { id, method, params } = message;
    // A response from the client (to a request this server never sends): nothing to do.
    if (method === undefined && ("result" in message || "error" in message)) return undefined;
    if (typeof method !== "string") return fail(null, INVALID_REQUEST, "Invalid request");
    // Notifications (no id) get no answer, e.g. notifications/initialized and notifications/cancelled.
    if (id === undefined) return undefined;
    if (typeof id !== "string" && typeof id !== "number") return fail(null, INVALID_REQUEST, "Invalid id");
    if (params !== undefined && !isRecord(params)) return fail(id, INVALID_PARAMS, "params must be an object");

    switch (method) {
      case "initialize":
        return {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: negotiateVersion(params?.["protocolVersion"]),
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: this.info.name, version: this.info.version },
            instructions: this.info.instructions,
          },
        };
      case "ping":
        return { jsonrpc: "2.0", id, result: {} };
      case "tools/list":
        return {
          jsonrpc: "2.0",
          id,
          result: {
            tools: this.visibleTools(context.user).map((t) => ({
              name: t.name,
              title: t.title,
              description: t.description,
              inputSchema: t.input,
              annotations: { title: t.title, readOnlyHint: true, openWorldHint: false },
            })),
          },
        };
      case "tools/call":
        return this.call(id, params ?? {}, context);
      default:
        return fail(id, METHOD_NOT_FOUND, `Method not found: ${method}`);
    }
  }

  private async call(id: string | number, params: Record<string, unknown>, context: ToolContext) {
    const tool = this.visibleTools(context.user).find((t) => t.name === params["name"]);
    if (!tool) return fail(id, INVALID_PARAMS, `Unknown tool: ${String(params["name"])}`);
    const args = params["arguments"] ?? {};
    if (!Value.Check(tool.input, args)) {
      const errors = Value.Errors(tool.input, args).map((e) => `${e.instancePath || "/"} ${e.message}`);
      return toolError(id, `Invalid arguments: ${errors.join("; ")}`);
    }
    try {
      const result = await tool.run(args, context);
      return { jsonrpc: "2.0" as const, id, result: { content: [{ type: "text", text: JSON.stringify(result) }] } };
    } catch (error) {
      // Tool errors go to the model as a result, so it can react (e.g. a mistyped instance name).
      if (error instanceof AdapterError) return toolError(id, `Error: ${error.code}`);
      context.log.error({ err: error, tool: tool.name }, "MCP tool failed");
      return toolError(id, "Error: internal");
    }
  }
}

const toolError = (id: string | number, text: string): JsonRpcResponse => ({
  jsonrpc: "2.0",
  id,
  result: { content: [{ type: "text", text }], isError: true },
});
