# Contributing

Please describe the real export task you are trying to complete and the expected files. Reproducible examples must use synthetic records and images, never personal or customer data.

Install Node 22+, run `npm ci`, and use `npm start`. Tests use generated fixtures and mocked external APIs; independent ZIP tests also need Python 3 on PATH. Run `npm test`, `npm run test:site`, and `npm run audit:release` before submitting a change.

Keep the local tool independent of hosted services. Changes that upload user files, persist credentials, collect telemetry, or alter folder/filename preservation need explicit design discussion and regression coverage.

The website code lives under `site/`. Its waitlist database and deployment settings are private operational resources; never commit a database export or credentials.

