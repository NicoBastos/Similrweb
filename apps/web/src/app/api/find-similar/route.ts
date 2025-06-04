import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@website-similarity/db";
import { createHash } from "crypto";
import { cookies } from "next/headers";
import {
  getSessionFromCookie,
  createNewSession,
  shouldResetSession,
  resetSessionForNewDay,
  incrementSessionUsage,
  hasReachedLimit,
  SESSION_COOKIE_NAME
} from "@/lib/session";

interface CachedApiResult {
  data: unknown;
  timestamp: number;
  expiresAt: number;
}

// In-memory cache for API results (expires after 15 minutes)
const apiCache = new Map<string, CachedApiResult>();
const CACHE_DURATION = 15 * 60 * 1000; // 15 minutes

// Clean up expired cache entries periodically
const cleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [key, value] of apiCache.entries()) {
    if (now > value.expiresAt) {
      apiCache.delete(key);
    }
  }
}, 5 * 60 * 1000); // Clean up every 5 minutes

// Graceful cleanup on process exit
process.on('SIGINT', () => {
  clearInterval(cleanupInterval);
});
process.on('SIGTERM', () => {
  clearInterval(cleanupInterval);
});

function getCacheKey(url: string): string {
  return createHash('sha256').update(url.toLowerCase()).digest('hex');
}

function getCachedResult(cacheKey: string): unknown | null {
  const cached = apiCache.get(cacheKey);
  if (!cached) return null;
  
  if (Date.now() > cached.expiresAt) {
    apiCache.delete(cacheKey);
    return null;
  }
  
  return cached.data;
}

function setCachedResult(cacheKey: string, data: unknown): void {
  apiCache.set(cacheKey, {
    data,
    timestamp: Date.now(),
    expiresAt: Date.now() + CACHE_DURATION
  });
}

export async function POST(request: NextRequest) {
  try {
    const { url } = await request.json() as { url?: string };

    if (!url) {
      return NextResponse.json(
        { error: "URL is required" },
        { status: 400 }
      );
    }

    // Validate URL format
    try {
      new URL(url);
    } catch {
      return NextResponse.json(
        { error: "Invalid URL format" },
        { status: 400 }
      );
    }

    // Handle usage tracking for anonymous users
    // TODO: Add authenticated user handling later
    await cookies();
    
    // Get or create session
    let session = await getSessionFromCookie();
    if (!session) {
      session = createNewSession();
    }
    
    // Reset session if it's a new day
    if (shouldResetSession(session)) {
      session = resetSessionForNewDay(session);
    }
    
    // Check if user has reached limit
    if (hasReachedLimit(session)) {
      const response = NextResponse.json(
        { 
          error: "Daily limit reached", 
          message: "You've reached your daily limit of free comparisons. Sign up for unlimited access!",
          limit_info: {
            comparisons_used: session.comparisons_used,
            daily_limit: session.daily_limit,
            reset_date: session.reset_date
          }
        },
        { status: 429 }
      );
      
      // Update cookie even for rate limited requests
      response.cookies.set(SESSION_COOKIE_NAME, JSON.stringify(session), {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 30, // 30 days
        path: '/'
      });
      
      return response;
    }

    // Check server-side cache first
    const cacheKey = getCacheKey(url);
    const cachedResult = getCachedResult(cacheKey);
    
    if (cachedResult) {
      console.log('🎯 Server cache hit for:', url);
      
      // Still increment usage even for cached results
      session = incrementSessionUsage(session);
      
      const response = NextResponse.json(cachedResult, {
        headers: {
          'Cache-Control': 'public, max-age=900, s-maxage=1800', // 15 min browser, 30 min CDN
          'X-Cache': 'HIT',
          'X-Cache-Key': cacheKey.substring(0, 8) + '...'
        }
      });
      
      // Update session cookie
      response.cookies.set(SESSION_COOKIE_NAME, JSON.stringify(session), {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 30, // 30 days
        path: '/'
      });
      
      return response;
    }

    console.log('🔍 Finding similar websites for:', url);

    // Step 1: Get embedding for the provided URL
    console.log('📊 Getting embedding for URL...');
    const embedResponse = await fetch(`${request.nextUrl.origin}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });

    if (!embedResponse.ok) {
      const embedError = await embedResponse.json() as { details?: string; error?: string };
      console.error('❌ Embed endpoint failed:', embedError);
      return NextResponse.json(
        { 
          error: "Failed to generate embedding", 
          details: embedError.details || embedError.error 
        },
        { status: 500 }
      );
    }

    const embedResult = await embedResponse.json() as { embedding?: number[] };
    const queryEmbedding = embedResult.embedding;

    if (!queryEmbedding || !Array.isArray(queryEmbedding)) {
      console.error('❌ Invalid embedding received:', embedResult);
      return NextResponse.json(
        { error: "Invalid embedding generated" },
        { status: 500 }
      );
    }

    console.log(`✅ Embedding generated: ${queryEmbedding.length} dimensions`);

    // Step 2: Query Supabase for similar embeddings using match_vectors
    console.log('🔎 Searching for similar websites in database...');
    const matchCount = 10; // Return top 10 similar websites
    
    const { data: similarWebsites, error: dbError } = await supabase.rpc('match_vectors', {
      query_emb: queryEmbedding,
      match_count: matchCount
    });

    if (dbError) {
      console.error('❌ Database query failed:', dbError);
      return NextResponse.json(
        { 
          error: "Database query failed", 
          details: dbError.message 
        },
        { status: 500 }
      );
    }

    if (!similarWebsites || similarWebsites.length === 0) {
      console.log('📭 No similar websites found');
      
      // Increment usage even for empty results
      session = incrementSessionUsage(session);
      
      const emptyResult = {
        similar_websites: [],
        query_url: url,
        processed_at: new Date().toISOString(),
        message: "No similar websites found in database"
      };
      
      // Cache empty results for shorter time (5 minutes)
      apiCache.set(cacheKey, {
        data: emptyResult,
        timestamp: Date.now(),
        expiresAt: Date.now() + (5 * 60 * 1000)
      });
      
      const response = NextResponse.json(emptyResult, {
        headers: {
          'Cache-Control': 'public, max-age=300, s-maxage=600', // 5 min browser, 10 min CDN
          'X-Cache': 'MISS',
          'X-Cache-Key': cacheKey.substring(0, 8) + '...'
        }
      });
      
      // Update session cookie
      response.cookies.set(SESSION_COOKIE_NAME, JSON.stringify(session), {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 30, // 30 days
        path: '/'
      });
      
      return response;
    }

    // Step 3: Transform results to match expected format
    const transformedResults = similarWebsites.map((website: {
      url: string;
      screenshot_url: string;
      similarity: number;
      id: number;
      created_at: string;
    }) => ({
      url: website.url,
      screenshot: website.screenshot_url,
      title: new URL(website.url).hostname, // Generate title from hostname
      similarity_score: Math.round(website.similarity * 100) / 100, // Round to 2 decimal places
      id: website.id,
      created_at: website.created_at
    }));

    console.log(`✅ Found ${transformedResults.length} similar websites`);

    // Increment usage for successful request
    session = incrementSessionUsage(session);

    const result = {
      similar_websites: transformedResults,
      query_url: url,
      query_embedding_dimensions: queryEmbedding.length,
      processed_at: new Date().toISOString(),
      cache_status: 'MISS'
    };

    // Cache the successful result
    setCachedResult(cacheKey, result);

    const response = NextResponse.json(result, {
      headers: {
        'Cache-Control': 'public, max-age=900, s-maxage=1800', // 15 min browser, 30 min CDN
        'X-Cache': 'MISS',
        'X-Cache-Key': cacheKey.substring(0, 8) + '...'
      }
    });
    
    // Update session cookie with incremented usage
    response.cookies.set(SESSION_COOKIE_NAME, JSON.stringify(session), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 30, // 30 days
      path: '/'
    });

    return response;

  } catch (error) {
    console.error('❌ Find similar API error:', error);
    return NextResponse.json(
      { 
        error: "Internal server error",
        details: error instanceof Error ? error.message : "Unknown error"
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json(
    { message: "Find Similar API - Use POST method with URL parameter" },
    { status: 200 }
  );
} 