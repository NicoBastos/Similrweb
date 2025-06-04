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
const SCREENSHOT_CONCURRENT_LIMIT = 15; // Increased from 5
const EMBEDDING_CONCURRENT_LIMIT = 8; // Increased from 3 
const DATABASE_CONCURRENT_LIMIT = 25; // Increased from 10
const BATCH_SIZE = 100; // Process URLs in batches of 100
const VIEWPORT_WIDTH = 1980;
const VIEWPORT_HEIGHT = 1080;
const SCREENSHOT_TIMEOUT = 3000; // Reduced from 5000

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

interface ProgressTracker {
  totalUrls: number;
  completedUrls: number;
  currentPhase: string;
  phaseProgress: string;
}

function reportProgress(tracker: ProgressTracker) {
  const remaining = tracker.totalUrls - tracker.completedUrls;
  const percentage = tracker.totalUrls > 0 ? Math.round((tracker.completedUrls / tracker.totalUrls) * 100) : 0;
  
  console.log(`\n📊 OVERALL PROGRESS: ${tracker.completedUrls}/${tracker.totalUrls} completed (${percentage}%) | ${remaining} remaining`);
  console.log(`🔄 Current: ${tracker.currentPhase} ${tracker.phaseProgress}`);
}

async function takeScreenshot(browser: Browser, url: string): Promise<ScreenshotResult> {
  let page: Page | null = null;
  
  try {
    console.log('📷 Taking screenshot of', url);
    page = await browser.newPage({ 
      viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT } 
    });
    
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: SCREENSHOT_TIMEOUT });
    
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
            await page.waitForTimeout(200); // Reduced from 500
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
        window.scrollTo({ top: document.body.scrollHeight, behavior: 'auto' }); // Changed from 'smooth'
      });
      await page.waitForTimeout(500); // Reduced from 2000
      
      // Scroll back to top for the screenshot
      await page.evaluate(() => {
        window.scrollTo({ top: 0, behavior: 'auto' }); // Changed from 'smooth'
      });
      await page.waitForTimeout(200); // Reduced from 1000

      // 3. Wait for fonts and delayed animations
      console.log('⏳ Waiting for fonts and animations to complete for', new URL(url).hostname);
      await page.waitForTimeout(300); // Replaced waitForLoadState('networkidle') with fixed timeout
      
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
      await page.waitForTimeout(200); // Reduced from 1000

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
  stageName: string,
  progressTracker?: ProgressTracker
): Promise<R[]> {
  const results: R[] = [];
  
  for (let i = 0; i < items.length; i += concurrencyLimit) {
    const batch = items.slice(i, i + concurrencyLimit);
    const batchNum = Math.floor(i / concurrencyLimit) + 1;
    const totalBatches = Math.ceil(items.length / concurrencyLimit);
    const batchProgress = `(batch ${batchNum}/${totalBatches})`;
    
    console.log(`\n🚀 ${stageName} ${batchProgress} - processing items ${i + 1}-${Math.min(i + concurrencyLimit, items.length)} of ${items.length}`);
    
    // Update progress tracker if provided
    if (progressTracker) {
      progressTracker.currentPhase = stageName;
      progressTracker.phaseProgress = batchProgress;
      reportProgress(progressTracker);
    }
    
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

async function processBatchPipeline(
  browser: Browser, 
  urls: string[], 
  batchNumber: number, 
  totalBatches: number,
  progressTracker: ProgressTracker
): Promise<ProcessResult[]> {
  const batchResults: ProcessResult[] = [];
  
  console.log(`\n🎯 BATCH ${batchNumber}/${totalBatches}: Processing ${urls.length} URLs`);
  console.log('='.repeat(70));
  
  // Phase 1: Screenshots for this batch
  console.log(`\n📷 BATCH ${batchNumber}: Taking screenshots`);
  const screenshotResults = await processConcurrentBatch(
    urls,
    (url) => takeScreenshot(browser, url),
    SCREENSHOT_CONCURRENT_LIMIT,
    `Batch ${batchNumber} Screenshots`,
    progressTracker
  );

  const successfulScreenshots = screenshotResults.filter(r => r.success);
  const failedScreenshots = screenshotResults.filter(r => !r.success);
  
  console.log(`✅ Batch ${batchNumber} screenshots: ${successfulScreenshots.length}/${urls.length} successful`);
  
  // Add failed screenshots to results
  failedScreenshots.forEach(r => {
    batchResults.push({ url: r.url, success: false, error: r.error });
  });

  if (successfulScreenshots.length === 0) {
    console.log(`❌ Batch ${batchNumber}: No successful screenshots, skipping remaining phases`);
    return batchResults;
  }

  // Phase 2: Embeddings for successful screenshots in this batch
  console.log(`\n🧠 BATCH ${batchNumber}: Generating embeddings`);
  const embeddingResults = await processConcurrentBatch(
    successfulScreenshots,
    generateEmbedding,
    EMBEDDING_CONCURRENT_LIMIT,
    `Batch ${batchNumber} Embeddings`,
    progressTracker
  );

  const successfulEmbeddings = embeddingResults.filter(r => r.success);
  const failedEmbeddings = embeddingResults.filter(r => !r.success);
  
  console.log(`✅ Batch ${batchNumber} embeddings: ${successfulEmbeddings.length}/${successfulScreenshots.length} successful`);
  
  // Add failed embeddings to results
  failedEmbeddings.forEach(r => {
    batchResults.push({ url: r.url, success: false, error: r.error });
  });

  if (successfulEmbeddings.length === 0) {
    console.log(`❌ Batch ${batchNumber}: No successful embeddings, skipping database phase`);
    return batchResults;
  }

  // Phase 3: Database insertions for successful embeddings in this batch
  console.log(`\n💾 BATCH ${batchNumber}: Inserting into database`);
  const databaseResults = await processConcurrentBatch(
    successfulEmbeddings,
    insertToDatabase,
    DATABASE_CONCURRENT_LIMIT,
    `Batch ${batchNumber} Database`,
    progressTracker
  );

  const successfulInsertions = databaseResults.filter(r => r.success);
  console.log(`✅ Batch ${batchNumber} database: ${successfulInsertions.length}/${successfulEmbeddings.length} successful`);
  
  // Update progress tracker with completed URLs from this batch
  progressTracker.completedUrls += successfulInsertions.length;
  
  // Add all database results to batch results
  batchResults.push(...databaseResults);
  
  console.log(`\n🎉 BATCH ${batchNumber} COMPLETED: ${successfulInsertions.length}/${urls.length} URLs fully processed`);
  
  return batchResults;
}

async function processUrls(browser: Browser, urls: string[]): Promise<ProcessResult[]> {
  const progressTracker: ProgressTracker = {
    totalUrls: urls.length,
    completedUrls: 0,
    currentPhase: 'Starting',
    phaseProgress: ''
  };

  console.log(`\n🎯 STARTING BATCH PROCESSING OF ${urls.length} WEBSITES`);
  console.log(`📦 Processing in batches of ${BATCH_SIZE} URLs`);
  reportProgress(progressTracker);

  const allResults: ProcessResult[] = [];
  const totalBatches = Math.ceil(urls.length / BATCH_SIZE);
  
  // Process URLs in batches of BATCH_SIZE
  for (let i = 0; i < urls.length; i += BATCH_SIZE) {
    const batchUrls = urls.slice(i, i + BATCH_SIZE);
    const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
    
    // Update progress tracker for current batch
    progressTracker.currentPhase = `Processing Batch ${batchNumber}/${totalBatches}`;
    progressTracker.phaseProgress = `${batchUrls.length} URLs`;
    reportProgress(progressTracker);
    
    try {
      const batchResults = await processBatchPipeline(
        browser, 
        batchUrls, 
        batchNumber, 
        totalBatches, 
        progressTracker
      );
      
      allResults.push(...batchResults);
      
      // Brief pause between batches (except for the last batch)
      if (i + BATCH_SIZE < urls.length) {
        console.log('\n⏳ Waiting 2 seconds before next batch...');
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      
    } catch (error) {
      console.error(`❌ Error processing batch ${batchNumber}:`, error);
      // Add failed batch URLs to results
      batchUrls.forEach(url => {
        allResults.push({ 
          url, 
          success: false, 
          error: `Batch ${batchNumber} processing failed: ${error instanceof Error ? error.message : String(error)}` 
        });
      });
    }
  }

  // Final summary
  const totalSuccessful = allResults.filter(r => r.success).length;
  const totalFailed = allResults.filter(r => !r.success).length;
  
  progressTracker.currentPhase = 'All batches completed';
  progressTracker.phaseProgress = `${totalSuccessful} successful, ${totalFailed} failed`;
  progressTracker.completedUrls = totalSuccessful;
  
  console.log('\n📊 FINAL BATCH PROCESSING SUMMARY');
  console.log('='.repeat(70));
  console.log(`🎯 Total websites processed: ${urls.length}`);
  console.log(`✅ Successfully seeded: ${totalSuccessful}/${urls.length} (${Math.round((totalSuccessful / urls.length) * 100)}%)`);
  console.log(`❌ Failed to seed: ${totalFailed}/${urls.length} (${Math.round((totalFailed / urls.length) * 100)}%)`);
  
  reportProgress(progressTracker);
  
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
    console.error(`  Batch size: ${BATCH_SIZE} URLs per batch`);
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

  console.log(`🚀 Starting to process ${urls.length} URLs in batches of ${BATCH_SIZE}`);
  console.log(`📊 Batch processing config: Size=${BATCH_SIZE}, Screenshots=${SCREENSHOT_CONCURRENT_LIMIT}, Embeddings=${EMBEDDING_CONCURRENT_LIMIT}, Database=${DATABASE_CONCURRENT_LIMIT}`);
  
  const browser = await chromium.launch();
  
  try {
    const results = await processUrls(browser, urls);
    
    // Print final detailed summary
    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);
    
    console.log('\n📊 FINAL SUMMARY');
    console.log('=' .repeat(50));
    console.log(`🎯 Total websites processed: ${urls.length}`);
    console.log(`✅ Successfully seeded: ${successful.length}/${urls.length} (${Math.round((successful.length / urls.length) * 100)}%)`);
    console.log(`❌ Failed to seed: ${failed.length}/${urls.length} (${Math.round((failed.length / urls.length) * 100)}%)`);
    
    if (successful.length > 0) {
      console.log('\n✅ Successfully seeded websites:');
      successful.forEach(s => console.log(`  ✓ ${s.url}`));
    }
    
    if (failed.length > 0) {
      console.log('\n❌ Failed websites:');
      failed.forEach(f => console.log(`  ✗ ${f.url}: ${f.error}`));
    }
    
    console.log(`\n🎉 Seeding completed: ${successful.length} websites successfully added to database`);
    
  } finally {
    await browser.close();
  }
}

main().catch(console.error);
