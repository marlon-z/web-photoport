# Free information site and interest list

This directory deploys **only the information pages and waitlist**, not the Node exporter or a hosted SaaS. There are no payment secrets, Airtable tokens, Neon credentials or R2 bindings in this site.

## Deploy to an existing Cloudflare Free account

1. Create a D1 database on the **Workers Free** plan. Run `site/schema.sql` in its SQL console. Do not upgrade the account.
2. Connect the GitHub repository to **Cloudflare Pages**. Production branch: `main`; root directory: `site`; build command: `npm run build`; output directory: `public`; Node version: 22.
3. Bind the D1 database in the production Pages environment as **WAITLIST**.
4. Add a production environment variable **SIGNUPS_OPEN=true**, then redeploy. Without both settings the form reports unavailable and does not pretend to save data.
5. Enable free Cloudflare Web Analytics if desired. The CSP permits the official beacon; no local-app telemetry is added.
6. Verify the public English and Chinese pages, source and sample downloads, a synthetic signup, the private database row, and its deletion link. Never publish the database contents.

The checked-in site uses `photoport-local.pages.dev`. Change the site URL in `site/build.mjs` and the public documentation if you deploy elsewhere. No domain purchase is required. `_routes.json` invokes Functions only for `/api/*`, leaving static pages on static hosting.

## Free limits and abuse controls

Cloudflare Free quotas are shared with the account's other projects. Free Workers/Pages Functions and D1 have daily hard limits; requests may stop working when quotas are exhausted. Verify the account remains Free before deployment. If the owner later upgrades to a usage-billed plan, that billing assumption changes.

The form also limits valid submission attempts to **5 per IP per hour, 100 per UTC day, 1,000 for the pilot overall**. These are application limits, not a billing guarantee. Invalid submissions, website visits and provider requests still consume some provider quota. The honeypot is basic spam friction, not proof of identity. Email addresses are not verified.

Counters deliberately include denied valid attempts to keep enforcement conservative. The pilot total is not reduced when a signup is deleted. Do not blindly reset it to enable unlimited collection.

## View results privately

Open Cloudflare → D1 → the waitlist database → Console. These queries reveal only aggregate information:

```sql
SELECT COUNT(*) AS submissions, COUNT(DISTINCT email) AS distinct_emails FROM waitlist;
SELECT scenario, COUNT(*) AS submissions FROM waitlist GROUP BY scenario;
SELECT price_interest, COUNT(*) AS submissions FROM waitlist GROUP BY price_interest;
```

Use the private D1 Studio to inspect individual entries when needed. Do not copy those records to GitHub, a public issue, static files or analytics events. Contacting subscribers is a separate deliberate action; this code sends no emails.

GitHub **Insights → Traffic** shows recent repository visitors and clones. Cloudflare Web Analytics shows website traffic once data arrives. Neither clones nor waitlist submissions are evidence of a completed export or payment. Record a weekly aggregate snapshot because GitHub's traffic view covers only the past 14 days.

## Pause or remove

Set `SIGNUPS_OPEN=false` and redeploy to pause new signups. The removal endpoint remains available. To roll back pages, use Cloudflare Pages deployment rollback. Changing repository visibility does not retract existing public clones.

Review the list at the end of the pilot. Delete records no longer required after following the user's data-retention instructions. Keep all exports of the list outside this repository.

## Local testing

```sh
node site/build.mjs
npm run test:site
node site/preview.mjs
```

Open http://127.0.0.1:4182. This uses a local SQLite database under `.runtime-site/` and never contacts the production database. The preview is not a production web server. No real email is needed for tests; use a reserved example.com address.

