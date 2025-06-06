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

interface DomainCheckResult {
  url: string;
  isParked: boolean;
  reason?: string;
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

async function checkIfParkedDomain(browser: Browser, url: string): Promise<DomainCheckResult> {
  let page: Page | null = null;
  
  try {
    console.log('🔍 Checking if domain is parked:', new URL(url).hostname);
    page = await browser.newPage({ 
      viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT } 
    });
    
    // Set a shorter timeout for parked domain detection
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10000 });
    
    // Get page content for analysis
    const content = await page.evaluate(() => {
      return {
        title: document.title || '',
        bodyText: document.body?.innerText || '',
        htmlContent: document.documentElement.innerHTML || '',
        metaDescription: document.querySelector('meta[name="description"]')?.getAttribute('content') || '',
        headText: document.head?.innerText || ''
      };
    });
    
    // Common parked domain indicators
    const parkedIndicators = [
      // Generic parking messages
      'this domain is for sale',
      'domain for sale',
      'buy this domain',
      'purchase this domain',
      'domain parking',
      'parked domain',
      'domain is parked',
      'coming soon',
      'under construction',
      'website coming soon',
      'site under construction',
      
      // Parking service providers
      'godaddy.com',
      'namecheap.com',
      'parkingcrew',
      'sedoparking',
      'skenzo',
      'domain.com',
      'hugedomains',
      'afternic',
      'dan.com',
      'flippa.com',
      'undeveloped.com',
      'above.com',
      'buydomains.com',
      
      // Generic placeholder content
      'default web site page',
      'default page',
      'placeholder page',
      'temporary page',
      'maintenance mode',
      'site temporarily unavailable',
      'website under maintenance',
      
      // Common parking page titles
      'welcome to nginx',
      'apache http server test page',
      'iis windows server',
      'default backend - 404'
    ];
    
    const combinedText = `${content.title} ${content.bodyText} ${content.metaDescription} ${content.headText}`.toLowerCase();
    const htmlLower = content.htmlContent.toLowerCase();
    
    // Check for parked domain indicators
    for (const indicator of parkedIndicators) {
      if (combinedText.includes(indicator.toLowerCase()) || htmlLower.includes(indicator.toLowerCase())) {
        return {
          url,
          isParked: true,
          reason: `Contains parked domain indicator: "${indicator}"`
        };
      }
    }
    
    // Check for minimal content (likely placeholder)
    const textContent = content.bodyText.trim();
    const wordCount = textContent.split(/\s+/).filter(word => word.length > 2).length;
    
    if (wordCount < 20) {
      return {
        url,
        isParked: true,
        reason: `Minimal content detected (${wordCount} meaningful words)`
      };
    }
    
    // Check for common parking page patterns in HTML structure
    const parkingPatterns = [
      'parking-lander',
      'domain-parking',
      'parked-domain',
      'for-sale-lander',
      'parking-page',
      'domain-for-sale'
    ];
    
    for (const pattern of parkingPatterns) {
      if (htmlLower.includes(pattern)) {
        return {
          url,
          isParked: true,
          reason: `HTML contains parking pattern: "${pattern}"`
        };
      }
    }
    
    // Check if page redirects to a parking service
    const finalUrl = page.url();
    const parkingDomains = [
      'parkingcrew.net',
      'sedoparking.com',
      'skenzo.com',
      'above.com',
      'hugedomains.com',
      'dan.com',
      'afternic.com'
    ];
    
    for (const parkingDomain of parkingDomains) {
      if (finalUrl.includes(parkingDomain)) {
        return {
          url,
          isParked: true,
          reason: `Redirected to parking service: ${parkingDomain}`
        };
      }
    }
    
    console.log('✅ Domain appears to be legitimate:', new URL(url).hostname);
    return { url, isParked: false };
    
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.log('⚠️ Could not check domain status for', url, '- assuming legitimate:', errorMsg);
    // If we can't check, assume it's legitimate to avoid false positives
    return { url, isParked: false };
  } finally {
    if (page) {
      await page.close().catch(() => {}); // Ignore close errors
    }
  }
}

async function dismissModalsAndPopups(page: Page): Promise<void> {
  try {
    // Strategy 1: Try ESC key first (works for many modals)
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    
    // Strategy 2: Comprehensive selector-based dismissal (multiple passes)
    const modalDismissalPasses = 3; // Try multiple times for nested modals
    
    for (let pass = 1; pass <= modalDismissalPasses; pass++) {
      console.log(`🔧 Modal dismissal pass ${pass}/${modalDismissalPasses}`);
      
      // Check if there are visible modal overlays first
      const hasModals = await page.evaluate(() => {
        // Look for common modal indicators
        const modalSelectors = [
          '[role="dialog"]',
          '[role="modal"]',
          '.modal',
          '.popup',
          '.overlay',
          '.lightbox',
          '[data-modal]',
          '[aria-modal="true"]'
        ];
        
        return modalSelectors.some(selector => {
          const elements = document.querySelectorAll(selector);
          return Array.from(elements).some(el => {
            const style = window.getComputedStyle(el);
            return style.display !== 'none' && 
                   style.visibility !== 'hidden' && 
                   style.opacity !== '0';
          });
        });
      });
      
      if (!hasModals && pass > 1) {
        console.log('✅ No more visible modals detected');
        break;
      }
      
      // Comprehensive list of close button selectors
      const closeSelectors = [
        // Cookie banners
        '.cookie-banner button:not([class*="accept"]):not([class*="allow"])',
        '.cookie-notice button:not([class*="accept"]):not([class*="allow"])',
        '.gdpr-banner button:not([class*="accept"]):not([class*="allow"])',
        '[data-cookie-banner] button:not([class*="accept"]):not([class*="allow"])',
        'button[class*="cookie"]:not([class*="accept"]):not([class*="allow"])',
        '.consent-banner button:not([class*="accept"]):not([class*="allow"])',
        
        // Generic close buttons
        'button[aria-label*="close" i]',
        'button[aria-label*="dismiss" i]',
        'button[aria-label*="cancel" i]',
        'button[title*="close" i]',
        'button[title*="dismiss" i]',
        
        // Modal close buttons
        '.modal-close',
        '.popup-close',
        '.dialog-close',
        '.overlay-close',
        '.lightbox-close',
        '[data-dismiss="modal"]',
        '[data-close="modal"]',
        '[data-modal-close]',
        
        // X buttons and icons
        'button[class*="close"]',
        '.close-button',
        '.btn-close',
        '.close-btn',
        'button.close',
        '[role="button"][aria-label*="close" i]',
        
        // Test ID selectors
        '[data-testid*="close"]',
        '[data-testid*="dismiss"]',
        '[data-testid*="modal-close"]',
        '[data-cy*="close"]',
        
        // Newsletter/subscription popups
        '.newsletter-popup button:not([class*="subscribe"]):not([class*="sign"])',
        '.email-popup button:not([class*="subscribe"]):not([class*="sign"])',
        '.subscription-modal button:not([class*="subscribe"]):not([class*="sign"])',
        
        // Age verification, location, etc.
        '.age-verification button:not([class*="confirm"]):not([class*="yes"])',
        '.location-popup button:not([class*="allow"]):not([class*="enable"])',
        
        // Generic overlays
        '.overlay button[class*="close"]',
        '.backdrop button[class*="close"]',
        '.modal-backdrop button',
        
        // SVG close icons (often used in modern designs)
        'button svg[class*="close"]',
        'button svg[class*="x"]',
        '[role="button"] svg[class*="close"]',
        
        // Specific patterns for common frameworks
        '.MuiDialog-root button[aria-label*="close" i]',
        '.ant-modal-close',
        '.el-dialog__close',
        '.v-dialog button[class*="close"]'
      ];
      
      // Alternative selectors (buttons that might close modals but aren't clearly labeled)
      const alternativeSelectors = [
        // Buttons containing "No thanks", "Maybe later", "Skip", etc.
        'button:has-text("No thanks")',
        'button:has-text("Maybe later")',
        'button:has-text("Skip")',
        'button:has-text("Not now")',
        'button:has-text("Decline")',
        'button:has-text("Reject")',
        'button:has-text("Dismiss")',
        'button:has-text("Continue without")',
        'button:has-text("×")',
        'button:has-text("✕")',
        'button:has-text("✖")'
      ];
      
      let dismissed = false;
      
      // Try primary close selectors
      for (const selector of closeSelectors) {
        try {
          const elements = await page.$$(selector);
          for (const element of elements) {
            const isVisible = await element.isVisible();
            if (isVisible) {
              await element.click();
              await page.waitForTimeout(200);
              dismissed = true;
              console.log(`✅ Dismissed modal using selector: ${selector}`);
              break;
            }
          }
          if (dismissed) break;
        } catch (error) {
          // Continue to next selector
        }
      }
      
      // If no primary selector worked, try alternative approaches
      if (!dismissed) {
        // Try alternative text-based selectors
        for (const selector of alternativeSelectors) {
          try {
            const element = await page.$(selector);
            if (element && await element.isVisible()) {
              await element.click();
              await page.waitForTimeout(200);
              dismissed = true;
              console.log(`✅ Dismissed modal using alternative selector: ${selector}`);
              break;
            }
          } catch (error) {
            // Continue to next selector
          }
        }
      }
      
      // Strategy 3: Click outside modal area (click on backdrop)
      if (!dismissed) {
        try {
          const backdrop = await page.$('.modal-backdrop, .overlay, .backdrop, [data-backdrop]');
          if (backdrop && await backdrop.isVisible()) {
            await backdrop.click();
            await page.waitForTimeout(200);
            dismissed = true;
            console.log('✅ Dismissed modal by clicking backdrop');
          }
        } catch (error) {
          // Ignore backdrop click errors
        }
      }
      
      // Strategy 4: Try ESC key again
      if (!dismissed) {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);
        console.log('🔧 Tried ESC key dismissal');
      }
      
      // Wait a bit between passes
      if (pass < modalDismissalPasses) {
        await page.waitForTimeout(300);
      }
    }
    
    // Strategy 5: Final comprehensive check and forced dismissal
    await page.evaluate(() => {
      // Force hide common modal patterns using CSS
      const modalPatterns = [
        '[role="dialog"]',
        '[role="modal"]',
        '.modal',
        '.popup',
        '.overlay:not(.leaflet-overlay-pane)', // Exclude map overlays
        '.lightbox',
        '.cookie-banner',
        '.gdpr-banner',
        '.consent-banner',
        '.newsletter-popup',
        '.email-popup',
        '.subscription-modal',
        '[data-modal]',
        '[aria-modal="true"]'
      ];
      
      modalPatterns.forEach(pattern => {
        const elements = document.querySelectorAll(pattern);
        elements.forEach(el => {
          const style = window.getComputedStyle(el);
          // Only hide if it looks like a modal (positioned, high z-index, etc.)
          if (style.position === 'fixed' || style.position === 'absolute') {
            const zIndex = parseInt(style.zIndex);
            if (zIndex > 100 || style.backgroundColor.includes('rgba')) {
              (el as HTMLElement).style.display = 'none';
            }
          }
        });
      });
      
      // Also try to remove backdrop/overlay elements
      const backdropElements = document.querySelectorAll('.modal-backdrop, .backdrop, [data-backdrop]');
      backdropElements.forEach(el => {
        (el as HTMLElement).style.display = 'none';
      });
    });
    
    // Final wait for any animations to complete
    await page.waitForTimeout(500);
    console.log('✅ Modal dismissal completed');
    
  } catch (error) {
    console.log('⚠️ Some modals might not have been dismissed:', error instanceof Error ? error.message : String(error));
  }
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
      // 1. Comprehensive modal and popup dismissal
      console.log('🔧 Dismissing modals and popups for', new URL(url).hostname);
      await dismissModalsAndPopups(page);

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
  
  // Phase 0: Check for parked domains first
  console.log(`\n🔍 BATCH ${batchNumber}: Checking for parked domains`);
  const domainCheckResults = await processConcurrentBatch(
    urls,
    (url) => checkIfParkedDomain(browser, url),
    SCREENSHOT_CONCURRENT_LIMIT, // Use same concurrency as screenshots
    `Batch ${batchNumber} Domain Check`,
    progressTracker
  );

  const legitimateUrls = domainCheckResults.filter(r => !r.isParked).map(r => r.url);
  const parkedDomains = domainCheckResults.filter(r => r.isParked);
  
  console.log(`✅ Batch ${batchNumber} domain check: ${legitimateUrls.length}/${urls.length} legitimate websites found`);
  
  // Add parked domains to results as skipped
  parkedDomains.forEach(r => {
    console.log(`🚫 Skipping parked domain: ${r.url} (${r.reason})`);
    batchResults.push({ url: r.url, success: false, error: `Parked domain: ${r.reason}` });
  });

  if (legitimateUrls.length === 0) {
    console.log(`❌ Batch ${batchNumber}: No legitimate websites found, skipping remaining phases`);
    return batchResults;
  }

  // Phase 1: Screenshots for legitimate URLs only
  console.log(`\n📷 BATCH ${batchNumber}: Taking screenshots of ${legitimateUrls.length} legitimate websites`);
  const screenshotResults = await processConcurrentBatch(
    legitimateUrls,
    (url) => takeScreenshot(browser, url),
    SCREENSHOT_CONCURRENT_LIMIT,
    `Batch ${batchNumber} Screenshots`,
    progressTracker
  );

  const successfulScreenshots = screenshotResults.filter(r => r.success);
  const failedScreenshots = screenshotResults.filter(r => !r.success);
  
  console.log(`✅ Batch ${batchNumber} screenshots: ${successfulScreenshots.length}/${legitimateUrls.length} successful`);
  
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
  const parkedDomains = allResults.filter(r => !r.success && r.error?.includes('Parked domain')).length;
  const actualFailures = totalFailed - parkedDomains;
  
  progressTracker.currentPhase = 'All batches completed';
  progressTracker.phaseProgress = `${totalSuccessful} successful, ${parkedDomains} parked, ${actualFailures} failed`;
  progressTracker.completedUrls = totalSuccessful;
  
  console.log('\n📊 FINAL BATCH PROCESSING SUMMARY');
  console.log('='.repeat(70));
  console.log(`🎯 Total websites processed: ${urls.length}`);
  console.log(`✅ Successfully seeded: ${totalSuccessful}/${urls.length} (${Math.round((totalSuccessful / urls.length) * 100)}%)`);
  console.log(`🚫 Parked domains skipped: ${parkedDomains}/${urls.length} (${Math.round((parkedDomains / urls.length) * 100)}%)`);
  console.log(`❌ Failed to seed: ${actualFailures}/${urls.length} (${Math.round((actualFailures / urls.length) * 100)}%)`);
  
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
    const parked = results.filter(r => !r.success && r.error?.includes('Parked domain'));
    const actuallyFailed = results.filter(r => !r.success && !r.error?.includes('Parked domain'));
    
    console.log('\n📊 FINAL SUMMARY');
    console.log('=' .repeat(50));
    console.log(`🎯 Total websites processed: ${urls.length}`);
    console.log(`✅ Successfully seeded: ${successful.length}/${urls.length} (${Math.round((successful.length / urls.length) * 100)}%)`);
    console.log(`🚫 Parked domains skipped: ${parked.length}/${urls.length} (${Math.round((parked.length / urls.length) * 100)}%)`);
    console.log(`❌ Failed to seed: ${actuallyFailed.length}/${urls.length} (${Math.round((actuallyFailed.length / urls.length) * 100)}%)`);
    
    if (successful.length > 0) {
      console.log('\n✅ Successfully seeded websites:');
      successful.forEach(s => console.log(`  ✓ ${s.url}`));
    }
    
    if (parked.length > 0) {
      console.log('\n🚫 Parked domains (skipped):');
      parked.forEach(p => console.log(`  🚫 ${p.url}: ${p.error}`));
    }
    
    if (actuallyFailed.length > 0) {
      console.log('\n❌ Failed websites:');
      actuallyFailed.forEach(f => console.log(`  ✗ ${f.url}: ${f.error}`));
    }
    
    console.log(`\n🎉 Seeding completed: ${successful.length} websites successfully added to database`);
    
  } finally {
    await browser.close();
  }
}

main().catch(console.error);
