create table public.recruiter_access_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  full_name text not null,
  email text not null,
  company_name text not null check (length(company_name) between 2 and 200),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_recruiter_access_requests_updated
  before update on public.recruiter_access_requests
  for each row execute function public.set_updated_at();

alter table public.recruiter_access_requests enable row level security;

create table public.recruiter_jobs (
  id uuid primary key default gen_random_uuid(),
  recruiter_id uuid not null references auth.users(id) on delete cascade,
  company_name text not null check (length(company_name) between 2 and 200),
  title text not null check (length(title) between 2 and 200),
  description text not null check (length(description) between 10 and 8000),
  location text,
  job_type text check (job_type is null or job_type in ('full_time', 'part_time', 'internship', 'contract')),
  status text not null default 'open' check (status in ('open', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_recruiter_jobs_open on public.recruiter_jobs(status, created_at desc);
create index idx_recruiter_jobs_owner on public.recruiter_jobs(recruiter_id, created_at desc);
create trigger trg_recruiter_jobs_updated
  before update on public.recruiter_jobs
  for each row execute function public.set_updated_at();

create table public.recruiter_job_applications (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.recruiter_jobs(id) on delete cascade,
  recruiter_id uuid not null references auth.users(id) on delete cascade,
  candidate_id uuid not null references auth.users(id) on delete cascade,
  message text not null check (length(message) between 10 and 3000),
  status text not null default 'pending' check (status in ('pending', 'reviewing', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, candidate_id)
);

create index idx_recruiter_job_applications_owner on public.recruiter_job_applications(recruiter_id, created_at desc);
create index idx_recruiter_job_applications_candidate on public.recruiter_job_applications(candidate_id, created_at desc);
create trigger trg_recruiter_job_applications_updated
  before update on public.recruiter_job_applications
  for each row execute function public.set_updated_at();

alter table public.recruiter_jobs enable row level security;
alter table public.recruiter_job_applications enable row level security;

grant all privileges on table
  public.recruiter_access_requests,
  public.recruiter_jobs,
  public.recruiter_job_applications
to service_role;

drop policy if exists recruiter_inquiries_recruiter_access on public.recruiter_inquiries;
create policy recruiter_inquiries_recruiter_access on public.recruiter_inquiries
  for all
  using (auth.uid() = recruiter_id and (auth.jwt() -> 'app_metadata' ->> 'role') = 'recruiter')
  with check (auth.uid() = recruiter_id and (auth.jwt() -> 'app_metadata' ->> 'role') = 'recruiter');
