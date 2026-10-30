create table public.mock_interviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  target_role text not null check (length(target_role) between 2 and 120),
  interview_type text not null check (interview_type in ('general', 'behavioral', 'technical')),
  difficulty_level text not null default 'medium' check (difficulty_level in ('easy', 'medium', 'hard')),
  status text not null default 'in_progress' check (status in ('in_progress', 'completed', 'failed')),
  question_limit smallint not null default 10 check (question_limit between 3 and 10),
  questions_asked smallint not null default 0 check (questions_asked between 0 and question_limit),
  transcript jsonb not null default '[]'::jsonb,
  final_feedback jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_mock_interviews_user on public.mock_interviews(user_id, created_at desc);
create trigger trg_mock_interviews_updated before update on public.mock_interviews
for each row execute function public.set_updated_at();

alter table public.mock_interviews enable row level security;
create policy mock_interviews_own_select on public.mock_interviews
  for select using (auth.uid() = user_id);
revoke all on public.mock_interviews from anon, authenticated;
grant usage on schema public to service_role;
grant all privileges on table public.mock_interviews to service_role;
