#!/usr/bin/env ts-node
/* scripts/seed.ts */
import 'dotenv/config';
import { chromium } from 'playwright';
import type { Browser, Page } from 'playwright';
import { supabase } from '../packages/db/index.ts';
import { embedImage } from '../packages/embed/index.ts';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Configuration
const SCREENSHOT_CONCURRENT_LIMIT = 5; // Number of concurrent screenshot operations
const EMBEDDING_CONCURRENT_LIMIT = 3; // Number of concurrent embedding operations
const DATABASE_CONCURRENT_LIMIT = 10; // Number of concurrent database operations
const VIEWPORT_WIDTH = 1980;
const VIEWPORT_HEIGHT = 1080;
const SCREENSHOT_TIMEOUT = 40000;

interface ScreenshotResult {
  url: string;
  success: boolean;
  error?: string;
  buffer?: Buffer;
  publicUrl?: string;
}

interface EmbeddingResult {
  url: string;
  success: boolean;
  error?: string;
  embedding?: number[];
  publicUrl?: string;
}

interface ProcessResult {
  url: string;
  success: boolean;
  error?: string;
}

async function takeScreenshot(browser: Browser, url: string): Promise<ScreenshotResult> {
  let page: Page | null = null;
  
  try {
    console.log('📷 Taking screenshot of', url);
    page = await browser.newPage({ 
      viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT } 
    });
    
    await page.goto(url, { waitUntil: 'networkidle', timeout: SCREENSHOT_TIMEOUT });
    
    // Simulate real user behavior to reveal more content
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
            await page.waitForTimeout(500); // Wait for animation
            break; // Only dismiss one popup
          }
        } catch {
          // Ignore errors, continue to next selector
        }
      }

      // 2. Scroll to trigger lazy loading and scroll animations
      console.log('🔄 Scrolling to reveal lazy-loaded content for', new URL(url).hostname);
      await page.evaluate(() => {
        // Smooth scroll to bottom to trigger lazy loading
        window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
      });
      await page.waitForTimeout(2000); // Wait for content to load
      
      // Scroll back to top for the screenshot
      await page.evaluate(() => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
      await page.waitForTimeout(1000);

      // 3. Wait for fonts and delayed animations
      console.log('⏳ Waiting for fonts and animations to complete for', new URL(url).hostname);
      await page.waitForLoadState('networkidle');
      
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
      await page.waitForTimeout(1000);

    } catch (err) {
      console.log('⚠️ Some interactive elements failed for', new URL(url).hostname, '- continuing with screenshot');
    }
    
    const buf = await page.screenshot({ 
      clip: { x: 0, y: 0, width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT }, 
      type: 'jpeg',
      quality: 92 
    });
    
    console.log('☁️ Uploading screenshot to storage for', new URL(url).hostname);
    const fileName = `screens/${Date.now()}-${new URL(url).hostname}.jpg`;
    const { data, error } = await supabase
      .storage
      .from('screenshots')
      .upload(fileName, buf, { 
        contentType: 'image/jpeg', 
        upsert: true 
      });

    if (error) {
      throw error;
    }

    const { data: { publicUrl } } = supabase
      .storage
      .from('screenshots')
      .getPublicUrl(fileName);

    console.log('✅ Screenshot completed for', new URL(url).hostname);
    return { url, success: true, buffer: buf, publicUrl };
    
  } catch (err) { 
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error('❌ Screenshot failed for', url, ':', errorMsg);
    return { url, success: false, error: errorMsg };
  } finally {
    if (page) {
      await page.close().catch(() => {}); // Ignore close errors
    }
  }
}

async function generateEmbedding(screenshotResult: ScreenshotResult): Promise<EmbeddingResult> {
  if (!screenshotResult.success || !screenshotResult.buffer) {
    return {
      url: screenshotResult.url,
      success: false,
      error: screenshotResult.error || 'No screenshot buffer available'
    };
  }

  try {
    console.log('🧠 Generating CLIP embedding for', new URL(screenshotResult.url).hostname);
    const embedding = await embedImage(screenshotResult.buffer);
    console.log('✅ Embedding completed for', new URL(screenshotResult.url).hostname, `(${embedding.length} dimensions)`);
    
    return {
      url: screenshotResult.url,
      success: true,
      embedding,
      publicUrl: screenshotResult.publicUrl
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error('❌ Embedding failed for', screenshotResult.url, ':', errorMsg);
    return {
      url: screenshotResult.url,
      success: false,
      error: errorMsg
    };
  }
}

async function insertToDatabase(embeddingResult: EmbeddingResult): Promise<ProcessResult> {
  if (!embeddingResult.success || !embeddingResult.embedding) {
    return {
      url: embeddingResult.url,
      success: false,
      error: embeddingResult.error || 'No embedding available'
    };
  }

  try {
    console.log('💾 Inserting into database for', new URL(embeddingResult.url).hostname);
    const { data: insertData, error: insertError } = await supabase.rpc('insert_landing_vector', { 
      p_url: embeddingResult.url, 
      p_emb: embeddingResult.embedding, 
      p_shot: embeddingResult.publicUrl 
    });

    if (insertError) {
      throw insertError;
    }

    console.log('✅ Successfully seeded', embeddingResult.url);
    return { url: embeddingResult.url, success: true };
    
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error('❌ Database insertion failed for', embeddingResult.url, ':', errorMsg);
    return { url: embeddingResult.url, success: false, error: errorMsg };
  }
}

async function processConcurrentBatch<T, R>(
  items: T[], 
  processor: (item: T) => Promise<R>, 
  concurrencyLimit: number,
  stageName: string
): Promise<R[]> {
  const results: R[] = [];
  
  for (let i = 0; i < items.length; i += concurrencyLimit) {
    const batch = items.slice(i, i + concurrencyLimit);
    console.log(`\n🚀 ${stageName} batch ${Math.floor(i / concurrencyLimit) + 1}/${Math.ceil(items.length / concurrencyLimit)} (items ${i + 1}-${Math.min(i + concurrencyLimit, items.length)} of ${items.length})`);
    
    const batchPromises = batch.map(processor);
    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);
    
    // Brief pause between batches
    if (i + concurrencyLimit < items.length) {
      console.log('⏳ Waiting 1 second before next batch...');
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  return results;
}

async function processUrls(browser: Browser, urls: string[]): Promise<ProcessResult[]> {
  console.log('\n📷 PHASE 1: Taking screenshots');
  console.log('=' .repeat(50));
  const screenshotResults = await processConcurrentBatch(
    urls,
    (url) => takeScreenshot(browser, url),
    SCREENSHOT_CONCURRENT_LIMIT,
    'Screenshot'
  );

  const successfulScreenshots = screenshotResults.filter(r => r.success);
  console.log(`\n✅ Screenshots completed: ${successfulScreenshots.length}/${urls.length}`);

  if (successfulScreenshots.length === 0) {
    console.log('❌ No successful screenshots, skipping embedding phase');
    return screenshotResults.map(r => ({ url: r.url, success: r.success, error: r.error }));
  }

  console.log('\n🧠 PHASE 2: Generating embeddings');
  console.log('=' .repeat(50));
  const embeddingResults = await processConcurrentBatch(
    successfulScreenshots,
    generateEmbedding,
    EMBEDDING_CONCURRENT_LIMIT,
    'Embedding'
  );

  const successfulEmbeddings = embeddingResults.filter(r => r.success);
  console.log(`\n✅ Embeddings completed: ${successfulEmbeddings.length}/${successfulScreenshots.length}`);

  if (successfulEmbeddings.length === 0) {
    console.log('❌ No successful embeddings, skipping database phase');
    const allResults = [
      ...screenshotResults.filter(r => !r.success).map(r => ({ url: r.url, success: r.success, error: r.error })),
      ...embeddingResults.map(r => ({ url: r.url, success: r.success, error: r.error }))
    ];
    return allResults;
  }

  console.log('\n💾 PHASE 3: Inserting into database');
  console.log('=' .repeat(50));
  const databaseResults = await processConcurrentBatch(
    successfulEmbeddings,
    insertToDatabase,
    DATABASE_CONCURRENT_LIMIT,
    'Database'
  );

  // Combine all results
  const allResults: ProcessResult[] = [];
  
  // Add failed screenshots
  screenshotResults.filter(r => !r.success).forEach(r => {
    allResults.push({ url: r.url, success: false, error: r.error });
  });
  
  // Add failed embeddings
  embeddingResults.filter(r => !r.success).forEach(r => {
    allResults.push({ url: r.url, success: false, error: r.error });
  });
  
  // Add database results (both success and failure)
  allResults.push(...databaseResults);
  
  return allResults;
}

function normalizeUrl(input: string): string {
  let url = input.trim();
  
  // Skip if already has protocol
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }
  
  // Add https:// if no protocol
  if (!url.includes('://')) {
    url = `https://${url}`;
  }
  
  return url;
}

function readUrlsFromFile(filePath: string): string[] {
  try {
    const content = readFileSync(resolve(filePath), 'utf-8');
    const urls = content
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#')) // Remove empty lines and comments
      .map(line => normalizeUrl(line)) // Normalize URLs
      .filter(line => {
        try {
          new URL(line);
          return true;
        } catch {
          console.warn(`⚠️ Skipping invalid URL: ${line}`);
          return false;
        }
      });
    
    console.log(`📖 Read ${urls.length} valid URLs from ${filePath}`);
    return urls;
  } catch (err) {
    console.error(`❌ Failed to read file ${filePath}:`, err);
    process.exit(1);
  }
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  let urls: string[] = [];

  if (args.length === 0) {
    console.error('Usage:');
    console.error('  From file: ts-node scripts/seed.ts urls.txt');
    console.error('  From args: ts-node scripts/seed.ts <url1> [url2] [url3] ...');
    console.error('');
    console.error('File format: One URL per line, lines starting with # are ignored');
    console.error('');
    console.error('Concurrency limits:');
    console.error(`  Screenshots: ${SCREENSHOT_CONCURRENT_LIMIT}`);
    console.error(`  Embeddings: ${EMBEDDING_CONCURRENT_LIMIT}`);
    console.error(`  Database: ${DATABASE_CONCURRENT_LIMIT}`);
    process.exit(1);
  }

  // Check if first argument is a file (must exist and not look like a URL)
  if (args.length === 1) {
    const arg = args[0];
    const isUrl = arg.startsWith('http') || 
                  arg.includes('.') && (arg.includes('.com') || arg.includes('.org') || arg.includes('.net') || arg.includes('.io') || arg.includes('.co'));
    
    // Try to read as file only if it doesn't look like a URL and the file exists
    if (!isUrl) {
      try {
        const fs = await import('fs');
        if (fs.existsSync(resolve(arg))) {
          urls = readUrlsFromFile(arg);
        } else {
          // File doesn't exist, treat as URL
          urls = [normalizeUrl(arg)];
          console.log(`📝 Processing 1 URL from command line argument (file not found, treating as URL)`);
        }
      } catch {
        // If file operations fail, treat as URL
        urls = [normalizeUrl(arg)];
        console.log(`📝 Processing 1 URL from command line argument`);
      }
    } else {
      // Looks like a URL, treat as such
      urls = [normalizeUrl(arg)];
      console.log(`📝 Processing 1 URL from command line argument`);
    }
  } else {
    // Multiple arguments - treat all as URLs
    urls = args.map(arg => normalizeUrl(arg));
    console.log(`📝 Processing ${urls.length} URLs from command line arguments`);
  }

  if (urls.length === 0) {
    console.error('❌ No valid URLs to process');
    process.exit(1);
  }

  console.log(`🚀 Starting to process ${urls.length} URLs`);
  console.log(`📊 Concurrency limits: Screenshots=${SCREENSHOT_CONCURRENT_LIMIT}, Embeddings=${EMBEDDING_CONCURRENT_LIMIT}, Database=${DATABASE_CONCURRENT_LIMIT}`);
  
  const browser = await chromium.launch();
  
  try {
    const results = await processUrls(browser, urls);
    
    // Print summary
    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);
    
    console.log('\n📊 FINAL SUMMARY');
    console.log('=' .repeat(50));
    console.log(`✅ Successfully processed: ${successful.length}/${urls.length}`);
    console.log(`❌ Failed: ${failed.length}/${urls.length}`);
    
    if (failed.length > 0) {
      console.log('\n❌ Failed URLs:');
      failed.forEach(f => console.log(`  - ${f.url}: ${f.error}`));
    }
    
    console.log(`\n🎉 Completed processing ${urls.length} URLs`);
    
  } finally {
    await browser.close();
  }
}

main().catch(console.error);
