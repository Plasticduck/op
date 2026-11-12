// Who can open the Secret Shoppers admin page (/app/secret-shoppers) and manage
// shoppers and PINs, by email (Kevan, 2026-11-11). The page isn't in the nav;
// it's reached by URL. Shoppers themselves use the /shop phone app with a PIN
// and need none of this. The secret-shopper function keeps its own copy of
// this list (ADMIN_EMAILS), so change both together.
export const SECRET_SHOPPER_EMAILS: string[] = ['kevan@washlyfe.com', 'jjowers@mighty-wash.com']
