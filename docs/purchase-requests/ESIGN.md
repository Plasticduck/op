# Purchase Request e-signatures: legal requirements and how Operator meets them

Finance > Purchase Request (`/app/purchase-requests`) lets people send purchase
requests for approval and sign them electronically. This document maps the U.S.
federal and Texas requirements for electronic signatures to what Operator does,
so an attorney, auditor, or accountant can review it. It is a technical
description, not legal advice. Have counsel review it before relying on it for a
dispute.

## The laws

- **Federal:** Electronic Signatures in Global and National Commerce Act (ESIGN),
  15 U.S.C. 7001 to 7031.
- **Texas:** Uniform Electronic Transactions Act (UETA), Texas Business and
  Commerce Code, Chapter 322 (official text:
  https://statutes.capitol.texas.gov/Docs/BC/htm/BC.322.htm).

Both say a signature or record can't be denied legal effect just because it is
electronic (ESIGN 7001(a); Tex. Bus. & Com. Code 322.007). Neither requires a
particular technology. What they do require is below.

Purchase requests and internal approvals are not in any excluded category (wills
and trusts, family law, court documents, certain consumer notices such as utility
shutoff, foreclosure, eviction, insurance cancellation; ESIGN 7003, Tex. 322.003).

## Requirement by requirement

| Requirement | Source | How Operator meets it |
|---|---|---|
| **Intent to sign.** The signer must mean to sign. | ESIGN 7006(5); Tex. 322.002(8) | The signer adopts a signature (drawn, or typed and shown in a signature style), reads what signing means ("I approve this purchase request", or for the requester, that it is accurate and for a business purpose), reads the intent statement, and selects **Sign and approve** / **Sign and send**. The intent statement and its version are saved with every signature (`esign_events.detail.intent`). |
| **Consent to do business electronically.** Parties must agree to use electronic records; for consumers, ESIGN adds specific disclosures. | Tex. 322.005(b); ESIGN 7001(c) | Before a person's first signature they must read and accept the **Electronic Record and Signature Disclosure** (`esign_disclosures`). It covers scope, paper copies at no charge, signing on paper instead, how to withdraw and its effect, hardware and software needed, keeping contact details current, and what to expect if requirements change. Although these are internal business records (not consumer transactions), it follows the ESIGN consumer rules as a best practice. Acceptance is recorded with the disclosure version and its SHA-256, time, IP, and device (`esign_consents`). |
| **Shows they can access the electronic form.** | ESIGN 7001(c)(1)(C)(ii) | The consent checkbox confirms they can open and keep the records and PDF files on the device they are using, and the disclosure is offered as a PDF from the same screen. |
| **Right to withdraw consent, with no effect on earlier records.** | ESIGN 7001(c)(1)(B)(i), 7001(c)(4); Tex. 322.005(c) | Purchase Request > **E-signature** > **Withdraw consent**. The time, IP and device are recorded. Signatures made before stay valid. Anyone waiting on that person's signature is told, and the signature is collected on paper. |
| **A paper alternative.** | ESIGN 7001(c)(1)(B)(i); Tex. 322.005(c) | A signer can choose **Sign on paper instead**. The requester is told. Accounts Payable uploads the hand-signed page (**Record paper signature**), which is fingerprinted, kept with the record, and noted in the audit trail and certificate. |
| **Attribution.** A signature is the person's if it was their act, which can be shown by any means, including a security procedure. | Tex. 322.009 | Each person signs in with their own Operator account (Supabase Auth). The edge function checks the session token on every signing step and acts only for that account. Each signature records the account, name, email, IP address, device, and server time. Only the signer can sign their own row. Approvers can't approve their own request. |
| **Signature logically associated with the record.** | ESIGN 7006(5); Tex. 322.002(8) | When a request is sent, Operator saves an exact snapshot of it (`esign_envelopes.document`) and its SHA-256 fingerprint (`document_hash`): every field, line, total, the attachments' own fingerprints, and the signing order. Every signature records the fingerprint it was applied to (`signed_document_hash`), and Operator refuses a signature if the signer reviewed anything different. |
| **Integrity: changes can be detected.** | Tex. 322.010; ESIGN 7001(e) | A sent request can't be edited (database rules); changing it means voiding and sending a new version that everyone signs again. Signed content, signatures, consents and the audit trail are protected by database triggers: they can't be changed or deleted, except by a database administrator. The finished PDF is fingerprinted (`sealed_pdf_sha256`) and digitally sealed (see below); **Verify a PDF** checks any copy against the original. |
| **Retention, and accurate reproduction for everyone entitled to it.** | ESIGN 7001(d), 7001(e); Tex. 322.012 | The sealed PDF is stored in Operator (private storage) and emailed to every signer and copy recipient when signing completes. Anyone on the request can download it again at any time. Records are never deleted by the app. |
| **When a record is sent and received.** | Tex. 322.015 | The audit trail records when each step was sent to each person (and the email ID), when they first opened it, when they signed or declined, and when the record was completed and sealed. All times come from Operator's servers. |
| **Chance to catch mistakes before signing.** | Tex. 322.010(2) | Requesters review the exact document before they sign and send it. Approvers see the full request before they sign, and can decline with a reason. |
| **Admissibility.** A record or signature can't be excluded from evidence just because it is electronic. | Tex. 322.013 | The certificate of completion, the stored snapshot, and the audit trail together show who signed, what, when, how, and from where. |

## The signed record (sealed PDF)

Built on the server (`supabase/functions/purchase-requests`, `_shared/esign_pdf.ts`)
when the last signature arrives:

1. **The purchase request.** All details, line items, the business reason,
   attachments with their SHA-256 fingerprints, and each signature with the
   signer's name, role, time, signature ID and IP.
2. **Certificate of Completion.** The envelope ID, document fingerprint,
   originator, sent and completed times (Central and UTC), and the signing order.
   For each signer: identity, how they signed (drawn, typed, or on paper), IP
   address, device, sent, viewed, signed and disclosure-accepted times. It also
   lists the copies sent, the full envelope history, and a legal notice.
3. **The disclosure** each signer accepted, word for word, with its version and
   fingerprint.

The envelope ID is printed on every page. Copies made before completion carry an
"IN PROGRESS / DECLINED / VOIDED: NOT A COMPLETED RECORD" banner and watermark.

**Digital seal.** The finished PDF is signed with Operator's seal certificate
(PDF digital signature, `adbe.pkcs7.detached`). Adobe Acrobat and Reader show it
in the Signature Panel and report any change made after sealing. The certificate
is self-issued by Operator, so Adobe shows its identity as "not verified" unless
it is trusted. The tamper check works either way. The certificate's fingerprint
is printed in the Certificate of Completion and stored with each envelope.
Secrets: `ESIGN_SEAL_P12` (base64 PKCS#12) and `ESIGN_SEAL_P12_PASS`. Without
them the PDF is still built, fingerprinted and verifiable in Operator, but it
isn't digitally sealed.

## Where things live

- Database (migration `0238_purchase_requests_esign.sql`): `purchase_requests`,
  `purchase_request_files`, `purchase_approval_rules`, `esign_envelopes`,
  `esign_recipients`, `esign_events`, `esign_consents`, `esign_disclosures`,
  `esign_saved_signatures`, the `esign_verify_pdf()` lookup, and the
  `purchase-requests` storage bucket.
- Edge function `purchase-requests`: every signing step (prepare, send, view,
  sign, decline, paper signatures, void, reopen, remind, purchased, PDF, consent).
- App: `src/features/purchasing/` (the page) and `src/components/esign/`
  (signature pad, adopt-and-sign, disclosure, verify, settings).

## Not done, or worth deciding

- **Seal certificate.** Must be added as the two secrets above before PDFs are
  digitally sealed. A certificate from a CA on Adobe's Approved Trust List (AATL)
  would make Adobe show the seal as fully trusted. Not required by law.
- **Trusted timestamps.** Times come from Operator's servers. An RFC 3161
  timestamp from an outside authority could be added to the seal.
- **Stronger sign-in at signing.** Today a signature rests on the person's
  Operator login. If policy calls for it, a one-time code by email or text at
  signing can be added.
- **Retention period.** Records are kept indefinitely. Set a policy (for example,
  at least 7 years for financial records) if anything should ever be purged.
- **People outside the company.** Only Operator users can sign today. Vendors or
  other outside signers would need an emailed link with an identity check.
- **Disclosure changes.** A new version is a new row in `esign_disclosures` (the
  text of a published version can't change). Everyone accepts the new version
  before their next signature.
