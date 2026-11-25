-- The FP&A Model page opens for five people (Kevan, 2026-11-25): kevan@washlyfe.com,
-- kellyspiller@, kspiller@, becca.jowers@ and ssspore@ (src/features/fpa/access.ts).
-- The page reads its data under fpa_readers, so becca.jowers@ joins the readers; the
-- others already are. jjowers@ and arodriguez@ stay readers (Operator AI) without
-- the page.
insert into public.fpa_readers (account_id, email)
values ('54f3e299-1f61-4ed2-9921-3d02160b72e6', 'becca.jowers@mighty-wash.com')
on conflict do nothing;
