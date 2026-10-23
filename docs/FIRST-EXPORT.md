# Try PhotoPort with a small batch

PhotoPort is a **free, open-source local exporter** for Airtable attachments. It runs on your computer. The online edition is not available yet.

## See the output before installing anything

Download the [English example ZIP](https://github.com/marlon-z/web-photoport/releases/download/v0.2.1/photoport-example-en.zip) or just the [example Excel catalog](https://github.com/marlon-z/web-photoport/releases/download/v0.2.1/photoport-example-en.xlsx). These use generated product images, not customer data. No PhotoPort account is needed.

In the ZIP, check the original images under `photos/`, the Excel catalog, the offline gallery and the manifest. The Excel pictures are embedded thumbnails; the separate files are the originals. Would that package be useful for your customer, colleague or archive?

## Try 10–50 of your own attachments

1. Follow the [installation guide](../README.md#install-and-start). You need Node.js 22 or newer. Installation takes place on your computer; do not upload your CSV here.
2. In Airtable, make a small grid view containing the records you want to try. Include the attachment column and your SKU, customer or other grouping field. Export a **fresh CSV**, then import it into PhotoPort promptly because the download links expire. The CSV must contain official Airtable attachment URLs, not just filenames or private Google Drive links.
3. Select the relevant attachment column and choose folders by record, SKU, customer or customer → SKU. Download the organized ZIP.
4. Extract the ZIP. Compare it with your source: are the expected originals present, in the right folders, with usable filenames? Open the Excel catalog and check the previews. Check the missing-file report for failures.

Start with 10–50 attachments, each below **20 MiB**. Current limits are **10 GiB and 15,000 attachments per batch**. Keep at least three times the source size free on disk. If your task exceeds these limits, tell us the approximate size instead of attempting a large trial.

CSV rows use generated row IDs; include Airtable's original record ID as a CSV field if you need it preserved in the exported source data. Read-only API access is an optional alternative, explained in the installation guide.

This does not create permanent public image URLs, update Google Sheets image formulas, restore a full Airtable base or change your Airtable records. It gives you an offline copy and catalog.

## Tell us whether it helped

Reply in the community thread where you found PhotoPort, or [share first-export feedback on GitHub](https://github.com/marlon-z/web-photoport/issues/new?template=first-export.yml).

Three things are most useful:

1. What were you trying to deliver, and how do you do it today?
2. Did you get the right files, folders and Excel catalog? If not, where did you get stuck?
3. Roughly how long did it take, and when would you need it again?

Installation failures are useful feedback too. You do not need to share your data to explain a problem. Public feedback should contain no real CSVs, customer photos, private filenames, attachment URLs, credentials or logs.

If installation is the problem, the [optional hosted-version interest form](https://photoport-local.pages.dev/#waitlist) lets you describe what you need privately. It does not charge you or promise a launch date. A completed local export is much more useful feedback than a star or a download count.
