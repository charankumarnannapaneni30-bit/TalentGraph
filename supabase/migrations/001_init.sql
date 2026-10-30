create extension if not exists "pgcrypto";

create type public.document_type as enum (
  'resume', 'certificate', 'education_record', 'project_report',
  'project_screenshot', 'text_note', 'github_profile', 'portfolio_link'
);
create type public.document_status as enum ('uploaded', 'processing', 'processed', 'failed');
create type public.job_status as enum ('open', 'closed', 'expired');
create type public.notification_type as enum ('new_match', 'profile_unlock', 'job_reopened', 'profile_ready', 'system');

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  consent_ai_processing boolean not null default false,
  consent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  preferred_locations text[] not null default '{}',
  open_to_remote boolean not null default true,
  job_types text[] not null default '{}',
  experience_level text not null default 'fresher'
    check (experience_level in ('student', 'fresher', 'junior', 'mid', 'senior')),
  min_salary numeric check (min_salary is null or min_salary >= 0),
  target_roles text[] not null default '{}',
  excluded_companies text[] not null default '{}',
  notify_new_matches boolean not null default true,
  notify_min_score int not null default 65 check (notify_min_score between 0 and 100),
  updated_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, consent_ai_processing, consent_at)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    false,
    null
  );
  insert into public.preferences (user_id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  doc_type public.document_type not null,
  title text check (title is null or length(title) <= 200),
  original_filename text,
  mime_type text,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  storage_path text,
  source_url text,
  raw_text text check (raw_text is null or length(raw_text) <= 20000),
  status public.document_status not null default 'uploaded',
  error_message text,
  extracted jsonb,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_documents_user on public.documents(user_id, created_at desc);
create trigger trg_documents_updated before update on public.documents
for each row execute function public.set_updated_at();

create table public.candidate_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  version int not null check (version > 0),
  is_current boolean not null default true,
  summary text,
  education jsonb not null default '[]'::jsonb,
  work_experience jsonb not null default '[]'::jsonb,
  projects jsonb not null default '[]'::jsonb,
  certifications jsonb not null default '[]'::jsonb,
  specializations text[] not null default '{}',
  strengths jsonb not null default '[]'::jsonb,
  skills jsonb not null default '[]'::jsonb,
  evidence_report jsonb not null default '{}'::jsonb,
  total_experience_months int not null default 0 check (total_experience_months >= 0),
  highest_education text,
  user_overrides jsonb not null default '{}'::jsonb,
  source_document_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (user_id, version)
);
create unique index uq_candidate_current on public.candidate_profiles(user_id) where is_current;

create table public.career_recommendations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  profile_id uuid not null references public.candidate_profiles(id) on delete cascade,
  career_title text not null,
  domain text not null,
  suitability_score int not null check (suitability_score between 0 and 100),
  score_breakdown jsonb not null default '{}'::jsonb,
  supporting_strengths jsonb not null default '[]'::jsonb,
  relevant_skills jsonb not null default '[]'::jsonb,
  missing_skills jsonb not null default '[]'::jsonb,
  career_opportunities jsonb not null default '[]'::jsonb,
  recommended_improvements jsonb not null default '[]'::jsonb,
  reasoning text,
  is_stretch boolean not null default false,
  created_at timestamptz not null default now()
);
create index idx_career_user on public.career_recommendations(user_id, suitability_score desc);

create table public.job_sources (
  id uuid primary key default gen_random_uuid(),
  adapter text not null check (adapter in ('greenhouse', 'lever', 'manual')),
  company_name text not null,
  board_token text,
  is_active boolean not null default true,
  last_synced_at timestamptz,
  last_error text,
  unique (adapter, board_token)
);

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  source_id uuid references public.job_sources(id) on delete set null,
  source text not null check (source in ('greenhouse', 'lever', 'manual')),
  external_id text not null,
  company_name text not null,
  title text not null,
  description text,
  required_skills text[] not null default '{}',
  preferred_skills text[] not null default '{}',
  education_requirement text,
  min_experience_months int not null default 0 check (min_experience_months >= 0),
  max_experience_months int check (max_experience_months is null or max_experience_months >= min_experience_months),
  job_type text check (job_type is null or job_type in ('full_time', 'part_time', 'internship', 'contract')),
  location text,
  is_remote boolean not null default false,
  salary_min numeric,
  salary_max numeric,
  salary_currency text,
  check (salary_max is null or salary_min is null or salary_max >= salary_min),
  eligibility_constraints text[] not null default '{}',
  application_deadline date,
  status public.job_status not null default 'open',
  official_apply_url text not null check (official_apply_url like 'https://%'),
  requirements_extracted boolean not null default false,
  last_seen_at timestamptz not null default now(),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, external_id)
);
create index idx_jobs_status on public.jobs(status, last_seen_at desc);
create index idx_jobs_skills on public.jobs using gin (required_skills);
create trigger trg_jobs_updated before update on public.jobs
for each row execute function public.set_updated_at();

create table public.job_matches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  profile_id uuid not null references public.candidate_profiles(id) on delete cascade,
  compatibility_score int not null check (compatibility_score between 0 and 100),
  score_breakdown jsonb not null,
  matched_skills text[] not null default '{}',
  missing_skills text[] not null default '{}',
  eligibility_flags jsonb not null default '[]'::jsonb,
  explanation jsonb,
  is_saved boolean not null default false,
  is_dismissed boolean not null default false,
  notified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, job_id)
);
create index idx_matches_user_score on public.job_matches(user_id, compatibility_score desc);

create table public.skill_gap_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  target_type text not null check (target_type in ('career', 'job')),
  career_id uuid references public.career_recommendations(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete cascade,
  report jsonb not null,
  created_at timestamptz not null default now(),
  check ((target_type = 'career' and career_id is not null) or (target_type = 'job' and job_id is not null))
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type public.notification_type not null,
  title text not null,
  body text,
  job_id uuid references public.jobs(id) on delete set null,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);
create index idx_notif_user on public.notifications(user_id, is_read, created_at desc);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'candidate-documents',
  'candidate-documents',
  false,
  15728640,
  array['application/pdf', 'image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update set public = false;

alter table public.profiles enable row level security;
alter table public.preferences enable row level security;
alter table public.documents enable row level security;
alter table public.candidate_profiles enable row level security;
alter table public.career_recommendations enable row level security;
alter table public.job_sources enable row level security;
alter table public.jobs enable row level security;
alter table public.job_matches enable row level security;
alter table public.skill_gap_reports enable row level security;
alter table public.notifications enable row level security;

create policy profiles_own_select on public.profiles for select using (auth.uid() = id);
create policy profiles_own_update on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);
create policy preferences_own on public.preferences for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy documents_own_select on public.documents for select using (auth.uid() = user_id);
create policy documents_own_insert on public.documents for insert with check (auth.uid() = user_id);
create policy documents_own_delete on public.documents for delete using (auth.uid() = user_id);
create policy candidate_profiles_own_select on public.candidate_profiles for select using (auth.uid() = user_id);
create policy careers_own_select on public.career_recommendations for select using (auth.uid() = user_id);
create policy jobs_read_open on public.jobs for select to authenticated using (status = 'open');
create policy matches_own_select on public.job_matches for select using (auth.uid() = user_id);
create policy matches_own_update on public.job_matches for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy gaps_own_select on public.skill_gap_reports for select using (auth.uid() = user_id);
create policy notifications_own_select on public.notifications for select using (auth.uid() = user_id);
create policy notifications_own_update on public.notifications for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

revoke insert, update, delete on public.documents from authenticated;
revoke update on public.profiles from authenticated;
revoke insert, update, delete on public.candidate_profiles from authenticated;
revoke insert, update, delete on public.career_recommendations from authenticated;
revoke insert, update, delete on public.job_matches from authenticated;
grant update (is_saved, is_dismissed) on public.job_matches to authenticated;
revoke insert, update, delete on public.skill_gap_reports from authenticated;
revoke insert, update, delete on public.notifications from authenticated;
grant update (is_read) on public.notifications to authenticated;
revoke all on public.job_sources from anon, authenticated;

grant usage on schema public to service_role;
grant all privileges on table
  public.profiles,
  public.preferences,
  public.documents,
  public.candidate_profiles,
  public.career_recommendations,
  public.job_sources,
  public.jobs,
  public.job_matches,
  public.skill_gap_reports,
  public.notifications
to service_role;

create policy candidate_documents_select_own on storage.objects for select to authenticated
  using (bucket_id = 'candidate-documents' and (storage.foldername(name))[1] = auth.uid()::text);
create policy candidate_documents_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'candidate-documents' and (storage.foldername(name))[1] = auth.uid()::text);
create policy candidate_documents_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'candidate-documents' and (storage.foldername(name))[1] = auth.uid()::text);

do $$
begin
  alter publication supabase_realtime add table public.notifications;
exception
  when duplicate_object then null;
  when undefined_object then null;
end;
$$;
