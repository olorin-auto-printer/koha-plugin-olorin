/* olorin-koha.js — Koha slip-page controller for koha-plugin-olorin.
 *
 * Injected (with olorin.js) on every staff page via the plugin's
 * intranet_head hook. Reads the JSON config stanza, decides whether the
 * current page is a managed slip page, suppresses Koha's native print
 * flow, and dispatches the print through the Olorin client library.
 *
 * Coexistence guards (always on): the controller does nothing when the
 * page already carries legacy Olorin markup (#webPrint / .olorinPlugin
 * from hand-edited notices) or when an IntranetSlipPrinterJS deployment
 * owns the page (slip-print.inc sets `let autoprint = false` then).
 */
(function () {
  "use strict";

  function readConfig(doc) {
    var stanza = doc.getElementById("olorin-config");
    if (!stanza) {
      return null;
    }
    try {
      return JSON.parse(stanza.textContent);
    } catch (error) {
      return null;
    }
  }

  function resolveSlipType(location, config) {
    var search = new URLSearchParams(location.search);
    var types = (config && config.types) || [];
    for (var i = 0; i < types.length; i++) {
      var type = types[i];
      if (!location.pathname.endsWith(type.path)) {
        continue;
      }
      var params = type.params || {};
      var matched = true;
      for (var name in params) {
        if (!Object.prototype.hasOwnProperty.call(params, name)) {
          continue;
        }
        var wanted = params[name];
        var actual = search.get(name);
        if (wanted === "*") {
          if (actual === null) {
            matched = false;
          }
        } else if (actual !== wanted) {
          matched = false;
        }
      }
      if (matched) {
        return type;
      }
    }
    return null;
  }

  function findContainer(doc, type) {
    var candidates = [type.container, "#receipt", "#slip", "#main"];
    for (var i = 0; i < candidates.length; i++) {
      if (!candidates[i]) {
        continue;
      }
      var node = doc.querySelector(candidates[i]);
      if (node) {
        return { node: node, selector: candidates[i] };
      }
    }
    return null;
  }

  function pageIsForeign(doc) {
    return !!doc.querySelector("#webPrint, .olorinPlugin");
  }

  function nativeAutoprintDisabled() {
    // slip-print.inc declares `let autoprint` — a global LEXICAL binding
    // (not window.autoprint). false means an IntranetSlipPrinterJS
    // deployment owns this page.
    try {
      // eslint-disable-next-line no-undef
      return typeof autoprint !== "undefined" && autoprint === false;
    } catch (error) {
      return false;
    }
  }

  function suppressNativePrintFlow(win) {
    // The native slip flow calls window.print() at window load and arms
    // setTimeout('window.close()', 1000) — both must be neutralized before
    // the load event. This script runs deferred (pre-load), so it is in
    // time. The originals are kept for selective use later.
    var native = {
      print: win.print.bind(win),
      close: win.close.bind(win),
    };
    win.print = function () {};
    win.close = function () {};
    return native;
  }

  function injectPrintStyles(container) {
    // Travels inside the container's innerHTML to the companion renderer,
    // so multi-slip pages page-break correctly and <pre> slips stay
    // monospaced.
    var style = container.ownerDocument.createElement("style");
    style.setAttribute("data-olorin-style", "");
    style.textContent =
      ".pagebreak{page-break-after:always}" + "pre{font-family:monospace;white-space:pre-wrap}";
    container.insertBefore(style, container.firstChild);
  }

  function makeBar(doc) {
    var bar = doc.createElement("div");
    bar.id = "olorin-bar";
    bar.className = "noprint";
    bar.style.cssText =
      "font-family:sans-serif;font-size:14px;padding:10px 14px;margin:0 0 10px;" +
      "border:1px solid #ccc;border-left:6px solid #337ab7;background:#f5f8fa;color:#333";
    doc.body.insertBefore(bar, doc.body.firstChild);
    return bar;
  }

  function makeButton(doc, label, onClick) {
    var button = doc.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.style.cssText =
      "margin-right:8px;padding:6px 14px;border:1px solid #2e6da4;border-radius:3px;" +
      "background:#337ab7;color:#fff;cursor:pointer;font-size:13px";
    button.addEventListener("click", onClick);
    return button;
  }

  function makeLinkButton(doc, label, onClick) {
    var button = makeButton(doc, label, onClick);
    button.style.background = "#fff";
    button.style.color = "#333";
    button.style.borderColor = "#ccc";
    return button;
  }

  function controller(win, doc) {
    var config = readConfig(doc);
    if (!config) {
      return;
    }

    var type = resolveSlipType(win.location, config);
    if (!type || type.mode === "off") {
      return;
    }

    if (pageIsForeign(doc)) {
      return;
    }
    if (nativeAutoprintDisabled()) {
      return;
    }

    var native = suppressNativePrintFlow(win);
    var state = { type: type, native: native, config: config };

    onReady(doc, function () {
      var container = findContainer(doc, type);
      if (!container) {
        showFailure(win, doc, state, {
          message: "Olorin could not find the slip content on this page.",
        });
        return;
      }
      state.container = container;
      injectPrintStyles(container.node);

      if (type.mode === "auto") {
        doPrint(win, doc, state);
      } else {
        renderManualBar(win, doc, state);
      }

      (type.manual_triggers || []).forEach(function (selector) {
        // e.g. the spine-label page's own Print button, whose handler
        // calls the now-neutralized window.print — take the click over
        doc.addEventListener(
          "click",
          function (event) {
            var trigger = event.target instanceof Element ? event.target.closest(selector) : null;
            if (!trigger) {
              return;
            }
            event.preventDefault();
            event.stopImmediatePropagation();
            doPrint(win, doc, state);
          },
          true,
        );
      });
    });
  }

  function doPrint(win, doc, state) {
    clearBar(doc);
    var type = state.type;

    window.Olorin.print({ printer: type.printer, selector: state.container.selector })
      .then(function () {
        if (type.kick_drawer) {
          // POS: pop the till after a successful receipt; a drawer failure
          // must not un-succeed the print
          return window.Olorin.kickDrawer({ printer: type.printer }).catch(function () {});
        }
        return null;
      })
      .then(function () {
        if (type.auto_close) {
          win.setTimeout(state.native.close, state.config.close_delay_ms || 350);
        } else {
          showSuccessNote(doc);
        }
      })
      .catch(function (error) {
        showFailure(win, doc, state, error);
      });
  }

  function renderManualBar(win, doc, state) {
    var bar = makeBar(doc);
    bar.appendChild(
      makeButton(doc, "Print via Olorin", function () {
        doPrint(win, doc, state);
      }),
    );
    bar.appendChild(
      makeLinkButton(doc, "Print with browser dialog", function () {
        state.native.print();
      }),
    );
  }

  function showSuccessNote(doc) {
    var bar = doc.getElementById("olorin-bar") || makeBar(doc);
    bar.textContent = "Printed via Olorin.";
    bar.style.borderLeftColor = "#2e7d32";
  }

  function showFailure(win, doc, state, error) {
    // Give the window its close button back so staff can dismiss the popup
    win.close = state.native.close;

    var bar = doc.getElementById("olorin-bar") || makeBar(doc);
    bar.textContent = "";
    bar.style.borderLeftColor = "#b71c1c";

    var text = doc.createElement("div");
    text.style.marginBottom = "8px";
    text.textContent = "Olorin could not print: " + (error.message || "unknown error");
    bar.appendChild(text);

    if (error.code === "unreachable" && /Chrome/.test(win.navigator.userAgent)) {
      var hint = doc.createElement("div");
      hint.style.cssText = "font-size:12px;color:#666;margin-bottom:8px";
      hint.textContent =
        "If the Companion App is running, Chrome may need one-time permission " +
        "to reach it — use the plugin's configuration page (Check companion) to grant it.";
      bar.appendChild(hint);
    }

    bar.appendChild(
      makeButton(doc, "Retry", function () {
        doPrint(win, doc, state);
      }),
    );
    bar.appendChild(
      makeLinkButton(doc, "Print with browser dialog", function () {
        state.native.print();
      }),
    );
  }

  function clearBar(doc) {
    var bar = doc.getElementById("olorin-bar");
    if (bar && bar.parentNode) {
      bar.parentNode.removeChild(bar);
    }
  }

  function onReady(doc, callback) {
    if (doc.readyState === "loading") {
      doc.addEventListener("DOMContentLoaded", callback);
    } else {
      callback();
    }
  }

  window.OlorinKoha = {
    readConfig: readConfig,
    resolveSlipType: resolveSlipType,
    findContainer: findContainer,
    pageIsForeign: pageIsForeign,
    suppressNativePrintFlow: suppressNativePrintFlow,
    injectPrintStyles: injectPrintStyles,
    controller: controller,
  };

  if (!window.__OLORIN_TEST__) {
    controller(window, document);
  }
})();
