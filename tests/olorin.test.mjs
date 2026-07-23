import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { MockWebSocket } from "./helpers/mock-websocket.mjs";

// All test-installed document listeners are registered with this signal so
// they can't leak into the next test
let listeners;

// Loads the library fresh into the current jsdom document
async function loadLibrary() {
  delete window.Olorin;
  vi.resetModules();
  await import("../Koha/Plugin/Com/OlorinAutoPrinter/Olorin/js/olorin.js");
}

function on(eventName, handler) {
  document.addEventListener(eventName, handler, { signal: listeners.signal });
}

// Answer any 'olorin:ping' like extension 2.1 would
function installExtensionEventApi({ printResult = { success: true }, version = "2.1.0" } = {}) {
  on("olorin:ping", (event) => {
    document.dispatchEvent(
      new CustomEvent("olorin:pong", { detail: { id: event.detail.id, version } }),
    );
  });
  on("olorin:print", (event) => {
    document.dispatchEvent(
      new CustomEvent("olorin:print-result", {
        detail: { id: event.detail.id, ...printResult },
      }),
    );
  });
  on("olorin:status", (event) => {
    document.dispatchEvent(
      new CustomEvent("olorin:status-result", {
        detail: {
          id: event.detail.id,
          success: true,
          data: { version: "2.1.0", protocol: 2 },
        },
      }),
    );
  });
}

beforeEach(() => {
  listeners = new AbortController();
  MockWebSocket.reset();
  globalThis.WebSocket = MockWebSocket;
  document.body.innerHTML = "";
});

afterEach(() => {
  listeners.abort();
});

describe("Olorin.print over direct WebSocket", () => {
  it("sends a PROTOCOL.md-conformant printer-command and resolves", async () => {
    await loadLibrary();
    window.Olorin.configure({ probeTimeoutMs: 5 });

    document.body.innerHTML = '<div id="receipt"><p>Slip</p></div>';
    const promise = window.Olorin.print({
      printer: "receipt_printer",
      selector: "#receipt",
      copies: 2,
      duplex: "long",
    });

    await vi.waitFor(() => expect(MockWebSocket.instances.length).toBe(1));
    const ws = MockWebSocket.last;
    ws.serverOpen();

    const message = JSON.parse(ws.sent[0]);
    expect(message.text).toBe("printer-command");
    expect(message.id).toBeTruthy();
    expect(message.printer).toBe("receipt_printer");
    expect(message.content).toBe("<p>Slip</p>");
    expect(message.copies).toBe(2);
    expect(message.duplex).toBe("long");

    ws.serverReply({ id: "print", success: true, printer: "EPSON" });
    await expect(promise).resolves.toEqual({ success: true, printer: "EPSON" });
    expect(ws.closed).toBe(true);
    expect(window.Olorin.transport()).toBe("websocket");
  });

  it("accepts raw content instead of a selector", async () => {
    await loadLibrary();
    window.Olorin.configure({ probeTimeoutMs: 5 });

    const promise = window.Olorin.print({ printer: "receipt_printer", content: "<b>x</b>" });
    await vi.waitFor(() => expect(MockWebSocket.instances.length).toBe(1));
    MockWebSocket.last.serverOpen();
    expect(JSON.parse(MockWebSocket.last.sent[0]).content).toBe("<b>x</b>");
    MockWebSocket.last.serverReply({ id: "print", success: true });
    await promise;
  });

  it("rejects with print-failed when the companion reports an error", async () => {
    await loadLibrary();
    window.Olorin.configure({ probeTimeoutMs: 5 });

    const promise = window.Olorin.print({ printer: "receipt_printer", content: "x" });
    await vi.waitFor(() => expect(MockWebSocket.instances.length).toBe(1));
    MockWebSocket.last.serverOpen();
    MockWebSocket.last.serverReply({ id: "print", success: false, error: "Unknown printer 'x'" });

    await expect(promise).rejects.toMatchObject({
      code: "print-failed",
      message: "Unknown printer 'x'",
    });
  });

  it("rejects bad requests before any connection", async () => {
    await loadLibrary();
    window.Olorin.configure({ probeTimeoutMs: 5 });
    await expect(window.Olorin.print({})).rejects.toMatchObject({ code: "bad-request" });
    await expect(
      window.Olorin.print({ printer: "receipt_printer", selector: "#missing" }),
    ).rejects.toMatchObject({ code: "bad-request", message: /No element matches/ });
  });

  it("classifies a failed connection as unreachable with the three-cause message", async () => {
    await loadLibrary();
    window.Olorin.configure({ probeTimeoutMs: 5, shimTimeoutMs: 30 });

    const promise = window.Olorin.print({ printer: "receipt_printer", content: "x" });
    await vi.waitFor(() => expect(MockWebSocket.instances.length).toBe(1));
    MockWebSocket.last.serverError();

    // The unreachable WS triggers the shim fallback; with no extension the
    // shim watchdog then fails with unreachable
    await expect(promise).rejects.toMatchObject({
      code: "unreachable",
      message: /Companion App is not running|allowed_origins|local network/,
    });
  });
});

describe("Olorin transport negotiation", () => {
  it("prefers the extension event API when the ping is answered", async () => {
    installExtensionEventApi();
    await loadLibrary();
    window.Olorin.configure({ probeTimeoutMs: 100 });

    await expect(
      window.Olorin.print({ printer: "receipt_printer", content: "x" }),
    ).resolves.toEqual({ success: true });
    expect(window.Olorin.transport()).toBe("extension-event");
    expect(MockWebSocket.instances.length).toBe(0);
  });

  it("propagates extension-reported print failures", async () => {
    installExtensionEventApi({ printResult: { success: false, error: "nope" } });
    await loadLibrary();
    window.Olorin.configure({ probeTimeoutMs: 100 });

    await expect(
      window.Olorin.print({ printer: "receipt_printer", content: "x" }),
    ).rejects.toMatchObject({ code: "print-failed", message: "nope" });
  });

  it("falls back to the button shim when the socket is unreachable and ext 2.0.0 answers clicks", async () => {
    await loadLibrary();
    window.Olorin.configure({ probeTimeoutMs: 5, shimTimeoutMs: 500 });

    // Simulate extension 2.0.0: no event API, but delegated click handling
    on("click", (event) => {
      const button = event.target.closest?.(".olorinPlugin");
      if (!button) return;
      const target = document.querySelector(button.dataset.print);
      document.dispatchEvent(
        new CustomEvent("olorin:print-result", {
          detail: { success: !!target, printer: button.dataset.printer },
        }),
      );
    });

    const promise = window.Olorin.print({ printer: "receipt_printer", content: "<i>shim</i>" });
    await vi.waitFor(() => expect(MockWebSocket.instances.length).toBe(1));
    MockWebSocket.last.serverError();

    await expect(promise).resolves.toEqual({ success: true });
    expect(window.Olorin.transport()).toBe("extension-shim");
    // Shim artifacts are cleaned up
    expect(document.querySelector(".olorinPlugin")).toBeNull();
    expect(document.querySelector("[id^=olorin-shim-content]")).toBeNull();
  });
});

describe("Olorin.status and listPrinters", () => {
  it("reports companion version over WebSocket", async () => {
    await loadLibrary();
    window.Olorin.configure({ probeTimeoutMs: 5 });

    const promise = window.Olorin.status();
    await vi.waitFor(() => expect(MockWebSocket.instances.length).toBe(1));
    MockWebSocket.last.serverOpen();
    expect(JSON.parse(MockWebSocket.last.sent[0]).text).toBe("hello");
    MockWebSocket.last.serverReply({ id: "hello", version: "2.1.0", protocol: 2 });

    await expect(promise).resolves.toEqual({
      reachable: true,
      transport: "websocket",
      version: "2.1.0",
      protocol: 2,
    });
  });

  it("reports unreachable without throwing", async () => {
    await loadLibrary();
    window.Olorin.configure({ probeTimeoutMs: 5 });

    const promise = window.Olorin.status();
    await vi.waitFor(() => expect(MockWebSocket.instances.length).toBe(1));
    MockWebSocket.last.serverError();

    await expect(promise).resolves.toMatchObject({ reachable: false, transport: "websocket" });
  });

  it("routes status through the extension when present", async () => {
    installExtensionEventApi();
    await loadLibrary();
    window.Olorin.configure({ probeTimeoutMs: 100 });

    await expect(window.Olorin.status()).resolves.toMatchObject({
      reachable: true,
      transport: "extension-event",
      version: "2.1.0",
    });
  });

  it("lists printers over WebSocket", async () => {
    await loadLibrary();
    window.Olorin.configure({ probeTimeoutMs: 5 });

    const promise = window.Olorin.listPrinters();
    await vi.waitFor(() => expect(MockWebSocket.instances.length).toBe(1));
    MockWebSocket.last.serverOpen();
    MockWebSocket.last.serverReply({ id: "printerList", printer: [{ name: "P1" }] });

    await expect(promise).resolves.toEqual([{ name: "P1" }]);
  });
});

describe("Olorin.kickDrawer", () => {
  it("sends kick-drawer over WebSocket", async () => {
    await loadLibrary();
    window.Olorin.configure({ probeTimeoutMs: 5 });

    const promise = window.Olorin.kickDrawer({ printer: "receipt_printer" });
    await vi.waitFor(() => expect(MockWebSocket.instances.length).toBe(1));
    MockWebSocket.last.serverOpen();
    const message = JSON.parse(MockWebSocket.last.sent[0]);
    expect(message.text).toBe("kick-drawer");
    expect(message.printer).toBe("receipt_printer");
    MockWebSocket.last.serverReply({ id: "kick", success: true, printer: "EPSON" });

    await expect(promise).resolves.toEqual({ success: true, printer: "EPSON" });
  });
});
