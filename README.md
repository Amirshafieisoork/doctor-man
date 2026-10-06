# DrMan

DrMan is a Persian health ecosystem that combines a longitudinal medical record, AI-assisted lab interpretation, family profiles, doctor discovery, appointments, consent-based record sharing, care follow-up, subscriptions, DigiPay checkout, medical content/SEO, and a secure admin console.

## Current architecture
- Static RTL frontend pages served by Vercel
- Vercel serverless APIs in `/api`
- Supabase PostgreSQL + private Storage
- Signed HttpOnly user/admin sessions
- AvalAI/OpenAI-compatible AI endpoints
- DigiPay server-side checkout + verification flow

## Main product surfaces
- `/` home and lab analysis
- `/health` longitudinal medical record and family profiles
- `/doctors` doctor directory
- `/doctor/:slug` public SEO doctor profile
- `/doctor-portal` doctor workspace
- `/pricing` subscriptions and checkout
- `/learn` reviewed medical content
- `/admin` ecosystem management console

## Admin console
The admin console manages users, doctors, appointments, plans/quotas, payments, organizations, care operations, content/SEO, support messages, audit logs, product settings and integration health.

Secrets are never displayed or edited from the browser. Provider credentials remain server-side environment variables.

## Required environment variables
See `.env.example`. DigiPay requires merchant credentials before live payments can be enabled.

## Deployment
The production Vercel project should be the single `drman` project linked to this repository. Duplicate Vercel projects should be removed to avoid consuming build quota multiple times per commit.
