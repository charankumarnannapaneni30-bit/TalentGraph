alter table public.recruiter_access_requests
  drop constraint if exists recruiter_access_requests_status_check;

alter table public.recruiter_access_requests
  add constraint recruiter_access_requests_status_check
  check (status in ('pending', 'approved', 'rejected', 'revoked'));
