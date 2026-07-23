import { describe, it, expect, beforeEach, vi } from "vitest";

window.__OLORIN_TEST__ = true;

async function loadController() {
  delete window.OlorinKoha;
  vi.resetModules();
  await import("../Koha/Plugin/Com/OlorinAutoPrinter/Olorin/js/olorin-koha.js");
  return window.OlorinKoha;
}

function makeConfig(overrides = {}) {
  return {
    version: "1.0.0",
    close_delay_ms: 50,
    types: [
      {
        key: "issueqslip",
        path: "/members/printslip.pl",
        params: { print: "issueqslip" },
        container: "#receipt",
        mode: "auto",
        printer: "receipt_printer",
        auto_close: true,
      },
      {
        key: "checkinslip",
        path: "/members/printslip.pl",
        params: { print: "checkinslip" },
        container: "#receipt",
        mode: "off",
        printer: "receipt_printer",
        auto_close: true,
      },
      {
        key: "patron_custom",
        path: "/members/printslip.pl",
        params: { print: "*" },
        container: "#receipt",
        mode: "manual",
        printer: "paper_printer",
        auto_close: false,
      },
      {
        key: "spinelabel",
        path: "/labels/spinelabel-print.pl",
        params: {},
        container: "#spinelabel",
        mode: "auto",
        printer: "label_printer",
        auto_close: false,
        manual_triggers: [".print-label"],
      },
      {
        key: "pos_receipt",
        path: "/pos/printreceipt.pl",
        params: {},
        container: "#receipt",
        mode: "auto",
        printer: "receipt_printer",
        auto_close: true,
        kick_drawer: true,
      },
    ],
    ...overrides,
  };
}

function fakeLocation(pathname, search = "") {
  return { pathname, search };
}

beforeEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  window.Olorin = {
    print: vi.fn().mockResolvedValue({ success: true }),
    kickDrawer: vi.fn().mockResolvedValue({ success: true }),
  };
});

describe("resolveSlipType", () => {
  it("matches specific print= entries before the catch-all", async () => {
    const controller = await loadController();
    const config = makeConfig();

    expect(
      controller.resolveSlipType(
        fakeLocation("/cgi-bin/koha/members/printslip.pl", "?print=issueqslip&borrowernumber=2"),
        config,
      ).key,
    ).toBe("issueqslip");

    expect(
      controller.resolveSlipType(
        fakeLocation("/cgi-bin/koha/members/printslip.pl", "?print=somethingelse"),
        config,
      ).key,
    ).toBe("patron_custom");
  });

  it("matches parameterless pages by path and returns null off slip pages", async () => {
    const controller = await loadController();
    const config = makeConfig();

    expect(
      controller.resolveSlipType(fakeLocation("/cgi-bin/koha/labels/spinelabel-print.pl"), config)
        .key,
    ).toBe("spinelabel");

    expect(
      controller.resolveSlipType(fakeLocation("/cgi-bin/koha/circ/circulation.pl"), config),
    ).toBeNull();
  });
});

describe("guards", () => {
  it("detects foreign legacy markup", async () => {
    const controller = await loadController();
    document.body.innerHTML = '<button id="webPrint"></button>';
    expect(controller.pageIsForeign(document)).toBe(true);
    document.body.innerHTML = '<button class="olorinPlugin"></button>';
    expect(controller.pageIsForeign(document)).toBe(true);
    document.body.innerHTML = "<div></div>";
    expect(controller.pageIsForeign(document)).toBe(false);
  });
});

describe("suppressNativePrintFlow", () => {
  it("no-ops print and close but keeps the originals callable", async () => {
    const controller = await loadController();
    const printSpy = vi.fn();
    const closeSpy = vi.fn();
    const win = { print: printSpy, close: closeSpy };

    const native = controller.suppressNativePrintFlow(win);
    win.print();
    win.close();
    expect(printSpy).not.toHaveBeenCalled();
    expect(closeSpy).not.toHaveBeenCalled();

    native.print();
    native.close();
    expect(printSpy).toHaveBeenCalledOnce();
    expect(closeSpy).toHaveBeenCalledOnce();
  });
});

describe("injectPrintStyles", () => {
  it("prepends a style tag that travels with innerHTML", async () => {
    const controller = await loadController();
    document.body.innerHTML = '<div id="receipt"><p>x</p></div>';
    const container = document.getElementById("receipt");

    controller.injectPrintStyles(container);

    expect(container.innerHTML).toMatch(/^<style data-olorin-style/);
    expect(container.innerHTML).toContain("page-break-after:always");
  });
});

describe("findContainer", () => {
  it("uses the configured container with sensible fallbacks", async () => {
    const controller = await loadController();
    document.body.innerHTML = '<div id="slip">x</div>';
    const found = controller.findContainer(document, { container: "#receipt" });
    expect(found.selector).toBe("#slip");

    document.body.innerHTML = "<div>nothing</div>";
    expect(controller.findContainer(document, { container: "#receipt" })).toBeNull();
  });
});
