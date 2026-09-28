# Tyme Importer for [Billy](https://usebilly.app)

A [Billy](https://usebilly.app) plugin that turns a [Tyme](https://www.tyme-app.com) time-tracking export into invoices—one invoice per client (Tyme category), with tracked time rolled up into line items.

This follows the same conventions as Billy’s official [Timemator](https://github.com/usebilly/timemator-plugin) and [Toggl Track](https://github.com/usebilly/toggl-track-plugin) importers.

## What it Does

- **One invoice per category.** Entries are grouped by Tyme’s category (commonly used as the client). A single export covering several categories produces a separate invoice for each.
- **One line item per task.** Within each category, entries are grouped by project + task (+ subtask when present); their hours are summed into a single `Hour` line item.
- **Unit price from your rate.** Each line item prefers an explicit hourly rate from the export, otherwise derives rate from revenue ÷ hours, otherwise falls back to your Billy profile’s default hourly rate.
- **VAT from your profile.** Line items use your profile’s default VAT rate.
- **Service period.** Each invoice’s service dates span the earliest and latest entry for that category.
- **Unbilled first.** When the export marks billing state, already billed/paid rows are skipped—unless *every* row is billed/paid, in which case all rows are imported (same fallback idea as Toggl Track).

Invoice number, sender details, currency, and payment terms come from your active Billy profile—exactly as if you’d hit **New Invoice**.

## Install

1. Download or clone this repository.
2. In Billy, open **Settings → Plugins**.
3. Click **Add Plugin…** and select this folder—or drag the folder onto the list.

For a release zip (once published), attach / install a `Tyme.billyplugin.zip` the same way as other Billy plugins.

## Use

1. In Tyme, export the time entries you want to bill as **CSV** (preferred for the file picker) or **JSON**.
   - Include category, project, task, duration, and rate/revenue columns when the export dialog lets you choose fields.
   - Prefer unbilled / billable entries if Tyme offers that filter.
2. In Billy, choose **Profiles → Import Invoices… → Tyme**.
3. Pick the export file. Billy creates the invoices as drafts for you to review.

### JSON tip

Billy’s import panel is filtered to `.csv` by this plugin’s `fileExtension`. JSON still parses if you can select the file (or temporarily rename `export.json` → `export.csv`—the importer detects JSON content). A future revision may widen the file filter once Billy supports multiple extensions.

## Supported Formats

### CSV

Delimiter may be comma or semicolon (auto-detected). Header aliases are matched case-insensitively and cover common English / German labels:

| Role | Example headers | Required |
| --- | --- | --- |
| Client (invoice recipient) | `category`, `category_name`, `Kategorie`, `client`, `Kunde` | no (empty → blank recipient) |
| Project | `project`, `project_name`, `Projekt` | task or project |
| Task | `task`, `task_name`, `Aufgabe` | task or project |
| Subtask | `subtask`, `Unteraufgabe` | no |
| Duration | `duration`, `duration_rounded`, `duration_decimal`, `Dauer`, `amount_decimal` | yes (> 0) |
| Duration unit | `duration_unit` (`s` / `m` / `h`) | no (heuristics apply) |
| Rate | `rate`, `hourly_rate`, `Stundensatz` | no |
| Revenue | `revenue`, `sum`, `Betrag` | no (can derive rate) |
| Date / start | `start`, `time_start`, `date`, `Datum` | no (service period omitted if missing) |
| Billing | `billing`, `billing_state`, `Billable` | no |

### JSON

Accepts:

- a Tyme-style array of time entry objects (plugin scripting shape),
- a Public API times payload `{ "data": [ ... ] }`,
- a single entry object.

Useful fields mirror Tyme’s scripting / API docs: `category` / `category_name`, `project` / `project_name`, `task` / `task_name`, `duration` (+ optional `duration_unit`), `rate`, `sum` / `revenue`, `start` / `time_start`, `billing` / `billing_state`, `type`.

## Development

```text
.
├── plugin.json          # Billy plugin manifest
├── main.js              # exports.importInvoices
├── helpers.js           # CSV / JSON / duration helpers
├── icon.png
├── fixtures/            # sample exports + smoke test
├── README.md
└── .github/workflows/release.yml
```

Hot reload: with the plugin installed, Billy reloads when you edit `main.js`, `helpers.js`, or `plugin.json`.

### Smoke test

```bash
node fixtures/smoke-test.js
```

### Spec

This plugin targets [Billy’s plugin specification](https://usebilly.app/support/plugin-spec) (`specVersion` 1, import-only). Host commands / live Tyme AppleScript access are out of scope for v1—see the project plan for follow-ups.

## License

MIT
