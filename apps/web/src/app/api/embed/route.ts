import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { supabase } from '@website-similarity/db';

// Modal endpoint configuration
const MODAL_ENDPOINT = 'https://nicobastos--website-embed-service-web-generate-screensho-5f0b0c.modal.run';
const MODAL_TIMEOUT = 30000; // 30 seconds

interface CachedEmbedResult {
  data: {
    url: string;
    embedding: number[];
    dimensions: number;
    success: boolean;
    screenshot_url?: string;
  };
  timestamp: number;
  expiresAt: number;
}

type EmbedResultData = CachedEmbedResult['data'];

// In-memory cache for embed results (expires after 60 minutes since these are expensive)
const embedCache = new Map<string, CachedEmbedResult>();
const EMBED_CACHE_DURATION = 60 * 60 * 1000; // 60 minutes

// Clean up expired embed cache entries periodically
const embedCleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [key, value] of embedCache.entries()) {
    if (now > value.expiresAt) {
      embedCache.delete(key);
    }
  }
}, 10 * 60 * 1000); // Clean up every 10 minutes

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
    console.log('🚀 Calling Modal endpoint for', new URL(url).hostname);
    
    const response = await fetch(MODAL_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(MODAL_TIMEOUT),
    });

    if (!response.ok) {
      throw new Error(`Modal endpoint responded with ${response.status}: ${response.statusText}`);
    }

    const result = await response.json();
    
    if (!result.success) {
      throw new Error(result.error || 'Modal endpoint returned success: false');
    }

    console.log('✅ Modal endpoint completed for', new URL(url).hostname, `(${result.dimensions} dimensions)`);
    
    return {
      success: true,
      embedding: result.embedding,
      dimensions: result.dimensions,
      screenshot: result.screenshot, // base64 encoded
    };
    
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('❌ Modal endpoint failed for', url, ':', errorMsg);
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
    
    // Generate screenshot and embedding via Modal endpoint
    const modalResult = await generateScreenshotAndEmbedding(url);
    
    if (!modalResult.success || !modalResult.embedding || !modalResult.screenshot || !modalResult.dimensions) {
      return NextResponse.json({ 
        error: 'Screenshot and embedding generation failed',
        details: modalResult.error,
        success: false 
      }, { status: 500 });
    }

    // Upload screenshot to storage
    console.log('☁️ Uploading screenshot to storage for', new URL(url).hostname);
    const screenshotBuffer = Buffer.from(modalResult.screenshot, 'base64');
    const fileName = `screens/${Date.now()}-${new URL(url).hostname}.jpg`;
    const { error: uploadError } = await supabase
      .storage
      .from('screenshots')
      .upload(fileName, screenshotBuffer, { 
        contentType: 'image/jpeg', 
        upsert: true 
      });

    let screenshotUrl = null;
    if (uploadError) {
      console.warn('⚠️ Failed to upload screenshot:', uploadError);
    } else {
      const { data: { publicUrl } } = supabase
        .storage
        .from('screenshots')
        .getPublicUrl(fileName);
      screenshotUrl = publicUrl;
      console.log('✅ Screenshot uploaded to storage');
    }
    
    const result = { 
      url,
      embedding: modalResult.embedding,
      dimensions: modalResult.dimensions,
      success: true,
      screenshot_url: screenshotUrl || undefined
    };

    // Cache the successful result
    setCachedEmbedResult(cacheKey, result);
    
    return NextResponse.json(result, {
      headers: {
        'Cache-Control': 'public, max-age=3600, s-maxage=7200', // 1 hour browser, 2 hours CDN
        'X-Cache': 'MISS',
        'X-Cache-Key': cacheKey.substring(0, 8) + '...',
        'X-Cache-Size': embedCache.size.toString()
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
    // Health check the Modal endpoint
    const healthResponse = await fetch(`${MODAL_ENDPOINT}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000), // 5 second timeout for health check
    });
    
    const isHealthy = healthResponse.ok;
    
    const healthData = {
      status: isHealthy ? 'healthy' : 'unhealthy',
      service: 'CLIP embedding with screenshot via Modal',
      modal_endpoint: MODAL_ENDPOINT,
      modal_status: healthResponse.status,
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
      service: 'CLIP embedding with screenshot via Modal',
      modal_endpoint: MODAL_ENDPOINT,
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