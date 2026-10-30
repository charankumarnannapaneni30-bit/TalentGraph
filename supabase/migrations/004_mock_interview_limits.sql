alter table public.mock_interviews
  alter column question_limit set default 10;

update public.mock_interviews
set question_limit = 10
where status = 'in_progress'
  and question_limit < 10;
