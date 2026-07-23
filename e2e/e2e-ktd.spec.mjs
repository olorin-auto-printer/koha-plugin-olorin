// End-to-end test against a running Koha Testing Docker instance with this
// plugin installed, enabled, and checkinslip configured to auto-print.
//
// Prerequisites (see README's development section):
//   - KTD up with the plugin in /var/lib/koha/kohadev/plugins + restart_all
//   - checkinslip mode=auto, printer=receipt_printer in the plugin config
//   - port 9696 free (stop any running companion app)
//
// The test exercises the PRIMARY transport: direct page WebSocket, with NO
// browser extension involved. Chromium's Local Network Access checks are
// disabled to stand in for the one-time permission grant.
import { test, expect } from "@playwright/test";
import { WebSocketServer } from "ws";

const STAFF = process.env.KOHA_STAFF_URL || "http://kohadev-intra.localhost";
const USER = process.env.KOHA_USER || "koha";
const PASS = process.env.KOHA_PASS || "koha";

let wss;
let received;

test.beforeAll(() => {
  received = [];
  wss = new WebSocketServer({ host: "127.0.0.1", port: 9696 });
  wss.on("connection", (socket) => {
    socket.on("message", (raw) => {
      const message = JSON.parse(raw.toString());
      received.push(message);
      if (message.text === "hello") {
        socket.send(JSON.stringify({ id: "hello", version: "2.1.0", protocol: 2 }));
      } else if (message.text === "printer-command") {
        socket.send(JSON.stringify({ id: "print", success: true, printer: "Stub Printer" }));
      } else if (message.text === "kick-drawer") {
        socket.send(JSON.stringify({ id: "kick", success: true, printer: "Stub Printer" }));
      } else if (message.text === "list-printer") {
        socket.send(JSON.stringify({ id: "printerList", printer: [{ name: "Stub Printer" }] }));
      } else {
        socket.send(JSON.stringify({ success: true }));
      }
    });
  });
});

test.afterAll(async () => {
  await new Promise((resolve) => wss.close(resolve));
});

test.use({
  launchOptions: {
    args: ["--disable-features=LocalNetworkAccessChecks"],
  },
});

test("a configured slip page prints through the direct WebSocket transport", async ({ page }) => {
  // Log into the staff client
  await page.goto(`${STAFF}/cgi-bin/koha/mainpage.pl`, { waitUntil: "networkidle" });
  if (await page.$("#userid")) {
    await page.fill("#userid", USER);
    await page.fill("#password", PASS);
    await Promise.all([
      page.waitForLoadState("domcontentloaded"),
      page.press("#password", "Enter"),
    ]);
    await page.waitForLoadState("networkidle");
  }
  expect(await page.$("#userid")).toBeNull();

  // Open a checkin slip — configured mode=auto → the plugin controller
  // should suppress the native dialog and print via ws://localhost:9696
  await page.goto(`${STAFF}/cgi-bin/koha/members/printslip.pl?borrowernumber=2&print=checkinslip`, {
    waitUntil: "domcontentloaded",
  });

  // The plugin scripts are injected via intranet_head
  const stanza = await page.$("#olorin-config");
  expect(stanza).not.toBeNull();

  // Wait for the stub companion to receive the print job
  await expect
    .poll(() => received.filter((m) => m.text === "printer-command").length, {
      timeout: 20000,
    })
    .toBeGreaterThan(0);

  const job = received.find((m) => m.text === "printer-command");
  expect(job.printer).toBe("receipt_printer");
  expect(job.content).toContain("data-olorin-style");
  expect(job.id).toBeTruthy();

  // No failure banner on the page
  const bar = await page.$("#olorin-bar");
  if (bar) {
    const text = await bar.textContent();
    expect(text).not.toContain("could not print");
  }
});
