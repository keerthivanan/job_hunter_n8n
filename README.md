# n8n Job Hunter Pipeline

Automated job application pipeline: scrapes LinkedIn via Apify → generates a tailored PDF resume → finds HR email → composes a professional email with OpenAI → sends it via Gmail → logs to PostgreSQL to prevent duplicates.

## Stack
- **n8n** (self-hosted) — workflow automation
- **Apify** — LinkedIn job scraping
- **OpenAI GPT-4o-mini** — email generation
- **Gmail** — email delivery
- **PostgreSQL (Supabase)** — deduplication database

## Setup

### 1. Database (Supabase)
1. Create a new Supabase project
2. Open the SQL Editor and run `sql/init.sql`
3. Copy your connection string: `Settings → Database → Connection string (URI mode)`

### 2. n8n Credentials
Add these credentials in your n8n instance (`Settings → Credentials`):

| Name | Type | Details |
|------|------|---------|
| `Apify` | Apify API | Your Apify token |
| `OpenAI` | OpenAI API | Your OpenAI API key |
| `Gmail` | Gmail OAuth2 | Your Gmail account |
| `PostgreSQL` | PostgreSQL | Your Supabase connection string |

### 3. Deploy Script
```bash
cp .env.example .env
# Fill in your values in .env
node deploy.js
```

### 4. .env file
```
N8N_HOST=n8n.yourhost.com
N8N_API_KEY=your_n8n_api_key
N8N_WORKFLOW_ID=your_workflow_id
CV_PDF_PATH=./your_resume.pdf
```

## How It Works
1. **Get Last Apify Run** — fetches latest LinkedIn job scrape results
2. **Normalize All Jobs** — standardizes job data fields
3. **Load Seen Job IDs** — queries PostgreSQL for already-applied jobs
4. **Filter New Jobs** — removes duplicates, returns up to 3 new jobs
5. **One Job At A Time** — processes each job sequentially
6. **Generate Resume** — attaches your CV PDF (embedded at deploy time)
7. **Find HR Email** — extracts or guesses HR contact email
8. **Compose Email** — GPT-4o-mini writes a tailored 120-word application
9. **Send Email via Gmail** — sends with PDF resume attached
10. **Log Applied Job** — inserts job_id into PostgreSQL (prevents future duplicates)

## Files
```
APPLY_NOSCORE_FINAL.json  — n8n workflow (no hardcoded secrets)
deploy.js                 — deploy & run script (reads from .env)
sql/init.sql              — PostgreSQL table schema
latex_resume_template.tex — ATS resume LaTeX template
.env.example              — environment variable template
```

## Author
Keerthivanan S — Gen AI Architect
[LinkedIn](https://linkedin.com/in/keerthi-vanan-s) | [GitHub](https://github.com/keerthivanan-s) | [Portfolio](https://cargolink.sa)
