import { NextRequest, NextResponse } from 'next/server';
import { embedImage } from '@website-similarity/embed';
import { chromium } from 'playwright';
import type { Browser, Page } from 'playwright';
import { createHash } from 'node:crypto';
import { supabase } from '@website-similarity/db';

// Screenshot configuration (from seed.ts)
const VIEWPORT_WIDTH = 1980;
const VIEWPORT_HEIGHT = 1080;
const SCREENSHOT_TIMEOUT = 3000;

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

async function takeScreenshot(browser: Browser, url: string): Promise<{ success: boolean; buffer?: Buffer; error?: string }> {
  let page: Page | null = null;
  
  try {
    console.log('📷 Taking screenshot of', url);
    page = await browser.newPage({ 
      viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT } 
    });
    
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: SCREENSHOT_TIMEOUT });
    
    // Simulate real user behavior to reveal more content (from seed.ts)
    try {
      // 1. Dismiss common popups/overlays
      const commonDismissSelectors = [
        '[aria-label*="close"]',
        '[aria-label*="dismiss"]', 
        '.cookie-banner button',
        '.modal-close',
        '.popup-close',
        '[data-testid*="close"]',
        '.close-button',
        'button[aria-label="Close"]'
      ];
      
      for (const selector of commonDismissSelectors) {
        try {
          const element = await page.$(selector);
          if (element) {
            await element.click();
            await page.waitForTimeout(200);
            break; // Only dismiss one popup
          }
        } catch {
          // Ignore errors, continue to next selector
        }
      }

      // 2. Scroll to trigger lazy loading and scroll animations
      console.log('🔄 Scrolling to reveal lazy-loaded content for', new URL(url).hostname);
      await page.evaluate(() => {
        // Instant scroll to bottom to trigger lazy loading
        window.scrollTo({ top: document.body.scrollHeight, behavior: 'auto' });
      });
      await page.waitForTimeout(500);
      
      // Scroll back to top for the screenshot
      await page.evaluate(() => {
        window.scrollTo({ top: 0, behavior: 'auto' });
      });
      await page.waitForTimeout(200);

      // 3. Wait for fonts and delayed animations
      console.log('⏳ Waiting for fonts and animations to complete for', new URL(url).hostname);
      await page.waitForTimeout(300);
      
      // 4. Trigger any auto-playing elements that might need interaction
      await page.evaluate(() => {
        // Find and trigger any paused videos or carousels
        const videos = document.querySelectorAll('video');
        videos.forEach(video => {
          if (video.paused) {
            video.play().catch(() => {}); // Ignore errors
          }
        });
        
        // Trigger any carousel advancement
        const carouselNext = document.querySelector('[aria-label*="next"], .carousel-next, .slider-next');
        if (carouselNext instanceof HTMLElement) {
          carouselNext.click();
        }
      });
      await page.waitForTimeout(200);

    } catch {
      console.log('⚠️ Some interactive elements failed for', new URL(url).hostname, '- continuing with screenshot');
    }
    
    const buffer = await page.screenshot({ 
      clip: { x: 0, y: 0, width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT }, 
      type: 'jpeg',
      quality: 92 
    });
    
    console.log('✅ Screenshot completed for', new URL(url).hostname);
    return { success: true, buffer };
    
  } catch (error) { 
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('❌ Screenshot failed for', url, ':', errorMsg);
    return { success: false, error: errorMsg };
  } finally {
    if (page) {
      await page.close().catch(() => {}); // Ignore close errors
    }
  }
}

export async function POST(request: NextRequest) {
  let browser: Browser | null = null;
  
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
    
    // Launch browser
    browser = await chromium.launch();
    
    // Take screenshot
    const screenshotResult = await takeScreenshot(browser, url);
    
    if (!screenshotResult.success || !screenshotResult.buffer) {
      return NextResponse.json({ 
        error: 'Screenshot failed',
        details: screenshotResult.error,
        success: false 
      }, { status: 500 });
    }

    // Upload screenshot to storage
    console.log('☁️ Uploading screenshot to storage for', new URL(url).hostname);
    const fileName = `screens/${Date.now()}-${new URL(url).hostname}.jpg`;
    const { data: uploadData, error: uploadError } = await supabase
      .storage
      .from('screenshots')
      .upload(fileName, screenshotResult.buffer, { 
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

    // Generate embedding from screenshot
    console.log('🧠 Generating CLIP embedding for', new URL(url).hostname);
    const embedding = await embedImage(screenshotResult.buffer);
    console.log('✅ Embedding completed for', new URL(url).hostname, `(${embedding.length} dimensions)`);
    
    const result = { 
      url,
      embedding,
      dimensions: embedding.length,
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
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

export async function GET() {
  try {
    const { checkHealth } = await import('@website-similarity/embed');
    const isHealthy = await checkHealth();
    
    const healthData = {
      status: isHealthy ? 'healthy' : 'unhealthy',
      service: 'CLIP embedding with screenshot',
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
      service: 'CLIP embedding with screenshot',
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