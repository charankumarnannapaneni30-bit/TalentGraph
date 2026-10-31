alter table public.recruiter_jobs
  add column if not exists required_skills text[] not null default '{}',
  add column if not exists preferred_skills text[] not null default '{}',
  add column if not exists education_requirement text,
  add column if not exists min_experience_months integer not null default 0,
  add column if not exists max_experience_months integer,
  add column if not exists is_remote boolean not null default false,
  add column if not exists eligibility_constraints text[] not null default '{}',
  add column if not exists application_deadline date;

alter table public.recruiter_jobs
  add constraint recruiter_jobs_experience_range_check
  check (min_experience_months >= 0 and (max_experience_months is null or max_experience_months >= min_experience_months));

create table public.recruiter_job_matches (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references auth.users(id) on delete cascade,
  recruiter_job_id uuid not null references public.recruiter_jobs(id) on delete cascade,
  profile_id uuid not null references public.candidate_profiles(id) on delete cascade,
  compatibility_score integer not null check (compatibility_score between 0 and 100),
  score_breakdown jsonb not null default '{}'::jsonb,
  matched_skills text[] not null default '{}',
  missing_skills text[] not null default '{}',
  eligibility_flags jsonb not null default '[]'::jsonb,
  notified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (candidate_id, recruiter_job_id)
);

create index idx_recruiter_job_matches_candidate_score
  on public.recruiter_job_matches(candidate_id, compatibility_score desc);
create index idx_recruiter_job_matches_job
  on public.recruiter_job_matches(recruiter_job_id, compatibility_score desc);

create trigger trg_recruiter_job_matches_updated
  before update on public.recruiter_job_matches
  for each row execute function public.set_updated_at();

alter table public.recruiter_job_matches enable row level security;

alter table public.notifications
  add column if not exists recruiter_job_id uuid references public.recruiter_jobs(id) on delete set null;

create index idx_notifications_recruiter_job
  on public.notifications(recruiter_job_id)
  where recruiter_job_id is not null;

grant all privileges on table public.recruiter_job_matches to service_role;
