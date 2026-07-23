/* olorin.js — client library for the Olorin silent-printing system.
 *
 * Koha-agnostic and standalone-usable: any web page can load this file and
 * call Olorin.print() / Olorin.kickDrawer() / Olorin.status(). Distributed
 * with koha-plugin-olorin (GPL-3) and attached to its releases for
 * standalone use.
 *
 * Transport negotiation, per page load:
 *   1. The Olorin browser extension's event API (extension >= 2.1), probed
 *      with an 'olorin:ping' CustomEvent — preferred because the extension's
 *      background proxy is exempt from Chrome's Local Network Access prompt.
 *   2. A direct WebSocket to the companion app (ws://localhost:9696) — no
 *      extension needed at all. Chrome 147+ may show a one-time per-origin
 *      local-network permission prompt (pre-grantable by enterprise policy).
 *   3. A hidden-button shim understood by extension 2.0.0, used only when
 *      the direct socket is unreachable (e.g. Chrome permission denied but
 *      the older extension is installed).
 */
(function () {
  "use strict";

  if (window.Olorin) {
    return;
  }

  var settings = {
    url: "ws://localhost:9696",
    timeoutMs: 10000,
    probeTimeoutMs: 250,
    shimTimeoutMs: 4000,
    preferExtension: true,
  };

  var UNREACHABLE_MESSAGE =
    "Could not reach the Olorin Companion App. Possible causes: " +
    "the Companion App is not running on this computer; " +
    "this site is not in the companion's allowed_origins list; " +
    "or the browser blocked local network access (Chrome asks for permission once per site).";

  function OlorinError(code, message) {
    var error = new Error(message);
    error.name = "OlorinError";
    error.code = code;
    return error;
  }

  var idCounter = 0;
  function makeId() {
    idCounter += 1;
    return "olorin-" + Date.now() + "-" + idCounter;
  }

  // ---------------------------------------------------------------- events
  // One request/response over the extension's CustomEvent API (ext >= 2.1)

  function eventRequest(requestEvent, resultEvent, detail, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var id = makeId();
      var timer = null;

      function onResult(event) {
        if (!event.detail || event.detail.id !== id) {
          return;
        }
        document.removeEventListener(resultEvent, onResult);
        clearTimeout(timer);
        resolve(event.detail);
      }

      timer = setTimeout(function () {
        document.removeEventListener(resultEvent, onResult);
        reject(OlorinError("timeout", "Timed out waiting for the Olorin extension"));
      }, timeoutMs);

      document.addEventListener(resultEvent, onResult);
      var payload = Object.assign({ id: id }, detail);
      document.dispatchEvent(new CustomEvent(requestEvent, { detail: payload }));
    });
  }

  function probeExtension() {
    return eventRequest("olorin:ping", "olorin:pong", {}, settings.probeTimeoutMs).then(
      function (pong) {
        return { available: true, version: pong.version };
      },
      function () {
        return { available: false };
      },
    );
  }

  // ------------------------------------------------------------- websocket
  // One socket per request, first message wins — mirrors the extension's
  // background proxy and the companion's one-response-per-request contract.

  function wsRequest(message, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var socket;
      var settled = false;

      function finish(fn, value) {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        try {
          socket.close();
        } catch (ignored) {
          // Already closed
        }
        fn(value);
      }

      var timer = setTimeout(function () {
        finish(reject, OlorinError("timeout", "Timed out waiting for the Olorin Companion App"));
      }, timeoutMs);

      try {
        socket = new WebSocket(settings.url);
      } catch (error) {
        clearTimeout(timer);
        reject(OlorinError("unreachable", UNREACHABLE_MESSAGE));
        return;
      }

      var opened = false;
      socket.onopen = function () {
        opened = true;
        socket.send(JSON.stringify(message));
      };
      socket.onmessage = function (event) {
        var data;
        try {
          data = JSON.parse(event.data);
        } catch (error) {
          finish(reject, OlorinError("print-failed", "Invalid response from the Companion App"));
          return;
        }
        finish(resolve, data);
      };
      socket.onerror = function () {
        finish(reject, OlorinError("unreachable", UNREACHABLE_MESSAGE));
      };
      socket.onclose = function () {
        if (!opened) {
          finish(reject, OlorinError("unreachable", UNREACHABLE_MESSAGE));
        } else {
          finish(
            reject,
            OlorinError("unreachable", "Connection to the Companion App closed unexpectedly"),
          );
        }
      };
    });
  }

  // ------------------------------------------------------------------ shim
  // Extension 2.0.0 compatibility: it only understands clicks on elements
  // with the .olorinPlugin contract, and its result events carry no
  // correlation id — so shim calls are serialized.

  var shimQueue = Promise.resolve();

  function shimDispatch(kind, options) {
    var run = function () {
      return new Promise(function (resolve, reject) {
        var cleanupNodes = [];
        var timer = null;
        var resultEvent = kind === "kick" ? "olorin:drawer-result" : "olorin:print-result";

        function cleanup() {
          clearTimeout(timer);
          document.removeEventListener(resultEvent, onResult);
          cleanupNodes.forEach(function (node) {
            if (node.parentNode) {
              node.parentNode.removeChild(node);
            }
          });
        }

        function onResult(event) {
          cleanup();
          var detail = event.detail || {};
          if (detail.success === false) {
            reject(OlorinError("print-failed", detail.error || "Print failed"));
          } else {
            resolve({ success: true });
          }
        }

        timer = setTimeout(function () {
          cleanup();
          reject(OlorinError("unreachable", UNREACHABLE_MESSAGE));
        }, settings.shimTimeoutMs);

        document.addEventListener(resultEvent, onResult);

        var button = document.createElement("button");
        button.className = "olorinPlugin";
        button.type = "button";
        button.hidden = true;
        button.dataset.printer = options.printer;

        if (kind === "kick") {
          button.dataset.action = "cash-drawer";
        } else if (options.selector) {
          button.dataset.print = options.selector;
        } else {
          var holder = document.createElement("div");
          holder.id = "olorin-shim-content-" + makeId().replace(/[^a-z0-9-]/gi, "");
          holder.style.display = "none";
          holder.innerHTML = options.content;
          document.body.appendChild(holder);
          cleanupNodes.push(holder);
          button.dataset.print = "#" + holder.id;
        }

        document.body.appendChild(button);
        cleanupNodes.push(button);
        button.click();
      });
    };

    var chained = shimQueue.then(run, run);
    shimQueue = chained.catch(function () {});
    return chained;
  }

  // ---------------------------------------------------------- negotiation

  var extensionProbe = null;
  function getExtension() {
    if (!extensionProbe) {
      extensionProbe = settings.preferExtension
        ? probeExtension()
        : Promise.resolve({ available: false });
    }
    return extensionProbe;
  }

  var lastTransport = null;

  function resolveContent(options) {
    if (options.content !== undefined) {
      return options.content;
    }
    if (options.selector) {
      var target = document.querySelector(options.selector);
      if (!target) {
        throw OlorinError("bad-request", "No element matches selector '" + options.selector + "'");
      }
      return target.innerHTML;
    }
    throw OlorinError("bad-request", "print() needs either 'selector' or 'content'");
  }

  var OVERRIDE_FIELDS = [
    "copies",
    "duplex",
    "pageWidth",
    "pageHeight",
    "marginTop",
    "marginRight",
    "marginBottom",
    "marginLeft",
    "orientation",
  ];

  function pickOverrides(options) {
    var overrides = {};
    OVERRIDE_FIELDS.forEach(function (field) {
      if (options[field] !== undefined) {
        overrides[field] = options[field];
      }
    });
    return overrides;
  }

  function viaExtensionOrWs(extensionCall, wsCall, shimCall) {
    return getExtension().then(function (extension) {
      if (extension.available) {
        lastTransport = "extension-event";
        return extensionCall();
      }
      return wsCall().then(
        function (result) {
          lastTransport = "websocket";
          return result;
        },
        function (error) {
          if (error && error.code === "unreachable" && shimCall) {
            return shimCall().then(function (result) {
              lastTransport = "extension-shim";
              return result;
            });
          }
          throw error;
        },
      );
    });
  }

  // ------------------------------------------------------------------- API

  function print(options) {
    options = options || {};
    if (!options.printer) {
      return Promise.reject(OlorinError("bad-request", "print() needs a 'printer'"));
    }

    return viaExtensionOrWs(
      function () {
        var detail = Object.assign(
          { printer: options.printer },
          options.selector ? { selector: options.selector } : { content: options.content },
          pickOverrides(options),
        );
        return eventRequest("olorin:print", "olorin:print-result", detail, settings.timeoutMs).then(
          function (result) {
            if (result.success === false) {
              throw OlorinError("print-failed", result.error || "Print failed");
            }
            return { success: true };
          },
        );
      },
      function () {
        var content;
        try {
          content = resolveContent(options);
        } catch (error) {
          return Promise.reject(error);
        }
        var message = Object.assign(
          { id: makeId(), text: "printer-command", content: content, printer: options.printer },
          pickOverrides(options),
        );
        return wsRequest(message, settings.timeoutMs).then(function (response) {
          if (response.success === false) {
            throw OlorinError("print-failed", response.error || "Print failed");
          }
          return { success: true, printer: response.printer };
        });
      },
      function () {
        var shimOptions = { printer: options.printer };
        if (options.selector) {
          shimOptions.selector = options.selector;
        } else {
          try {
            shimOptions.content = resolveContent(options);
          } catch (error) {
            return Promise.reject(error);
          }
        }
        return shimDispatch("print", shimOptions);
      },
    );
  }

  function kickDrawer(options) {
    options = options || {};
    if (!options.printer) {
      return Promise.reject(OlorinError("bad-request", "kickDrawer() needs a 'printer'"));
    }

    return viaExtensionOrWs(
      function () {
        return eventRequest(
          "olorin:kick-drawer",
          "olorin:drawer-result",
          { printer: options.printer },
          settings.timeoutMs,
        ).then(function (result) {
          if (result.success === false) {
            throw OlorinError("print-failed", result.error || "Drawer kick failed");
          }
          return { success: true };
        });
      },
      function () {
        var message = { id: makeId(), text: "kick-drawer", printer: options.printer };
        return wsRequest(message, settings.timeoutMs).then(function (response) {
          if (response.success === false) {
            throw OlorinError("print-failed", response.error || "Drawer kick failed");
          }
          return { success: true, printer: response.printer };
        });
      },
      function () {
        return shimDispatch("kick", { printer: options.printer });
      },
    );
  }

  function status() {
    return getExtension().then(function (extension) {
      if (extension.available) {
        lastTransport = "extension-event";
        return eventRequest("olorin:status", "olorin:status-result", {}, settings.timeoutMs).then(
          function (result) {
            if (result.success === false) {
              return { reachable: false, transport: "extension-event", error: result.error };
            }
            var data = result.data || {};
            return {
              reachable: true,
              transport: "extension-event",
              extensionVersion: extension.version,
              version: data.version || "unknown",
              protocol: data.protocol,
            };
          },
        );
      }
      return wsRequest({ id: makeId(), text: "hello" }, settings.timeoutMs).then(
        function (response) {
          lastTransport = "websocket";
          return {
            reachable: true,
            transport: "websocket",
            version: response.version || "unknown",
            protocol: response.protocol,
          };
        },
        function (error) {
          return { reachable: false, transport: "websocket", error: error.message };
        },
      );
    });
  }

  function listPrinters() {
    // Device enumeration is only available over the direct socket
    return wsRequest({ id: makeId(), text: "list-printer" }, settings.timeoutMs).then(
      function (response) {
        return response.printer || [];
      },
    );
  }

  function configure(overrides) {
    Object.assign(settings, overrides || {});
    extensionProbe = null;
    return window.Olorin;
  }

  window.Olorin = {
    print: print,
    kickDrawer: kickDrawer,
    status: status,
    listPrinters: listPrinters,
    configure: configure,
    transport: function () {
      return lastTransport;
    },
  };
})();
