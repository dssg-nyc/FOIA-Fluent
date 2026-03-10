# FOIA Fluent — Frontend

Next.js 14 (React 18, TypeScript) with plain CSS and NYC-DSSG blue/orange color theme.

## Setup

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Environment Variables

Create `.env.local`:

```
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

## Pages

| Route | Description |
|-------|-------------|
| `/` | Search & draft wizard — discovery, agency identification, FOIA letter generation |
| `/login` | Magic link email authentication |
| `/auth/callback` | Supabase auth redirect handler |
| `/dashboard` | My Requests — tracked FOIA requests with status filtering |
| `/import` | Import existing FOIA request with agency dropdown and file upload |
| `/requests/[id]` | Request detail — timeline, response analysis, letter generation |

## Color Theme

NYC-DSSG blue/orange palette defined in `src/app/globals.css` CSS variables:
- **Primary** (navy blue `#1B4F72`): buttons, links, active states
- **Accent** (warm orange `#E67E22`): search CTA, tags, progress indicators
- **Semantic colors**: green (success), red (denied), amber (pending), purple (appeals)
