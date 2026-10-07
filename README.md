# DrMan

DrMan is a Persian digital-health ecosystem focused on an understandable lab-analysis entry point, a longitudinal personal/family health record, personalized care guidance, reminders, reviewed health education, doctor discovery and consent-based clinical workflows.

## Runtime architecture
- Static RTL product pages on Vercel
- One Hobby-compatible Vercel serverless entrypoint: `api/router.js`
- Internal handlers in `server/api`
- Supabase PostgreSQL + private Storage
- Signed HttpOnly sessions and server-side authorization
- AvalAI/OpenAI-compatible AI providers
- DigiPay checkout with server verification and database-atomic plan activation

## Main surfaces
- `/` refined lab-analysis landing experience
- `/health` longitudinal health record, trends and care plan
- `/doctors` verified doctor discovery
- `/doctor/:slug` public doctor profile, real availability and verified reviews
- `/doctor-portal` clinician workspace
- `/pricing` subscriptions
- `/learn` reviewed health knowledge hub
- `/account` personal data export and deletion requests
- `/admin` ecosystem management and moderation

## Security rules
Paid plans are activated only by the database finalization function after a verified DigiPay response, or by an explicit audited admin grant. Browser-side state never authorizes plan access. Medical tables are not directly writable from the browser.

## Deployment
Only the Vercel project `drman` should be linked to this repository. Preview deployments are created deliberately at milestones to conserve Hobby build quota. See `.env.example` for external credentials that must be supplied by the corresponding providers.
