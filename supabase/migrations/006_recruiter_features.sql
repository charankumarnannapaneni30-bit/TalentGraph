-- 006_recruiter_features.sql
-- Adds recruiter inquiries table, recruiter profile metadata, and permissions.

alter table public.profiles
  add column if not exists role text not null default 'candidate' check (role in ('candidate', 'recruiter', 'admin')),
  add column if not exists company_name text,
  add column if not exists contact_email text,
  add column if not exists contact_phone text;

create table if not exists public.recruiter_inquiries (
  id uuid primary key default gen_random_uuid(),
  recruiter_id uuid not null references auth.users(id) on delete cascade,
  candidate_id uuid not null references auth.users(id) on delete cascade,
  role_title text not null check (length(role_title) between 2 and 150),
  company_name text not null check (length(company_name) between 1 and 200),
  message text not null check (length(message) between 10 and 3000),
  recruiter_contact jsonb not null default '{}'::jsonb,
  candidate_response text check (candidate_response is null or length(candidate_response) <= 3000),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_recruiter_inquiries_recruiter on public.recruiter_inquiries(recruiter_id, created_at desc);
create index if not exists idx_recruiter_inquiries_candidate on public.recruiter_inquiries(candidate_id, created_at desc);

create or replace trigger trg_recruiter_inquiries_updated
  before update on public.recruiter_inquiries
  for each row execute function public.set_updated_at();

alter table public.recruiter_inquiries enable row level security;

create policy recruiter_inquiries_recruiter_access on public.recruiter_inquiries
  for all using (auth.uid() = recruiter_id);

create policy recruiter_inquiries_candidate_access on public.recruiter_inquiries
  for select using (auth.uid() = candidate_id);

create policy recruiter_inquiries_candidate_update on public.recruiter_inquiries
  for update using (auth.uid() = candidate_id);

grant usage on schema public to service_role;
grant all privileges on table public.recruiter_inquiries to service_role;

