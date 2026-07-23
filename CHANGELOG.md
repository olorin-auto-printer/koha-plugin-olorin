# Changelog

## v1.0.0 (unreleased)

Initial release.

- Zero-edit silent printing for 16 slip types: checkout/quick/checkin slips,
  custom patron slips, transfer, hold transfer, article request, recall,
  overdues, POS receipt/payout (with optional cash-drawer kick), fee
  receipt, invoice, notice reprint, patron summary, preservation slips, and
  spine labels.
- Per-type Off / Manual / Auto modes, logical printer selection, and
  popup auto-close.
- Direct WebSocket transport to the companion app (no browser extension
  required), automatic use of the extension's event API when present
  (extension 2.1+), and a compatibility shim for extension 2.0.0.
- Bundled standalone client library (`olorin.js`) for IntranetUserJS and
  custom integrations.
- Safe coexistence with notice-edited and IntranetSlipPrinterJS
  deployments.
