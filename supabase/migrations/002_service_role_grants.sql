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
