# QuickBooks sync

Kevan (2026-10-30): build a SaasAnt-style QuickBooks tool inside Operator.
Mighty Wash runs **QuickBooks Enterprise** (Desktop). First piece: approved
invoices go into QuickBooks as bills. Kevan only for now
(`/app/quickbooks`, `RequireEmails` + the Finance Sidebar item's `emails`).

## How it connects

QuickBooks Desktop has no cloud API. Intuit's free **Web Connector**, on the
PC that has QuickBooks, checks in with the `qbwc` edge function (SOAP) on a
schedule (the `.qwc` file sets every 15 minutes). Operator never reaches into
QuickBooks; it only answers the Web Connector. Work waits in `qb_jobs` until
the next check-in, so the PC can be off when someone sends.

Each check-in: `authenticate` (user name + password; `qb_check_login`, bcrypt)
-> `sendRequestXML` -> `receiveResponseXML` -> repeat while there's work ->
`closeConnection`. Work, in order:

1. Lists, when over 12 hours old or someone pressed Refresh lists: vendors,
   accounts (full name, number, type) and classes, active and inactive, into
   `qb_list_items` (`qb_replace_list`).
2. Queued bills, 20 a round, as qbXML 13.0 `BillAddRq` by QuickBooks ListIDs.

A bill QuickBooks accepts is `posted` with its TxnID and its invoice is marked
exported (`exported_by_name` "<name> (sent to QuickBooks)"), so it leaves
Invoice Approval's Approved tab. A rejection is `failed` with QuickBooks' own
message. A bill handed over with no answer (the Web Connector crashed, the PC
went off) is `unknown` and is never resent by itself: a person checks
QuickBooks, then marks it "It's in QuickBooks" or sends it again. An invoice
exported from Invoice Approval after it was queued is skipped (`failed`, with
why). One live job per invoice (unique index), so nothing goes in twice.

## Matching (`src/lib/quickbooks/match.ts`)

The bill itself comes from `src/lib/quickbooks/invoiceBill.ts`, shared with
Invoice Approval's CSV and IIF downloads (same bill number with the "Ask My
Accountant" `*`, same lines per GL / site split, same classes). Then every name
must resolve to one active QuickBooks list item before the bill can be sent:

- Vendor: by name.
- Account: GL codes are stored the way QuickBooks shows them with account
  numbers on (`70000 · Sales and Marketing:700001 · Advertising`). QuickBooks
  knows that account as `Sales and Marketing:Advertising`, number `700001`:
  match on the name without numbers, then on the last number.
- Class: by full name (`West:22- 87th and Evans Odessa`), else by name when
  only one class has it.
- Bill number at most 20 characters (QuickBooks' limit), a date, a total.

Anything else is listed on the bill as why it can't go yet.

## Data (migration 0199)

- `qb_connections`: one per account. Web Connector user name, bcrypt password
  hash (made by `qb_new_password`, shown once; hash and session columns aren't
  granted to app roles), the `.qwc` OwnerID / FileID, company file and qbXML
  version it reported, last check-in, last error, list timestamps, session.
- `qb_list_items`: the cached lists.
- `qb_jobs`: bills. People (Admins) may queue an approved invoice, cancel a
  queued one, send a failed or unknown one again, or mark an unknown one found
  in QuickBooks (`qb_jobs_guard`); everything else is the service role's.

## Setting it up (on the QuickBooks PC)

On the QuickBooks page: make the Web Connector password (shown once), download
`operator-quickbooks.qwc`. In QuickBooks Enterprise, signed in as the Admin:
File > Update Web Services > Add an application > the file > "Yes, always;
allow access even if QuickBooks is not running" > sign in as the Admin. Type
the password into the Web Connector, tick Operator, turn on Auto-Run, Update
Selected. The first check-in brings the lists; bills can go after that.

The PC must be on and signed in to Windows for the Web Connector to run.
QuickBooks itself needn't be open (unattended mode), but the company file must
not be open in single-user mode elsewhere. If the company file is hosted
(Right Networks, Summit and the like), the Web Connector runs on that hosted
desktop; ask the host.

## Testing

- `supabase/tests/quickbooks.sql` (21 checks, rolled back): only Admins make
  the login, see or queue anything; the hash, the login check and the list
  replace are out of reach; one live job per invoice; exported invoices can't
  be queued; people can't mark bills entered, change a bill's contents or
  delete one; cancel, retry and found-in-QuickBooks work; other companies see
  nothing; the login check takes the right password (any case user name) and
  refuses a wrong one.
- The `qbwc` function was driven on 2026-10-30 by a script playing the Web
  Connector against the deployed function on the demo account (32 checks):
  wrong logins refused, the lists round (names unescaped, account numbers,
  sub-classes), "none" when idle, the remembered company file, bills in
  schema order by ListID with escaped memos, posted / failed (QuickBooks'
  words) / unknown, invoices marked exported, a request QuickBooks can't parse,
  a check-in that never reported back, a stale session's answer ignored.
- The page was checked in headless Chrome with mocked data (28 checks): setup,
  the one-time login, the `.qwc` contents, matching (numbers stripped, by
  account number after a rename, sub-class by name, inactive and missing
  names, long bill numbers), sending, and every Sent action.
- Not tested against a real QuickBooks company file yet: that needs the Web
  Connector installed on Mighty Wash's QuickBooks PC.

## Next

1. First real run on Mighty Wash's QuickBooks PC.
2. Open it to the AP people (Invoice Approval's full-access list), and add
   "Send to QuickBooks" on Invoice Approval's Approved tab.
3. The spreadsheet uploader (any CSV / Excel to bills, invoices, journal
   entries, ...), on the same connection.
4. Per Diem and Mileage, and daily site sales as journal entries.
