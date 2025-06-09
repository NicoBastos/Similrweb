# Website Similarity

A Next.js 14 application for analyzing visual similarity between websites using CLIP image embeddings stored in Supabase with pgvector.

## Architecture

- **Frontend + API**: Next.js 14 with App Router
- **Database**: Supabase Postgres with pgvector extension
- **Embeddings**: OpenAI CLIP (via open-clip-torch) for image similarity
- **Screenshots**: Playwright for automated website captures
- **Storage**: Supabase Storage for screenshot files

## Setup

### 1. Install Dependencies

```bash
# Install Node.js dependencies
npm install

# Create Python virtual environment and install CLIP dependencies
npm run setup
```

This creates a `.venv` virtual environment and installs:
- `torch` - PyTorch for deep learning
- `open-clip-torch` - Open-source CLIP implementation
- `Pillow` - Image processing

### 2. Environment Variables

Create `.env.local`:

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

### 3. Database Setup

**IMPORTANT**: CLIP embeddings are **512 dimensions**, not 1536 like OpenAI text embeddings.

#### Option A: New Database Setup
If setting up a new database, use:
```sql
-- Create table with correct CLIP embedding dimensions
CREATE TABLE landing_vectors (
  id serial PRIMARY KEY,
  url text NOT NULL,
  embedding vector(512), -- 512 for CLIP, not 1536
  screenshot_url text,
  created_at timestamp DEFAULT now()
);

-- Create index for similarity search
CREATE INDEX ON landing_vectors 
USING ivfflat (embedding vector_cosine_ops) 
WITH (lists = 100);
```

#### Option B: Migrating from OpenAI Embeddings
If you have an existing database with 1536-dimensional embeddings:
```sql
-- Update existing table to CLIP dimensions
ALTER TABLE your_table_name 
ALTER COLUMN embedding SET DATA TYPE vector(512);

-- You may need to recreate indexes
DROP INDEX IF EXISTS your_embedding_index;
CREATE INDEX ON your_table_name 
USING ivfflat (embedding vector_cosine_ops) 
WITH (lists = 100);
```

Your database should also have:
- pgvector extension enabled
- `screenshots` storage bucket
- `match_vectors` RPC function for similarity search (updated for 512 dims)
- `insert_landing_vector` RPC function for inserting embeddings (updated for 512 dims)

## Usage

### Seed Website Data

```bash
npm run seed https://example.com https://another-site.com
```

This will:
1. Take 1024x1024 screenshots of each website
2. Generate CLIP embeddings for visual similarity
3. Store both screenshot and embedding in Supabase

### Similarity Search

The embeddings enable you to:
- Find visually similar websites
- Search by website layout/design
- Compare visual branding across sites

## Technical Details

### CLIP Embeddings

- **Model**: ViT-B/32 from open-clip-torch
- **Training Data**: LAION-2B (2+ billion image-text pairs)
- **Embedding Size**: 512 dimensions (not 1536 like OpenAI text embeddings)
- **Use Case**: Visual similarity of website layouts and designs

### Why CLIP?

1. **Visual Understanding**: Trained on millions of website images
2. **No API Costs**: Runs locally with pre-trained models
3. **High Quality**: Better than text descriptions for visual similarity
4. **Fast**: Optimized inference with caching

### Performance

- ~2-3 seconds per website screenshot + embedding
- Embeddings cached by image content hash
- Batch processing with configurable concurrency

## Troubleshooting

### "expected 1536 dimensions, not 512" Error

This error means your database was set up for OpenAI text embeddings (1536 dims) but CLIP produces 512-dimensional embeddings. Update your database schema as shown in the Database Setup section above.

## Project Structure

```
├── apps/web/                 # Next.js frontend
├── packages/
│   ├── db/                   # Supabase client
│   └── embed/                # CLIP embedding logic
├── scripts/
│   └── seed.ts              # Website seeding script
├── .venv/                   # Python virtual environment
└── requirements.txt         # Python dependencies
```
