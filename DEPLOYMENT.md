# Vercel Monorepo Deployment Guide

This project is configured as a TypeScript monorepo with proper workspace support for Vercel deployment.

## Project Structure

```
website-similarity/
├── apps/
│   └── web/                    # Next.js 14 app
├── packages/
│   ├── db/                     # Database utilities
│   └── embed/                  # Embedding utilities
├── scripts/                    # CLI scripts
└── package.json               # Root workspace config
```

## Monorepo Configuration

### Workspace Setup
- **Package Manager**: npm with workspaces
- **TypeScript**: Strict mode with project references
- **Framework**: Next.js 14 with App Router

### Key Configuration Files

#### Root `package.json`
```json
{
  "workspaces": ["apps/*", "packages/*"],
  "packageManager": "npm@10.0.0"
}
```

#### Package Exports
Each package in `packages/` has proper exports defined:
```json
{
  "exports": {
    ".": { "types": "./index.ts", "import": "./index.ts" },
    "./client": { "types": "./client.ts", "import": "./client.ts" }
  }
}
```

#### TypeScript Configuration
- Root `tsconfig.json` with shared compiler options
- Package-specific configs with `composite: true`
- Web app config with proper path mapping

## Vercel Deployment

### Prerequisites
1. Vercel account with team access
2. GitHub repository connected to Vercel
3. Environment variables configured

### Deployment Steps

#### Option 1: Vercel Dashboard
1. Go to Vercel Dashboard → Add New Project
2. Import your Git repository
3. **Important**: Set Root Directory to `apps/web`
4. Configure environment variables
5. Deploy

#### Option 2: Vercel CLI
```bash
# From monorepo root
cd apps/web
vercel --prod
```

### Vercel Configuration

The web app includes a `vercel.json` with:
```json
{
  "functions": {
    "src/app/api/*/route.ts": {
      "maxDuration": 30
    }
  },
  "buildCommand": "npm run build",
  "outputDirectory": ".next",
  "installCommand": "npm install",
  "framework": "nextjs"
}
```

## Build Process

### Local Development
```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build
```

### Vercel Build Process
1. Vercel detects the monorepo structure
2. Installs dependencies from root `package.json`
3. Resolves workspace packages via symlinks
4. Builds the Next.js app with proper imports

## Package Import Resolution

### In the Web App
```typescript
// Import from workspace packages
import { supabaseClient } from '@website-similarity/db/client-only';
import { generateEmbedding } from '@website-similarity/embed';

// Import from local files
import { utils } from '@/lib/utils';
```

### TypeScript Path Mapping
```json
{
  "paths": {
    "@/*": ["./src/*"],
    "@website-similarity/db": ["../../packages/db"],
    "@website-similarity/embed": ["../../packages/embed"]
  }
}
```

## Environment Variables

Required environment variables for deployment:
- `DATABASE_URL`: Supabase database connection
- `NEXT_PUBLIC_SUPABASE_URL`: Public Supabase URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Public Supabase anon key
- `SUPABASE_SERVICE_ROLE_KEY`: Service role key for server operations
- `OPENAI_API_KEY`: OpenAI API key for embeddings

## Troubleshooting

### Common Issues

1. **Module not found errors**
   - Ensure package exports are properly defined
   - Check TypeScript path mapping
   - Verify workspace dependencies use `file:` protocol

2. **Build failures on Vercel**
   - Confirm Root Directory is set to `apps/web`
   - Check that all workspace packages have proper exports
   - Verify environment variables are configured

3. **Import resolution issues**
   - Use `@/` prefix for local imports within the web app
   - Use full package names for workspace imports
   - Ensure TypeScript project references are correct

### Verification Commands

```bash
# Test local build
npm run build

# Check workspace structure
npm ls --workspaces

# Verify TypeScript compilation
npx tsc --noEmit
```

## Performance Optimizations

- **Turborepo**: Consider adding for better caching
- **Bundle Analysis**: Use `@next/bundle-analyzer`
- **Image Optimization**: Configured for Supabase storage
- **Edge Functions**: API routes optimized for Edge Runtime

## Security Considerations

- Environment variables properly scoped
- Service role key only used server-side
- CORS configured for Supabase
- Deployment protection enabled on Vercel

## Next Steps

1. **Add Turborepo** for improved build caching
2. **Implement E2E tests** with Playwright
3. **Add monitoring** with Vercel Analytics
4. **Set up staging environment** with preview deployments 