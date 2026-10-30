alter table public.mock_interviews
  add column difficulty_level text not null default 'medium'
  check (difficulty_level in ('easy', 'medium', 'hard'));
