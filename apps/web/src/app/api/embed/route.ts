import { NextRequest, NextResponse } from 'next/server';
import { embedImage } from '@website-similarity/embed';
import { chromium } from 'playwright';
import type { Browser, Page } from 'playwright';

// Screenshot configuration (from seed.ts)
const VIEWPORT_WIDTH = 1980;
const VIEWPORT_HEIGHT = 1080;
const SCREENSHOT_TIMEOUT = 3000;

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

    } catch (err) {
      console.log('⚠️ Some interactive elements failed for', new URL(url).hostname, '- continuing with screenshot');
    }
    
    const buffer = await page.screenshot({ 
      clip: { x: 0, y: 0, width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT }, 
      type: 'jpeg',
      quality: 92 
    });
    
    console.log('✅ Screenshot completed for', new URL(url).hostname);
    return { success: true, buffer };
    
  } catch (err) { 
    const errorMsg = err instanceof Error ? err.message : String(err);
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

    // Generate embedding from screenshot
    console.log('🧠 Generating CLIP embedding for', new URL(url).hostname);
    const embedding = await embedImage(screenshotResult.buffer);
    console.log('✅ Embedding completed for', new URL(url).hostname, `(${embedding.length} dimensions)`);
    
    return NextResponse.json({ 
      url,
      embedding,
      dimensions: embedding.length,
      success: true 
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
    
    return NextResponse.json({
      status: isHealthy ? 'healthy' : 'unhealthy',
      service: 'CLIP embedding with screenshot',
      timestamp: new Date().toISOString()
    }, { status: isHealthy ? 200 : 503 });
  } catch (error) {
    return NextResponse.json({
      status: 'unhealthy',
      service: 'CLIP embedding with screenshot',
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    }, { status: 503 });
  }
} 