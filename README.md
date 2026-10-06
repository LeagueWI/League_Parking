# Office Parking Reservations

A small, staff-only reservation app for parking spaces **18, 19, and 20**. Staff can reserve one full day, create weekly recurring reservations through a chosen end date, cancel one occurrence, or cancel the remaining dates in a series. There are no email notifications.

## How it works

- The browser displays a month at a time with all three spaces.
- Cloudflare Access provides staff sign-in. The Worker verifies the signed Access token and checks the staff email domain before returning reservation data or accepting changes.
- Cloudflare D1 stores active reservations. A database uniqueness rule permits only one reservation for each space and date, including when two people submit at nearly the same time.
- Recurring reservations are stored as individual dates plus a series record. If a date conflicts, the series is not partially saved. The response identifies conflicts found before submission; a simultaneous claim is rejected and the schedule can be refreshed.
- Staff may cancel their own reservation. An administrator may cancel any date or any series.
- Cancellation removes the active record and releases the date immediately. The app does not retain booking history or send email.

## Local checks

Requirements: Node.js 20 or later and npm.

```sh
npm install
npm test
```

To preview against a local D1 database, copy `.dev.vars.example` to `.dev.vars`, then run:

```sh
npm run db:migrate:local
npm run dev
```

The local identity override works only for `localhost` or `127.0.0.1`. It is not accepted on a deployed hostname. Do not copy `.dev.vars` into source control.

## Cloudflare setup

1. Create a D1 database:

   ```sh
   npx wrangler login
   npm run db:create
   ```

2. Replace the placeholder `database_id` in `wrangler.toml` with the ID returned by that command.
3. Apply the schema to the remote database:

   ```sh
   npm run db:migrate:remote
   ```

4. Deploy once to create the Worker in your account:

   ```sh
   npm run deploy
   ```

5. In Cloudflare, open **Workers & Pages**, select `lwm-parking-reservations`, and enable **Protect this Worker behind Access** for all traffic. Set an Access policy that allows the `lwm-info.org` email domain. This protects the Worker URL, including its `workers.dev` address, without requiring a separate website host name.
6. Configure these remaining Worker values in Cloudflare. Keep administrator email addresses out of the repository and store `ADMIN_EMAILS` as a Secret.

   | Variable | Value |
   | --- | --- |
   | `ACCESS_TEAM_DOMAIN` | `https://<your-team>.cloudflareaccess.com` |
   | `ACCESS_AUD` | The audience tag for the parking app's Cloudflare Access application |
   | `ADMIN_EMAILS` (Secret) | Comma-separated office email addresses allowed to cancel any reservation |

`STAFF_EMAIL_DOMAIN` and `APP_TIME_ZONE` are already set in `wrangler.toml`. The `keep_vars` setting preserves values you configure in the dashboard during later deployments.

7. Redeploy so the API can validate the Access token:

   ```sh
   npm run deploy
   ```

8. Open the protected `workers.dev` URL, sign in, and add any standing weekly reservations through **Repeat weekly**.

The API independently verifies the `Cf-Access-Jwt-Assertion` signature, issuer, audience, expiration, and staff email domain. Protect the application hostname with Cloudflare Access as well. The Worker does not trust a client-supplied email address for ownership.

## Operating rules

- Reservations cover the full day.
- A one-time reservation can be made for today or a future date.
- A recurring series can include multiple weekdays and must have an end date no more than one year after its start.
- Each date in a series is an individual active reservation. Staff can cancel one date without canceling the rest.
- The schedule shows the reserving person's display name. The administrator view also shows their office email address for the next 93 days.
- No names, reservations, credentials, or API keys belong in GitHub.
