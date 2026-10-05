import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CreatedApiToken } from "@wickwatch/core";
import { afterEach, describe, expect, it } from "vitest";
import { loginAs, PASSWORD, startApp, type TestApp } from "./helpers";

let t: TestApp;
afterEach(async () => {
  await t.app.close();
});

interface ToolResult {
  content: { type: string; text: string }[];
  isError?: boolean;
}

async function setup(role: "admin" | "viewer" = "viewer", env: Record<string, string> = {}) {
  t = await startApp(env);
  const cookie = await loginAs(t, "admin", env["BASE_PATH"] ?? "", { totp: false });
  const res = await t.app.inject({
    method: "POST",
    url: `${env["BASE_PATH"] ?? ""}/api/v1/api-tokens`,
    headers: { cookie },
    payload: { name: "mcp", role, password: PASSWORD },
  });
  return { cookie, token: res.json<CreatedApiToken>().token };
}

const rpc = (token: string, body: unknown, headers: Record<string, string> = {}, url = "/mcp") =>
  t.app.inject({
    method: "POST",
    url,
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      ...headers,
    },
    payload: JSON.stringify(body),
  });

async function callTool(token: string, name: string, args: object = {}) {
  const res = await rpc(token, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
  expect(res.statusCode).toBe(200);
  return res.json<{ result: ToolResult }>().result;
}
const parsed = (result: ToolResult): unknown => JSON.parse(result.content[0]?.text ?? "null");

/** Needs ALGOS_DIR. */
const uploadAlgo = (cookie: string) =>
  t.app.inject({
    method: "POST",
    url: "/api/v1/algos?fileName=alpha.algo",
    headers: { cookie, "content-type": "application/octet-stream" },
    payload: Buffer.from("alpha-v1"),
  });

describe("MCP endpoint", () => {
  it("initializes, negotiates the protocol version and answers notifications with 202", async () => {
    const { token } = await setup();
    const init = await rpc(token, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } },
    });
    expect(init.statusCode).toBe(200);
    expect(init.headers["content-type"]).toMatch(/^application\/json/);
    expect(init.headers["mcp-session-id"]).toBeUndefined();
    expect(init.json()).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: {
        protocolVersion: "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "wickwatch", version: "1.2.3" },
      },
    });

    const future = await rpc(token, {
      jsonrpc: "2.0",
      id: 2,
      method: "initialize",
      params: { protocolVersion: "2099-01-01" },
    });
    expect(future.json<{ result: { protocolVersion: string } }>().result.protocolVersion).toBe("2025-11-25");

    const note = await rpc(token, { jsonrpc: "2.0", method: "notifications/initialized" });
    expect(note.statusCode).toBe(202);
    expect(note.body).toBe("");

    const ping = await rpc(
      token,
      { jsonrpc: "2.0", id: "p", method: "ping" },
      { "mcp-protocol-version": "2025-06-18" },
    );
    expect(ping.json()).toEqual({ jsonrpc: "2.0", id: "p", result: {} });
  });

  it("lists read-only tools; the audit log only for admin tokens", async () => {
    const { token } = await setup("viewer");
    const res = await rpc(token, { jsonrpc: "2.0", id: 1, method: "tools/list" });
    const tools = res.json<{
      result: { tools: { name: string; inputSchema: { type: string }; annotations: object }[] };
    }>().result.tools;
    expect(tools.map((x) => x.name)).toEqual([
      "get_overview",
      "get_alerts",
      "get_account",
      "get_instance",
      "get_instance_logs",
      "list_parameter_templates",
      "get_host_status",
    ]);
    for (const tool of tools) {
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.annotations).toMatchObject({ readOnlyHint: true });
    }
    // A viewer token cannot call it by name either.
    const audit = await rpc(token, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "get_audit_log" } });
    expect(audit.json()).toMatchObject({ error: { code: -32602 } });
  });

  // Regression: parameter values may hold licence keys, so they go to admin tokens only and never with such a key.
  it("returns an instance's parameter values to admin tokens only, without secrets, and audits the call", async () => {
    const { token, cookie } = await setup("admin", { ALGOS_DIR: mkdtempSync(join(tmpdir(), "ww-algos-")) });
    const algo = await uploadAlgo(cookie);
    const account = await t.db
      .selectFrom("accounts")
      .select("id")
      .where("number", "=", "1111111")
      .executeTakeFirstOrThrow();
    const created = await t.app.inject({
      method: "POST",
      url: "/api/v1/managed-instances",
      headers: { cookie },
      payload: {
        name: "x1",
        accountId: account.id,
        config: {
          algoId: algo.json<{ id: number }>().id,
          symbol: "GER40",
          period: "m5",
          parameters: { RiskPercent: 0.5, EntryMode: "Pullback" },
          attribution: { mode: "auto" },
        },
      },
    });
    expect(created.statusCode).toBe(201);

    const config = parsed(await callTool(token, "get_instance_parameters", { ref: "x1" })) as {
      parameters: Record<string, unknown>;
    };
    expect(config).toMatchObject({ name: "x1", version: 1, symbol: "GER40", period: "M5", hidden: [] });
    expect(config.parameters).toMatchObject({ RiskPercent: 0.5, EntryMode: "Pullback" });
    expect(config).not.toHaveProperty("deployedVersion");

    // A version as earlier releases stored it (plain JSON), with a text value that looks like a secret.
    await t.db
      .updateTable("instance_configs")
      .set({ parameters: JSON.stringify({ RiskPercent: 0.5, KeyLevel: 3, LicenceKey: "placeholder-key" }) })
      .execute();
    const secret = await callTool(token, "get_instance_parameters", { ref: "x1", version: 1 });
    expect(secret.content[0]?.text).not.toContain("placeholder-key");
    expect(parsed(secret)).toMatchObject({ parameters: { RiskPercent: 0.5, KeyLevel: 3 }, hidden: ["LicenceKey"] });

    expect((await callTool(token, "get_instance_parameters", { ref: "x1", version: 2 })).isError).toBe(true);
    expect(await callTool(token, "get_instance_parameters", { ref: "nope" })).toMatchObject({
      content: [{ text: "Error: not_found" }],
      isError: true,
    });

    const log = await t.db
      .selectFrom("audit_log")
      .select(["target", "details", "user_id", "api_token"])
      .where("action", "=", "instance.parameters_read")
      .execute();
    expect(log).toEqual([
      { target: "x1", details: '{"version":1}', user_id: expect.any(Number) as number, api_token: "mcp" },
      { target: "x1", details: '{"version":1}', user_id: expect.any(Number) as number, api_token: "mcp" },
    ]);

    // A viewer token of the same user neither sees the tool nor can call it by name.
    const viewer = await t.app.inject({
      method: "POST",
      url: "/api/v1/api-tokens",
      headers: { cookie },
      payload: { name: "viewer", role: "viewer", password: PASSWORD },
    });
    const denied = await rpc(viewer.json<CreatedApiToken>().token, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "get_instance_parameters", arguments: { ref: "x1" } },
    });
    expect(denied.json()).toMatchObject({ error: { code: -32602 } });
    expect(denied.body).not.toContain("RiskPercent");
  });

  it("returns the overview, an account, an instance, its log and the host status", async () => {
    const { token } = await setup();
    const overview = parsed(await callTool(token, "get_overview")) as { accounts: { number: string }[] };
    expect(overview.accounts.map((a) => a.number)).toEqual(["1111111", "2222222", "3333333"]);

    const alerts = parsed(await callTool(token, "get_alerts")) as { code: string; subject: string }[];
    expect(alerts).toContainEqual(expect.objectContaining({ code: "instance_error", subject: "beta-us500-own" }));

    const account = parsed(await callTool(token, "get_account", { number: "1111111" })) as {
      positions: { instance?: string }[];
    };
    expect(account.positions.map((p) => p.instance)).toEqual(["alpha-ger40-a"]);
    // The same account with the number sent as a JSON number, as clients do with all-digit numbers.
    const byNumber = parsed(await callTool(token, "get_account", { number: 1111111 })) as typeof account;
    expect(byNumber.positions).toEqual(account.positions);

    const instance = parsed(await callTool(token, "get_instance", { ref: "alpha-ger40-a", days: 7 })) as {
      instance: { name: string };
    };
    expect(instance.instance.name).toBe("alpha-ger40-a");

    const logs = parsed(await callTool(token, "get_instance_logs", { ref: "alpha-ger40-a", lines: 3 })) as {
      time: string;
      text: string;
    }[];
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.length).toBeLessThanOrEqual(3);

    const host = parsed(await callTool(token, "get_host_status")) as { cpu?: unknown };
    expect(host).toBeTypeOf("object");
  });

  it("lists parameter templates with their parameter names, never their values, also for admins", async () => {
    const { token, cookie } = await setup("admin", { ALGOS_DIR: mkdtempSync(join(tmpdir(), "ww-algos-")) });
    await uploadAlgo(cookie);
    await t.app.inject({
      method: "POST",
      url: "/api/v1/parameter-templates",
      headers: { cookie },
      payload: { algoName: "alpha", name: "News day", parameters: { RiskPercent: 0.3, LicenceKey: "placeholder-key" } },
    });
    const result = await callTool(token, "list_parameter_templates", { algo: "alpha" });
    expect(result.content[0]?.text).not.toContain("placeholder-key");
    expect(parsed(result)).toEqual([
      expect.objectContaining({
        algoName: "alpha",
        name: "News day",
        count: 2,
        parameterNames: ["LicenceKey", "RiskPercent"],
      }),
    ]);
    expect((parsed(result) as object[]).every((template) => !("parameters" in template))).toBe(true);
    expect(parsed(await callTool(token, "list_parameter_templates", { algo: "beta" }))).toEqual([]);
  });

  it("reports unknown subjects and invalid arguments as tool errors", async () => {
    const { token } = await setup();
    expect(await callTool(token, "get_account", { number: "999" })).toEqual({
      content: [{ type: "text", text: "Error: not_found" }],
      isError: true,
    });
    expect((await callTool(token, "get_instance_logs", { ref: "nope" })).isError).toBe(true);
    const invalid = await callTool(token, "get_instance_logs", { ref: "../etc", lines: 5000 });
    expect(invalid.isError).toBe(true);
    expect(invalid.content[0]?.text).toMatch(/^Invalid arguments/);
  });

  it("reads the audit log with an admin token", async () => {
    const { token } = await setup("admin");
    const page = parsed(await callTool(token, "get_audit_log", { action: "api_token.", limit: 5 })) as {
      entries: { action: string; target: string; user: string }[];
    };
    expect(page.entries).toEqual([
      expect.objectContaining({ action: "api_token.create", target: "mcp", user: "admin-user" }),
    ]);
  });

  it("answers JSON-RPC errors for bad messages, methods and versions", async () => {
    const { token } = await setup();
    expect((await rpc(token, { jsonrpc: "2.0", id: 1, method: "resources/list" })).json()).toMatchObject({
      id: 1,
      error: { code: -32601 },
    });
    expect((await rpc(token, { id: 1, method: "ping" })).json()).toMatchObject({ error: { code: -32600 } });
    const bad = await t.app.inject({
      method: "POST",
      url: "/mcp",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: "{not json",
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({ jsonrpc: "2.0", id: null, error: { code: -32700 } });
    const version = await rpc(
      token,
      { jsonrpc: "2.0", id: 1, method: "ping" },
      { "mcp-protocol-version": "1999-01-01" },
    );
    expect(version.statusCode).toBe(400);

    const batch = await rpc(token, [
      { jsonrpc: "2.0", id: 1, method: "ping" },
      { jsonrpc: "2.0", method: "notifications/initialized" },
    ]);
    expect(batch.json()).toEqual([{ jsonrpc: "2.0", id: 1, result: {} }]);

    const get = await t.app.inject({ url: "/mcp", headers: { authorization: `Bearer ${token}` } });
    expect(get.statusCode).toBe(405);
    expect(get.headers["allow"]).toBe("POST");
  });

  // Regression: the endpoint takes API tokens only, never the session cookie, and no request from another site.
  it("needs an API token and rejects other origins", async () => {
    const { cookie, token } = await setup();
    const ping = { jsonrpc: "2.0", id: 1, method: "ping" };
    const anonymous = await t.app.inject({ method: "POST", url: "/mcp", payload: ping });
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.headers["www-authenticate"]).toBe('Bearer realm="wickwatch"');
    const withCookie = await t.app.inject({ method: "POST", url: "/mcp", headers: { cookie }, payload: ping });
    expect(withCookie.statusCode).toBe(401);
    expect((await rpc("ww_wrong", ping)).statusCode).toBe(401);
    const foreign = await rpc(token, ping, { origin: "https://evil.example" });
    expect(foreign.statusCode).toBe(403);
    expect((await rpc(token, ping, { origin: "http://localhost:80" })).statusCode).toBe(200);
  });

  it("is switched off with MCP=off: 404 with or without a token, while tokens still work for the API", async () => {
    const { token } = await setup("viewer", { MCP: "off" });
    const ping = { jsonrpc: "2.0", id: 1, method: "ping" };
    expect((await rpc(token, ping)).statusCode).toBe(404);
    expect((await t.app.inject({ method: "POST", url: "/mcp", payload: ping })).statusCode).toBe(404);
    const overview = await t.app.inject({ url: "/api/v1/overview", headers: { authorization: `Bearer ${token}` } });
    expect(overview.statusCode).toBe(200);
    const system = await t.app.inject({ url: "/api/v1/system", headers: { authorization: `Bearer ${token}` } });
    expect(system.json()).toMatchObject({ mcp: false });
  });

  it("lives under the base path", async () => {
    const { token } = await setup("viewer", { BASE_PATH: "/ww" });
    expect((await rpc(token, { jsonrpc: "2.0", id: 1, method: "ping" }, {}, "/ww/mcp")).statusCode).toBe(200);
    expect((await rpc(token, { jsonrpc: "2.0", id: 1, method: "ping" }, {}, "/mcp")).statusCode).not.toBe(200);
  });
});
