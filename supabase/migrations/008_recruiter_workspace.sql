create table public.recruiter_shortlists (
  id uuid primary key default gen_random_uuid(),
  recruiter_id uuid not null references auth.users(id) on delete cascade,
  candidate_profile_id uuid not null references public.candidate_profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (recruiter_id, candidate_profile_id)
);

create index idx_recruiter_shortlists_owner on public.recruiter_shortlists(recruiter_id, created_at desc);
alter table public.recruiter_shortlists enable row level security;

create table public.recruiter_interviews (
  id uuid primary key default gen_random_uuid(),
  recruiter_id uuid not null references auth.users(id) on delete cascade,
  application_id uuid not null unique references public.recruiter_job_applications(id) on delete cascade,
  scheduled_at timestamptz not null,
  notes text not null default '' check (length(notes) <= 2000),
  status text not null default 'scheduled' check (status in ('scheduled', 'completed', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_recruiter_interviews_owner on public.recruiter_interviews(recruiter_id, scheduled_at);
create trigger trg_recruiter_interviews_updated
  before update on public.recruiter_interviews
  for each row execute function public.set_updated_at();
alter table public.recruiter_interviews enable row level security;

grant all privileges on table public.recruiter_shortlists, public.recruiter_interviews to service_role;
