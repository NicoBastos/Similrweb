# Website Similarity

A Next.js 14 application for analyzing visual similarity between websites using CLIP image embeddings stored in Supabase with pgvector.

## Architecture

- **Frontend + API**: Next.js 14 with App Router
- **Database**: Supabase Postgres with pgvector extension
- **Embeddings**: OpenAI CLIP (via open-clip-torch) for image similarity
- **Screenshots**: Playwright for automated website captures
- **Storage**: Supabase Storage for screenshot files

## Getting Started

### Prerequisites

- Node.js (v18 or later)
- npm (v9 or later)
- Python (v3.9 or later)

### Installation

1.  **Clone the repository:**

    ```bash
    git clone https://github.com/your-username/your-repo-name.git
    cd your-repo-name
    ```

2.  **Install dependencies and set up the environment:**

    This single command installs all npm packages and sets up the Python virtual environment.

    ```bash
    npm install && npm run setup
    ```

3.  **Set up environment variables:**

    Create a `.env` file in the root of the project and add the necessary environment variables.

4.  **Run the application:**

    ```bash
    npm run dev
    ```

    The application will be available at `http://localhost:3000`.

## Scripts

- `npm run dev`: Starts the development server.
- `npm run build`: Builds the application for production.
- `npm run start`: Starts the production server.
- `npm run lint`: Lints the code.
- `npm run setup`: Sets up the Python virtual environment.
- `npm run seed`: Seeds the database with initial data.
- `npm run scrape`: Scrapes websites for screenshots.
- `npm run clear-screenshots`: Clears all screenshots from the storage bucket.
- `npm run test-db`: Tests the database connection.

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
