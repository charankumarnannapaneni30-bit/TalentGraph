# TalentGraph

TalentGraph is an advisory career-intelligence application for organizing candidate evidence, understanding skills, exploring career paths, and comparing a profile with live vacancies. It does not make hiring decisions.

## Requirements

- Node.js 20+
- npm 10+
- A Supabase project (Auth, PostgreSQL, and Storage)
- A Google Gemini API key to process documents and generate career analysis

## Setup

1. Install dependencies from the repository root:

   ```powershell
   npm install
   ```

2. Copy `server/.env.example` to `server/.env` and `client/.env.example` to `client/.env`. Fill in the Supabase URL and public anon key in both files. Set the Supabase service-role key, Gemini API key, and optional Resend email settings only in `server/.env`. The API loads `server/.env` on startup.
3. Run the SQL migrations in `supabase/migrations` in numeric order. If you already applied the earlier migrations, apply the newer numbered migrations only.
4. Start the Vite client with `npm run dev`. Start the API separately with `npm run dev --workspace server`.
5. Build and test with `npm run build` and `npm test`.

The client uses Supabase Auth for sign-in and obtains an access token for the API. The server verifies that token against Supabase for every protected route. Never put a service-role or Gemini key in a `VITE_` variable.

Job-match email alerts use Resend and the email on the user's Supabase Auth account. Configure `RESEND_API_KEY` and a verified `RESEND_FROM_EMAIL` in `server/.env`; without both, job alerts remain available in-app but are not emailed. The existing “Notify me about new matches” preference controls both in-app and email alerts. Email delivery covers new job matches and reopened matched jobs only.

In Supabase Auth settings, configure the local client URL (`http://localhost:5173`) and the password-reset redirect (`http://localhost:5173/reset-password`). To grant administrator access, first create and confirm the account, then run this trusted SQL in the Supabase SQL editor with its email:

```sql
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'::jsonb
where email = 'admin@example.com';
```

Sign out and back in so the JWT includes the new app-metadata role. Do not assign this role through user-editable metadata.

During development, the API accepts either `localhost` or `127.0.0.1` for the configured client host and port. In production, only `CLIENT_ORIGIN` is allowed.

## Configuration and assumptions

- The API does not include demo jobs or fabricated profile data. Job records are created only by configured Greenhouse/Lever boards or an authenticated administrator.
- Job sync is opt-in via `ENABLE_CRON`; third-party boards can have rate limits or unavailable records.
- Job-match alerts are emailed only when Resend is configured with a valid API key and verified sender. Delivery failures are logged and do not prevent the in-app notification from being saved.
- AI processing requires explicit consent and server-side Gemini configuration. AI results are advisory, grounded in provided evidence, and can be incomplete.
- Portfolio URLs are stored, not fetched. GitHub analysis only requests the public GitHub API.
- The database migration targets a fresh Supabase project. Apply it once; migrations are not designed to be re-run against a partially migrated schema.
- Public Greenhouse and Lever boards are synchronized only through their documented JSON APIs. Invalid posting records are counted and skipped; if a sync contains invalid records, it does not close stale vacancies.
- Job explanations, career recommendations, and roadmaps are generated only on request. Final job compatibility scores are always computed by the server's deterministic matcher.
- The video mock interviewer asks ten questions at the user's selected easy, medium, or hard difficulty, grounded in the saved profile's skills, projects, experience, education, and certifications. Question read-aloud uses only the browser's built-in speech synthesis; no AI-generated speech is requested. Voice answers can be recorded for up to five minutes and are sent to Gemini for transcription; TalentGraph does not persist the audio, and only the text transcript is saved. Face presence is checked locally in the browser to show a reminder if the user leaves the camera frame; video is never recorded, uploaded, or saved. Sessions are practice only, not hiring decisions, and can be removed by deleting the account.
- PDF/image documents are sent to Gemini as inline media after consent; text notes have obvious long numeric identifiers redacted before AI processing. Avoid uploading documents containing highly sensitive information.

## Environment variables

See `server/.env.example` and `client/.env.example`. The server validates configuration at startup and reports missing or malformed variables.

## Data and privacy

Uploads are stored in the private `candidate-documents` bucket. User data is scoped by ownership policies and server queries. Account deletion removes the user's Auth record, cascading user-owned records and storage objects. Export and deletion are available under Settings.

## Advisory disclaimer

AI-generated insights are advisory and based only on the information you provided. They are not hiring decisions. Verify details with the employer.
