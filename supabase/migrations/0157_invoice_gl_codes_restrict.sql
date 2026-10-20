-- Invoice Approval: restrict the GL code dropdown to the approved list
-- (provided 2026-10-20). Every other code is switched off, not deleted: invoices
-- store their GL code as text, so past invoices keep the code they were filed
-- under, and any code can be switched back on later by setting active = true.
-- Mighty Wash account only.
update public.invoice_gl_codes
set active = code in (
  '25001 · Furniture and Equipment',
  '25002 · Leasehold Improvements',
  '30002 · Due from/to - MW Properties:30006 · CIP due from MWP',
  '65000 · Chemical CPC',
  '65001 · Cust Auto Dmg',
  '65002 · Vending',
  '65003 · ZK Lube #19',
  '65004 · Salt, Tunnel Cleaning, Etc,',
  '65012 · Detail COGS',
  '70000 · Sales and Marketing:700001 · Advertising',
  '70000 · Sales and Marketing:700015 · Advertising Supplies',
  '70000 · Sales and Marketing:700030 · Events',
  '70000 · Sales and Marketing:700037 · Fundraisers',
  '70000 · Sales and Marketing:700045 · Optspot/Rinsed',
  '70000 · Sales and Marketing:700060 · Signs',
  '70000 · Sales and Marketing:700075 · Sponsorship',
  '70005 · Auto Expense:700050 · Auto Other',
  '70013 · Dues & Subscriptions:70015 · DRB',
  '70013 · Dues & Subscriptions:70017 · Other',
  '70045 · Office Supplies',
  '70055 · Repairs/Maint:70019 · Equipment Rental',
  '70055 · Repairs/Maint:70056 · General',
  '70055 · Repairs/Maint:70058 · Backroom Chem',
  '70055 · Repairs/Maint:70059 · Property mgmt',
  '70055 · Repairs/Maint:70060 · Lawn',
  '70061 · Safety & Security:70062 · Security Monitoring',
  '70061 · Safety & Security:70063 · Safety Compliance',
  '70064 · Shipping Charges',
  '70065 · Startup Expenses',
  '70066 · Operating Supplies',
  '70066 · Operating Supplies:70014 · Detail Operating Supplies',
  '70072 · Team Building',
  '70073 · Technology:70074 · Hardware',
  '70073 · Technology:70075 · Subscriptions',
  '70076 · Training & Certificates',
  '70083 · Uniform',
  '70084 · Utilities:70087 · Pumping',
  '80000 · Ask My Accountant',
  '70037 · Meals:70038 · Site'
)
where account_id = '54f3e299-1f61-4ed2-9921-3d02160b72e6';
