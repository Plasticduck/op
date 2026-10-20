-- Invoice Approval's approver list moves from a hardcoded set in InvoicesPage
-- into company_settings.invoiceApproverEmails, so admins can add and remove
-- approvers from the page itself. Seeds Mighty Wash with the exact list the code
-- used before; other settings keys are left untouched.
update public.accounts
set company_settings = coalesce(company_settings, '{}'::jsonb) || jsonb_build_object(
  'invoiceApproverEmails', jsonb_build_array(
    'berhl@mighty-wash.com', 'hmurry@mighty-wash.com', 'kstaton@mighty-wash.com',
    'ernest@mighty-wash.com', 'justin.gamboa@mighty-wash.com', 'mcanales@mighty-wash.com',
    'rbreed@mighty-wash.com', 'lester@mighty-wash.com', 'isabel@mighty-wash.com',
    'djones@mighty-wash.com', 'josh.roberts@mighty-wash.com', 'kellyspiller@mighty-wash.com',
    'gwatson@mighty-wash.com', 'shelbi@mighty-wash.com', 'kjowers@mighty-wash.com',
    'ncarter@mighty-wash.com', 'staci@mymightywash.com',
    'kwatson@mighty-wash.com', 'debra@mighty-wash.com'
  )
)
where id = '54f3e299-1f61-4ed2-9921-3d02160b72e6'
  and not (coalesce(company_settings, '{}'::jsonb) ? 'invoiceApproverEmails');
