import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { audit } from "../src/services/audit";
import { loginAs, startApp, type TestApp } from "./helpers";

let t: TestApp;
let admin: string;

beforeEach(async () => {
  t = await startApp();
  admin = await loginAs(t, "admin");
});
afterEach(async () => {
  await t.app.close();
});

const get = (query = "", cookie = admin) =>
  t.app.inject({ method: "GET", url: `/api/v1/audit${query}`, headers: { cookie } });

describe("audit log API", () => {
  it("lists entries newest first with the user, and what Wickwatch did by itself", async () => {
    await audit(t.db, { action: "instance.autostart", target: "bot-a", details: { ok: true } });
    const res = await get();
    expect(res.statusCode).toBe(200);
    const body = res.json<{ entries: { action: string; user?: string; details?: unknown }[]; actions: string[] }>();
    expect(body.entries[0]).toMatchObject({ action: "instance.autostart", target: "bot-a", details: { ok: true } });
    expect(body.entries[0]?.user).toBeUndefined();
    // The admin's own login is in the log too.
    expect(body.entries.find((e) => e.action === "auth.login")).toMatchObject({ user: "admin-user" });
    expect(body.actions).toEqual(expect.arrayContaining(["auth.login", "instance.autostart"]));
  });

  it("filters by action, action prefix and target, and pages back", async () => {
    for (const target of ["bot-a", "bot-b", "bot-c"]) await audit(t.db, { action: "instance.stop", target });
    await audit(t.db, { action: "instance.start", target: "bot-a" });
    const actions = async (query: string) =>
      (await get(query)).json<{ entries: { action: string; target?: string }[] }>().entries.map((e) => e.target);
    expect(await actions("?action=instance.stop")).toEqual(["bot-c", "bot-b", "bot-a"]);
    expect(await actions("?action=instance.&target=bot-a")).toEqual(["bot-a", "bot-a"]);

    const first = (await get("?action=instance.stop&limit=2")).json<{ entries: { id: number }[]; more: boolean }>();
    expect(first.more).toBe(true);
    const last = first.entries.at(-1)?.id ?? 0;
    const next = (await get(`?action=instance.stop&limit=2&before=${String(last)}`)).json<{
      entries: { target: string }[];
      more: boolean;
    }>();
    expect(next).toMatchObject({ entries: [{ target: "bot-a" }], more: false });
  });

  it("is for admins only", async () => {
    const viewer = await loginAs(t, "viewer");
    expect((await get("", viewer)).statusCode).toBe(403);
  });
});
