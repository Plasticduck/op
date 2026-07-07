-- 0052_checklist_roles.sql
-- Assign a checklist template to specific roles. Default is all roles so
-- existing checklists stay visible to everyone. The daily view shows a checklist
-- only when the viewer's role is in this list; the owner (admin) always sees all.
alter table public.checklists
  add column if not exists roles text[] not null
    default '{owner,manager,employee,technician}';
