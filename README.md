# PhotoPort Local

**Export Airtable attachments into folders, keep their original filenames and records, and get a ZIP plus an Excel catalog with picture previews.**

[中文安装说明](README.zh-CN.md) · [Product & hosted-version interest list](https://photoport-local.pages.dev/) · [Report a problem](https://github.com/marlon-z/web-photoport/issues)

Free, open-source software that runs on **your own computer**. No PhotoPort account, payment, R2 bucket or database is required. The interface and export documents support **English and Simplified Chinese**. Switch language at the top right; your choice is remembered on this browser. The hosted edition is **not available yet**.

## Languages

English is the default, including in a Chinese-language browser. Only an explicit choice in the language selector is remembered. Use the **中文 / English** selector at any time without losing the active task, record selection or filters. ZIP support filenames, Excel sheets and headings, the offline gallery and human-readable CSV messages follow your selection. Original filenames, source field names, record IDs and data values are never translated. CSV machine column names and JSON keys remain stable. Existing archives are rebuilt in the chosen language using verified cached files.

## What you receive

- Original attachment files, organized by record, SKU, customer, or customer → SKU.
- A ZIP containing the files, an offline HTML gallery, a manifest, the original selected records, and an Excel catalog with embedded picture previews.
- Original filenames wherever the operating system permits them; collisions receive numbered suffixes. The manifest keeps the original name and record mapping.
- Filters and record selection; partial exports with an explicit missing-file list; retry and saved-job recovery.

This is an attachment exporter, **not a full Airtable base backup or a two-way sync tool**. It does not modify your Airtable records.

## Install and start

1. Install **Node.js 22 or newer** from [nodejs.org](https://nodejs.org/en/download). No Python is needed to use PhotoPort.
2. Download the [latest source release](https://github.com/marlon-z/web-photoport/releases/latest), extract it, and open a terminal in the extracted folder containing `package.json`.
3. Run:

```sh
npm ci
npm start
```

4. Open **http://127.0.0.1:4180/app**. Leave the terminal running while exporting; stop with Ctrl+C.

On Windows you can also double-click **start-photoport.cmd** after extracting the ZIP. It checks Node, installs the locked dependencies if missing, then starts the local server. Internet access is required for the first installation and for fetching your Airtable attachments.

Developers can clone instead:

```sh
git clone https://github.com/marlon-z/web-photoport.git
cd web-photoport
npm ci
npm start
```

## Try it without an account

Click **Try a product sample →**, choose **By customer**, then **Download organized ZIP ↓**. PhotoPort generates a real downloadable sample using included synthetic artwork. You do not need an Airtable account for this demonstration.

**First time here?** [See the finished sample, try 10–50 of your own photos, and tell us whether the result fits your work](docs/FIRST-EXPORT.md). You can inspect the ZIP and Excel sample before installing anything. Feedback about installation problems is welcome too.

## Use your own Airtable data

**CSV — simplest:** export a fresh CSV from your Airtable grid view, include the attachment column and the fields you want to group by, then import it into PhotoPort. CSV must contain official Airtable attachment URLs, not just filenames. Those URLs expire; export a fresh CSV if necessary. CSV rows use synthetic row IDs unless your CSV explicitly includes an original record-ID field; that field remains in the original-data export.

**Read-only connection — optional:** create a [personal access token](https://airtable.com/create/tokens) with only `data.records:read` and `schema.bases:read`, limited to the base you want to export. Select **Connect Airtable**, enter the table/view URL and token. The token stays in process memory; after a restart you must reconnect. The local edition does not include hosted OAuth login.

1. Preview the selected table and attachment columns.
2. Select records and choose folders: per record, by one field, or by two fields.
3. Download. Wait for copying and packaging to finish. Keep the terminal open.
4. Open the ZIP and check `missing-files.csv` if any files failed. Excel shows **thumbnails**, while the `photos/` folders contain original files.

## Limits and recovery

- Node 22+; tested on Windows, with CI configured for Windows, macOS and Linux.
- Maximum **20 MiB per file**, **10 GiB per batch**, **15,000 attachments**. This is not an unlimited exporter.
- Reserve at least **3× the source size** in free disk space for originals, packaging and the final download. A full 10 GiB batch may need more than 30 GiB free.
- After a restart, reconnect the same read-only source or import the same CSV with refreshed URLs, then use **Resume a task or open saved results**. Previously verified files can be reused. Preserve CSV column and row order.
- An expired CSV cannot be refreshed automatically. Missing records, changed source data, quotas and permissions may still require intervention.
- JSON/CSV exports preserve the selected data available to PhotoPort, not every feature of an Airtable base. Attachments are downloaded only when permitted by the source service.

## Privacy and costs

The server binds to `127.0.0.1` only. Do not expose it using a tunnel, reverse proxy or public hosting. This release is for a single trusted computer, not multiple hosted users.

Your downloaded files and saved job metadata remain in `.runtime/`; they can contain private records. Disconnecting clears credentials from memory **but does not delete those files**. Quit the program and remove `.runtime/` yourself when you no longer need the local results. Do not share that directory, exports, tokens, or real CSVs in an issue.

The tool does not send telemetry, photos or records to the maintainer. It contacts Airtable and its attachment servers for your selected data. Optional legacy cloud-upload routes are disabled in this release. Airtable's own plan/API limits and your internet/disk costs still apply.

The separate website waitlist only receives information you explicitly submit there. It is not connected to your local exports and does not charge you.

## Troubleshooting

- **`node` / `npm` not found:** install Node, then reopen your terminal.
- **Port 4180 already in use:** stop the other PhotoPort process, or use `$env:PORT='4181'; npm start` in PowerShell / `PORT=4181 npm start` on macOS/Linux.
- **Installation cannot download dependencies:** check network access to npmjs.org; do not disable TLS verification.
- **No photos in CSV:** confirm the CSV contains the attachment column and valid `airtableusercontent.com` URLs.
- **Files are too large:** select a smaller batch. Oversized individual files are listed as unsupported instead of silently omitted.
- **Need help:** report reproducible steps and synthetic examples in [Issues](https://github.com/marlon-z/web-photoport/issues). See [SECURITY.md](SECURITY.md) for private security reporting.

## Development

```sh
npm ci
npm test
npm run test:site
npm run audit:release
```

The application requires only Node. Some independent ZIP-verification tests also require **Python 3** (`python` on PATH); Windows Python can be installed from python.org. `test/` uses generated data and simulated external services. Test success does not imply every customer workload or hosted deployment is validated.

See [website deployment](docs/WEBSITE.md), [privacy](docs/PRIVACY.md), [contributing](CONTRIBUTING.md), and [third-party notices](THIRD_PARTY_NOTICES.md).

## License

[MIT](LICENSE). Third-party libraries retain their own licenses. Demo artwork is AI-generated and contains no customer photos. PhotoPort is independent of, and not affiliated with, Airtable.

