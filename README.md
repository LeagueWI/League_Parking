# Office Parking Reservations

A small, staff-only reservation app for parking spaces **18, 19, and 20**. Staff can reserve one full day, create weekly recurring reservations through a chosen end date, cancel one occurrence, or cancel the remaining dates in a series. There are no email notifications.

## How it works

- The browser displays a month at a time with all three spaces.
- The application opens without sign-in. Anyone with its URL can view, create, or cancel any reservation. Do not use for confidential information.
- Cloudflare D1 stores active reservations. A database uniqueness rule permits only one reservation for each space and date, including when two people submit at nearly the same time.
- Recurring reservations are stored as individual dates plus a series record. If a date conflicts, the series is not partially saved. The response identifies conflicts found before submission; a simultaneous claim is rejected and the schedule can be refreshed.
- Anyone can cancel any date or recurring series.
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

The application uses a Cloudflare Worker and D1. Authentication is not required.

1. Create the D1 database named `parking-reservations`.
2. Put its actual database ID in `wrangler.toml`.
3. Apply migrations to the remote database with `npm run db:migrate:remote` from an authenticated Wrangler environment, or apply the complete SQL migration in the D1 dashboard before use.
4. In Workers & Pages, connect the `LeagueWI/League_Parking` repository and deploy the Worker. Cloudflare Access protection should be **off** as requested.
5. Verify that D1 binding `DB` references `parking-reservations`.
6. Test booking, preventing duplicate bookings, canceling dates, and canceling series before sharing.

**Public access warning:** Anyone who knows or discovers the URL can view the schedule, submit bookings, and cancel any booking. A URL is not an access control.

## Operating rules

- Reservations cover the full day.
- A one-time reservation can be made for today or a future date.
- A recurring series can include multiple weekdays and must have an end date no more than one year after its start.
- Each date in a series is an individual active reservation. Staff can cancel one date without canceling the rest.
- The schedule shows the name supplied for each reservation. No email address is required or displayed.
- No reservation records, credentials, or API keys belong in GitHub.
