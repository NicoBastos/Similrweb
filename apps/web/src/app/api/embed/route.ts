import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { supabase } from '@website-similarity/db';

// Modal endpoint configuration
const MODAL_SCREENSHOT_ENDPOINT = 'https://nicobastos--website-embed-service-web-generate-screensho-5f0b0c.modal.run';
const MODAL_DOM_ENDPOINT = 'https://nicobastos--website-embed-service-web-embed-dom.modal.run';
const MODAL_TIMEOUT = 45000; // 45 seconds - increased for dual embedding reliability

interface CachedEmbedResult {
  data: {
    url: string;
    screenshot_embedding: number[];
    screenshot_dimensions: number;
    dom_embedding: number[];
    dom_dimensions: number;
    success: boolean;
    screenshot_url?: string;
  };
  timestamp: number;
  expiresAt: number;
}

type EmbedResultData = CachedEmbedResult['data'];

// In-memory cache for embed results (expires after 60 minutes since these are expensive)
const embedCache = new Map<string, CachedEmbedResult>();
const EMBED_CACHE_DURATION = 4 * 60 * 60 * 1000; // 4 hours - embeddings are expensive and rarely change

// Clean up expired embed cache entries periodically with size limit
const MAX_CACHE_SIZE = 1000; // Limit cache to 1000 entries
const embedCleanupInterval = setInterval(() => {
  const now = Date.now();
  let deletedCount = 0;
  
  // First: Remove expired entries
  for (const [key, value] of embedCache.entries()) {
    if (now > value.expiresAt) {
      embedCache.delete(key);
      deletedCount++;
    }
  }
  
  // Second: If still over limit, remove oldest entries
  if (embedCache.size > MAX_CACHE_SIZE) {
    const entries = Array.from(embedCache.entries())
      .sort(([,a], [,b]) => a.timestamp - b.timestamp);
    
    const toDelete = embedCache.size - MAX_CACHE_SIZE;
    for (let i = 0; i < toDelete; i++) {
      embedCache.delete(entries[i][0]);
      deletedCount++;
    }
  }
  
  if (deletedCount > 0) {
    console.log(`🧹 Cleaned up ${deletedCount} cache entries, size: ${embedCache.size}`);
  }
}, 5 * 60 * 1000); // Clean up every 5 minutes (more frequent)

// Graceful cleanup on process exit
process.on('SIGINT', () => {
  clearInterval(embedCleanupInterval);
});
process.on('SIGTERM', () => {
  clearInterval(embedCleanupInterval);
});

function getEmbedCacheKey(url: string): string {
  return createHash('sha256').update(url.toLowerCase().trim()).digest('hex');
}

function getCachedEmbedResult(cacheKey: string): EmbedResultData | null {
  const cached = embedCache.get(cacheKey);
  if (!cached) return null;
  
  if (Date.now() > cached.expiresAt) {
    embedCache.delete(cacheKey);
    return null;
  }
  
  return cached.data;
}

function setCachedEmbedResult(cacheKey: string, data: EmbedResultData): void {
  embedCache.set(cacheKey, {
    data,
    timestamp: Date.now(),
    expiresAt: Date.now() + EMBED_CACHE_DURATION
  });
}

async function generateScreenshotAndEmbedding(url: string): Promise<{
  success: boolean;
  embedding?: number[];
  dimensions?: number;
  screenshot?: string; // base64 encoded
  error?: string;
}> {
  try {
    console.log('🚀 Calling screenshot Modal endpoint for', new URL(url).hostname);
    
    const response = await fetch(MODAL_SCREENSHOT_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(MODAL_TIMEOUT),
    });

    if (!response.ok) {
      throw new Error(`Screenshot Modal endpoint responded with ${response.status}: ${response.statusText}`);
    }

    const result = await response.json();
    
    if (!result.success) {
      throw new Error(result.error || 'Screenshot Modal endpoint returned success: false');
    }

    console.log('✅ Screenshot Modal endpoint completed for', new URL(url).hostname, `(${result.dimensions} dimensions)`);
    
    return {
      success: true,
      embedding: result.embedding,
      dimensions: result.dimensions,
      screenshot: result.screenshot, // base64 encoded
    };
    
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('❌ Screenshot Modal endpoint failed for', url, ':', errorMsg);
    return {
      success: false,
      error: errorMsg,
    };
  }
}

async function generateDOMEmbedding(url: string): Promise<{
  success: boolean;
  embedding?: number[];
  dimensions?: number;
  error?: string;
}> {
  try {
    console.log('🚀 Calling DOM Modal endpoint for', new URL(url).hostname);
    
    const response = await fetch(MODAL_DOM_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(MODAL_TIMEOUT),
    });

    if (!response.ok) {
      throw new Error(`DOM Modal endpoint responded with ${response.status}: ${response.statusText}`);
    }

    const result = await response.json();
    
    if (!result.success) {
      throw new Error(result.error || 'DOM Modal endpoint returned success: false');
    }

    console.log('✅ DOM Modal endpoint completed for', new URL(url).hostname, `(${result.dimensions} dimensions)`);
    
    return {
      success: true,
      embedding: result.embedding,
      dimensions: result.dimensions,
    };
    
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('❌ DOM Modal endpoint failed for', url, ':', errorMsg);
    return {
      success: false,
      error: errorMsg,
    };
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { url } = body;
    
    if (!url) {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    }

    // Validate URL format
    try {
      new URL(url);
    } catch {
      return NextResponse.json({ error: 'Invalid URL format' }, { status: 400 });
    }

    // Check embed cache first
    const cacheKey = getEmbedCacheKey(url);
    const cachedResult = getCachedEmbedResult(cacheKey);
    
    if (cachedResult) {
      console.log('🎯 Embed cache hit for:', url);
      return NextResponse.json(cachedResult, {
        headers: {
          'Cache-Control': 'public, max-age=3600, s-maxage=7200', // 1 hour browser, 2 hours CDN
          'X-Cache': 'HIT',
          'X-Cache-Key': cacheKey.substring(0, 8) + '...'
        }
      });
    }

    console.log('🚀 Starting embed process for', url);
    
    // Generate both screenshot and DOM embeddings in parallel
    const [screenshotResult, domResult] = await Promise.all([
      generateScreenshotAndEmbedding(url),
      generateDOMEmbedding(url)
    ]);
    
    // Check if both embeddings were successful
    if (!screenshotResult.success || !screenshotResult.embedding || !screenshotResult.screenshot || !screenshotResult.dimensions) {
      return NextResponse.json({ 
        error: 'Screenshot embedding generation failed',
        details: screenshotResult.error,
        success: false 
      }, { status: 500 });
    }

    if (!domResult.success || !domResult.embedding || !domResult.dimensions) {
      return NextResponse.json({ 
        error: 'DOM embedding generation failed',
        details: domResult.error,
        success: false 
      }, { status: 500 });
    }

    // Performance optimization: Upload screenshot in background, don't block response
    const screenshotBuffer = Buffer.from(screenshotResult.screenshot, 'base64');
    const hostHash = createHash('sha256').update(new URL(url).hostname).digest('hex').substring(0, 8);
    const fileName = `screens/${Date.now()}-${hostHash}.jpg`;
    
    // Start upload in background - don't await
    void supabase
      .storage
      .from('screenshots')
      .upload(fileName, screenshotBuffer, { 
        contentType: 'image/jpeg', 
        upsert: true,
        cacheControl: '3600'
      })
      .then(({ error }) => {
        if (error) {
          console.warn('⚠️ Background screenshot upload failed:', error);
        } else {
          console.log('✅ Background screenshot upload completed for', new URL(url).hostname);
        }
      })
      .catch(err => console.warn('⚠️ Screenshot upload error:', err));

    // Get public URL immediately (optimistic)
    const { data: { publicUrl } } = supabase
      .storage
      .from('screenshots')
      .getPublicUrl(fileName);
    
    const screenshotUrl = publicUrl;
    
    const result = { 
      url,
      screenshot_embedding: screenshotResult.embedding,
      screenshot_dimensions: screenshotResult.dimensions,
      dom_embedding: domResult.embedding,
      dom_dimensions: domResult.dimensions,
      success: true,
      screenshot_url: screenshotUrl || undefined
    };

    // Cache the successful result
    setCachedEmbedResult(cacheKey, result);
    
    return NextResponse.json(result, {
      headers: {
        'Cache-Control': 'public, max-age=7200, s-maxage=14400', // 2 hour browser, 4 hours CDN - longer cache for expensive operations
        'X-Cache': 'MISS',
        'X-Cache-Key': cacheKey.substring(0, 8) + '...',
        'X-Cache-Size': embedCache.size.toString(),
        'Vary': 'Accept-Encoding', // Enable compression
        'X-Response-Time': Date.now().toString() // For debugging performance
      }
    });
    
  } catch (error) {
    console.error('Embed process failed:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    return NextResponse.json({ 
      error: 'Embed process failed',
      details: errorMessage,
      success: false 
    }, { status: 500 });
  }
}

export async function GET() {
  try {
    // Health check both Modal endpoints
    const [screenshotHealthResponse, domHealthResponse] = await Promise.all([
      fetch(`${MODAL_SCREENSHOT_ENDPOINT}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000), // 5 second timeout for health check
      }).catch(() => ({ ok: false, status: 0 })),
      fetch(`${MODAL_DOM_ENDPOINT}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000), // 5 second timeout for health check
      }).catch(() => ({ ok: false, status: 0 }))
    ]);
    
    const isScreenshotHealthy = screenshotHealthResponse.ok;
    const isDOMHealthy = domHealthResponse.ok;
    const isHealthy = isScreenshotHealthy && isDOMHealthy;
    
    const healthData = {
      status: isHealthy ? 'healthy' : 'unhealthy',
      service: 'Screenshot and DOM embeddings via Modal',
      screenshot_endpoint: {
        url: MODAL_SCREENSHOT_ENDPOINT,
        status: screenshotHealthResponse.status,
        healthy: isScreenshotHealthy
      },
      dom_endpoint: {
        url: MODAL_DOM_ENDPOINT,
        status: domHealthResponse.status,
        healthy: isDOMHealthy
      },
      embed_cache_size: embedCache.size,
      embed_cache_entries: Array.from(embedCache.keys()).map(key => ({
        key: key.substring(0, 8) + '...',
        expires_in_ms: Math.max(0, (embedCache.get(key)?.expiresAt || 0) - Date.now())
      })),
      timestamp: new Date().toISOString()
    };
    
    return NextResponse.json(healthData, { 
      status: isHealthy ? 200 : 503,
      headers: {
        'Cache-Control': 'no-cache'
      }
    });
  } catch (error) {
    return NextResponse.json({
      status: 'unhealthy',
      service: 'Screenshot and DOM embeddings via Modal',
      screenshot_endpoint: MODAL_SCREENSHOT_ENDPOINT,
      dom_endpoint: MODAL_DOM_ENDPOINT,
      error: error instanceof Error ? error.message : 'Unknown error',
      embed_cache_size: embedCache.size,
      timestamp: new Date().toISOString()
    }, { 
      status: 503,
      headers: {
        'Cache-Control': 'no-cache'
      }
    });
  }
} 