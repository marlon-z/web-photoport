# Data handling

## Local tool

PhotoPort runs on loopback only. A personal access token is held in memory and sent only to Airtable's API. CSV attachment addresses are sent to the applicable Airtable attachment host. No local-tool analytics or automatic update calls are made.

`.runtime/` contains downloaded originals, archives, and saved metadata. Credentials are not included in checkpoints, but metadata and downloaded results can still be private. Disconnecting does not delete these files. After stopping the program, delete the directory yourself when it is no longer needed.

Source URLs can expire. The exporter is read-only and does not delete or modify source records. Files are fetched only after a user starts an export, apart from previews requested by the interface.

## Public website

The website is a separate product-information page. Download links go to GitHub. If enabled, Cloudflare Web Analytics collects aggregate website usage; the local app is not included. Cloudflare and GitHub process requests according to their own privacy policies.

Joining the waitlist is optional and does not create an account or a purchase. The form stores email, the selected use case, the optional need description, expected batch size, and consent time in a private Cloudflare D1 database controlled by the project owner. Do not submit photos, access tokens, sensitive records or passwords. The list is not public, not sold, and only intended for PhotoPort availability and feedback contact.

A deletion link is returned for each submission; keep it to remove that entry without sharing your email publicly. Duplicate submissions are separate entries and can each be removed using their own link. No confirmation or marketing email is automatically sent. Email addresses are unverified, so submissions are an interest signal, not verified users.

To limit abuse, a one-way hash of the request IP and date is retained in a separate short-lived rate-limit table; raw IP addresses are not saved by application code. Expired rate-limit rows are removed on subsequent form requests. The hosting provider may process connection logs independently.

The maintainer reviews the waitlist at the end of the pilot and should delete entries no longer needed. There is no promise of an automatic launch date. To request help without a saved deletion link, contact the maintainer through the GitHub profile's available contact route; do not post your email or private data in a public issue.

