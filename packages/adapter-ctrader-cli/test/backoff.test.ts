import { AdapterError } from "@wickwatch/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LoginBackoff } from "../src/backoff";

const c = { login: "user@example.com", secret: "placeholder" };
const down = () => Promise.reject(new AdapterError("unavailable", "down"));
const rejected = () => Promise.reject(new AdapterError("auth_failed", "cTrader ID login failed"));

describe("LoginBackoff", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("waits after a failure, doubling up to the maximum, and starts over after a success", async () => {
    const backoff = new LoginBackoff(1000, 3000);
    const failing = vi.fn(down);
    const attempt = () => backoff.login(c, ["session", "1"], failing);

    await expect(attempt()).rejects.toThrow("down");
    await expect(attempt()).rejects.toThrow("down");
    expect(failing).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    await expect(attempt()).rejects.toThrow("down");
    expect(failing).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1999);
    await expect(attempt()).rejects.toThrow("down");
    expect(failing).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1);
    await expect(attempt()).rejects.toThrow("down");
    expect(failing).toHaveBeenCalledTimes(3);
    // 4 s would be next; the maximum is 3 s.
    vi.advanceTimersByTime(3000);
    await expect(attempt()).rejects.toThrow("down");
    expect(failing).toHaveBeenCalledTimes(4);

    vi.advanceTimersByTime(3000);
    expect(await backoff.login(c, ["session", "1"], () => Promise.resolve("ok"))).toBe("ok");
    await expect(attempt()).rejects.toThrow("down");
    await expect(attempt()).rejects.toThrow("down");
    expect(failing).toHaveBeenCalledTimes(5);
  });

  it("holds every login of a cTrader ID after a rejected password, other failures only the same login", async () => {
    const backoff = new LoginBackoff(1000, 3000);
    await expect(backoff.login(c, ["session", "1"], down)).rejects.toThrow();
    expect(await backoff.login(c, ["session", "2"], () => Promise.resolve(2))).toBe(2);

    await expect(backoff.login(c, ["session", "2"], rejected)).rejects.toMatchObject({ code: "auth_failed" });
    const other = vi.fn(() => Promise.resolve("listed"));
    await expect(backoff.login(c, ["batch", "accounts"], other)).rejects.toMatchObject({ code: "auth_failed" });
    expect(other).not.toHaveBeenCalled();
    // A changed password is a new login.
    expect(await backoff.login({ ...c, secret: "changed" }, ["session", "1"], () => Promise.resolve(3))).toBe(3);
  });

  it("lets urgent logins through", async () => {
    const backoff = new LoginBackoff(1000, 3000);
    await expect(backoff.login(c, ["session", "1"], rejected)).rejects.toThrow();
    expect(await backoff.login(c, ["session", "1"], () => Promise.resolve(4), true)).toBe(4);
  });
});
