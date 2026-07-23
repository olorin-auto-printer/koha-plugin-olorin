# koha-plugin-olorin

Silent printing of Koha slips, receipts, and labels through the
[Olorin Companion App](https://github.com/olorin-auto-printer/olorin-companion-app)
— **no notice template editing required**.

Install the plugin, choose which slip types print where, and every
circulation slip, POS receipt, fee receipt, transfer/hold/recall slip,
overdues slip, and spine label can print silently to the right printer the
moment it renders. The plugin wraps what Koha already displays; notices stay
untouched, and upgrades can't break your markup.

## How it fits together

| Piece                                                                                           | Where                  | Job                                                                                           |
| ----------------------------------------------------------------------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------- |
| **This plugin**                                                                                 | Koha                   | Injects the print logic on slip pages; per-slip-type configuration                            |
| **[Olorin Companion App](https://github.com/olorin-auto-printer/olorin-companion-app)**         | Each workstation       | Does the actual printing; maps the five logical printers to real devices                      |
| **[Olorin browser extension](https://github.com/olorin-auto-printer/olorin-browser-extension)** | Optional, each browser | Alternative transport (avoids Chrome's local-network prompt); required only for non-Koha uses |

The plugin's pages talk to the companion app directly over
`ws://localhost:9696` — **workstations need only the companion app**. When
the browser extension (2.1+) is installed, the plugin automatically routes
through it instead.

## Install

1. Download the `.kpz` from the [releases page](https://github.com/olorin-auto-printer/koha-plugin-olorin/releases).
2. Koha staff interface → Administration → Manage plugins → Upload plugin.
3. Ensure `<enable_plugins>1</enable_plugins>` in koha-conf.xml (package
   installs restart Plack automatically after the upload).
4. Open the plugin's **Configure** page.

## Configure

- Each slip type has a **mode**: **Off** (Koha's normal print dialog,
  untouched — the default), **Manual** (a "Print via Olorin" button replaces
  the dialog), or **Auto** (prints silently as soon as the slip renders).
- Pick one of the five logical printers per type; which _physical_ printer
  that reaches is configured per workstation in the companion app.
- **POS receipts** can also pop the cash drawer after a successful print.
- On **each workstation**, click **Check companion** once on the configure
  page — it verifies connectivity, and on Chrome it triggers the one-time
  local-network permission prompt.

### Chrome's Local Network Access prompt

Chrome 147+ asks once per site before a page may reach `localhost`. Staff
click Allow once, or managed fleets pre-grant it silently with the
[`LocalNetworkAccessAllowedForUrls`](https://chromeenterprise.google/policies/#LocalNetworkAccessAllowedForUrls)
policy:

```json
{ "LocalNetworkAccessAllowedForUrls": ["https://staff.yourlibrary.org"] }
```

Alternatively, install the Olorin browser extension (2.1+) — its transport
is exempt from the prompt. Firefox needs neither.

### Locking down the companion

Add your staff origin to `allowed_origins` in the companion's settings
(app window → Access control) so only your Koha site may print.

## Migrating from the notice-edited method

Older Olorin deployments added `#webPrint` buttons to notice templates and
set `IntranetSlipPrinterJS`. Migration is safe in any order — the plugin
**defers automatically** wherever it sees legacy markup or an
`IntranetSlipPrinterJS` deployment, so nothing double-prints:

1. Configure and enable slip types in the plugin.
2. Clear the `IntranetSlipPrinterJS` system preference.
3. Remove the `<span id="receipt">`/`<button id="webPrint">` markup from
   notices (ISSUEQSLIP, ISSUESLIP, CHECKINSLIP, RECEIPT, …).

`IntranetUserJS` customizations can switch from injected buttons and
`setTimeout(...trigger('click')...)` hacks to the bundled client library:

```javascript
Olorin.print({ printer: "label_printer", selector: "#spinelabel" })
  .then(() => window.close())
  .catch((e) => alert(e.message));
```

The library is served at `/api/v1/contrib/olorin/static/js/olorin.js` on
any Koha with this plugin (and attached standalone to releases). Full API:
`Olorin.print({printer, selector|content, copies?, duplex?, ...})`,
`Olorin.kickDrawer({printer})`, `Olorin.status()`, `Olorin.listPrinters()`.

## Scope notes

- **Spine labels** are supported (the `labels/spinelabel-print.pl` page).
- **OPAC / self-checkout receipts** are out of scope in v1.
- **Label Creator batch PDFs** are server-generated PDFs, not HTML slips —
  out of scope.

## Development

Requires a running [koha-testing-docker](https://gitlab.com/koha-community/koha-testing-docker):

```sh
npm install
npm test              # vitest: client library + slip controller (jsdom)
npm run lint          # eslint + prettier
# Perl tests, inside KTD:
tar -cf - Koha t | docker exec -i kohadev-koha-1 tar -C /tmp/plugin -xf -
ktd --shell --run "cd /tmp/plugin && prove t/"
# Dev loop: copy Koha/ into /var/lib/koha/kohadev/plugins, restart_all,
# enable on the plugins page
npm run test:e2e      # Playwright against KTD (see e2e/e2e-ktd.spec.mjs prereqs)
npm run build:kpz     # dist/koha-plugin-olorin-vX.Y.Z.kpz
```

Releases: tag `vX.Y.Z` (must match `$VERSION` in Olorin.pm) — CI builds the
kpz and attaches it, plus the standalone `olorin.js`, to a GitHub release.

## License

GPL-3.0 — see [LICENSE](LICENSE).
