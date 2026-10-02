import { describe, expect, it, vi } from "vitest";
import { postJson, telegramHtml } from "../src/services/webhook";

const log = { warn: vi.fn() } as never;

describe("telegramHtml", () => {
  it("escapes the text, so a bot's log line or a name cannot break the message", () => {
    expect(telegramHtml("Error: <b>x</b> & more")).toBe("Error: &lt;b&gt;x&lt;/b&gt; &amp; more");
  });

  it("marks long numbers as code, not amounts, times or dates", () => {
    expect(telegramHtml("Account 2006531 lost 1,201.83 USD at 21:30 on 2026-10-02, position 13143267")).toBe(
      "Account <code>2006531</code> lost 1,201.83 USD at 21:30 on 2026-10-02, position <code>13143267</code>",
    );
  });

  it("puts the first line of each paragraph in bold, but leaves a one-line alert as it is", () => {
    expect(telegramHtml("Title\n\nName\nline")).toBe("<b>Title</b>\n\n<b>Name</b>\nline");
    expect(telegramHtml("Warning: instance x stopped")).toBe("Warning: instance x stopped");
  });
});

describe("postJson", () => {
  const sent = async (url: string) => {
    const fetch = vi.fn(async (_url: URL, _init: RequestInit) => new Response(null, { status: 200 }));
    await postJson({
      fetch: fetch as unknown as typeof globalThis.fetch,
      url: new URL(url),
      body: { event: "alert_raised", text: "Account 2006531 <down>", content: "Account 2006531 <down>" },
      log,
      refused: "refused",
      unreachable: "unreachable",
    });
    return JSON.parse(fetch.mock.calls[0]?.[1].body as string) as Record<string, unknown>;
  };

  it("sends Telegram the text as HTML", async () => {
    expect(await sent("https://api.telegram.org/botPLACEHOLDER/sendMessage?chat_id=1")).toMatchObject({
      text: "Account <code>2006531</code> &lt;down&gt;",
      parse_mode: "HTML",
      event: "alert_raised",
    });
  });

  it("sends every other receiver the plain text", async () => {
    const body = await sent("https://hooks.example/alerts");
    expect(body["text"]).toBe("Account 2006531 <down>");
    expect(body["parse_mode"]).toBeUndefined();
  });
});
