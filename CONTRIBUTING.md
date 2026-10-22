# Contributing

Please describe the real export task you are trying to complete and the expected files. Reproducible examples must use synthetic records and images, never personal or customer data.

Install Node 22+, run `npm ci`, and use `npm start`. Tests use generated fixtures and mocked external APIs; independent ZIP tests also need Python 3 on PATH. Run `npm test`, `npm run test:site`, and `npm run audit:release` before submitting a change.

Keep the local tool independent of hosted services. Changes that upload user files, persist credentials, collect telemetry, or alter folder/filename preservation need explicit design discussion and regression coverage.

The website code lives under `site/`. Its waitlist database and deployment settings are private operational resources; never commit a database export or credentials.

## Translations

The local tool uses a small shared i18n module without a network service or runtime dependency. Chinese source messages are keys in `public/messages.en.js`; retain every numbered placeholder when editing translations. Browser strings use `tr()` or the `msg` template tag from `public/locale.js`. Static document text is registered once at startup, before source records are rendered. Do not translate arbitrary DOM content or user-supplied names and values.

Export helpers receive the locale explicitly. Do not store a global server language: two clients can request different languages at the same time. Keep CSV machine headers and JSON keys stable, separate archive paths by language, and test both localized headings and untouched source data with `node --test test/i18n.test.mjs`.

