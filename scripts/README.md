# Scripts

## seed.ts

Seeds the database with website screenshots and embeddings.

### Usage

```bash
npm run seed <url1> [url2] [url3] ...
```

Or directly with ts-node:

```bash
ts-node scripts/seed.ts https://example.com https://google.com
```

### Requirements

The following environment variables must be set:

- `SUPABASE_URL` - Your Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` - Your Supabase service role key
- `OPENAI_API_KEY` - Your OpenAI API key

### What it does

1. Takes a list of URLs as command line arguments
2. Uses Playwright to screenshot each website (1024x1024 JPEG)
3. Uploads screenshots to Supabase storage bucket `screenshots`
4. Generates embeddings for each screenshot using OpenAI
5. Stores the URL, embedding, and screenshot URL in the database via `insert_landing_vector` RPC

### Database Requirements

The script expects a Supabase RPC function called `insert_landing_vector` with parameters:
- `p_url` (text) - The website URL
- `p_emb` (vector) - The embedding vector
- `p_shot` (text) - The screenshot public URL 