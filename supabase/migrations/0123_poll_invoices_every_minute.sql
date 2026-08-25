-- Import emailed invoices faster: poll the invoice mailbox every minute instead
-- of every 5 minutes, so an invoice lands in the Unassigned tab within ~60s of
-- the email arriving (the UI already updates live via realtime once the row is in).
select cron.alter_job(
  (select jobid from cron.job where jobname = 'poll-invoices-mailbox'),
  schedule := '* * * * *'
);
