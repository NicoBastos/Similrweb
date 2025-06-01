#!/usr/bin/env ts-node
/* scripts/scrape.ts */
import 'dotenv/config';
import { chromium } from 'playwright';
import type { Browser, Page } from 'playwright';
import { writeFileSync } from 'fs';
import { resolve } from 'path';

// Configuration
const BASE_URL = 'https://www.siteinspire.com/websites';
const START_PAGE = 1;
const END_PAGE = 228;
const OUTPUT_FILE = 'scraped-urls.txt';
const DELAY_BETWEEN_PAGES = 1500; // 1.5 second delay between page requests
const PAGE_TIMEOUT = 10000; // 10 second timeout per page

interface ScrapedUrl {
  originalUrl: string;
  cleanUrl: string;
  domain: string;
  foundOnPages: number[]; // Track which pages this URL was found on
}

interface PageResult {
  pageNumber: number;
  success: boolean;
  urlCount: number;
  newUniqueUrls: number;
  error?: string;
}

async function scrapePage(page: Page, pageNumber: number, existingUrls: Map<string, ScrapedUrl>): Promise<PageResult> {
  const url = `${BASE_URL}/page/${pageNumber}`;
  console.log(`📄 Scraping page ${pageNumber}/${END_PAGE}: ${url}`);
  
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: PAGE_TIMEOUT });
    
    // DEBUG: Save HTML for page 1 and 2
    if (pageNumber === 1 || pageNumber === 2) {
      const html = await page.content();
      writeFileSync(`debug-page${pageNumber}.html`, html, 'utf-8');
      console.log(`   🐞 Saved HTML for page ${pageNumber} to debug-page${pageNumber}.html`);
    }
    
    // Find all anchor tags with the ExternalLinkButton class
    const links = await page.$$eval('a.ExternalLinkButton', (elements) => {
      return elements.map((el) => {
        const href = el.getAttribute('href');
        const ariaLabel = el.getAttribute('aria-label');
        return { href, ariaLabel };
      });
    });
    
    let newUniqueUrls = 0;
    
    for (const link of links) {
      if (link.href) {
        const originalUrl = link.href;
        // Remove the ?ref=siteinspire parameter
        const cleanUrl = originalUrl.replace(/\?ref=siteinspire$/, '');
        
        try {
          const urlObj = new URL(cleanUrl);
          const domain = urlObj.hostname.replace(/^www\./, ''); // Remove www. prefix
          
          if (existingUrls.has(domain)) {
            // URL already exists, just add this page number
            existingUrls.get(domain)!.foundOnPages.push(pageNumber);
          } else {
            // New unique URL
            existingUrls.set(domain, {
              originalUrl,
              cleanUrl,
              domain,
              foundOnPages: [pageNumber]
            });
            newUniqueUrls++;
          }
        } catch (err) {
          console.warn(`⚠️ Invalid URL found on page ${pageNumber}: ${cleanUrl}`);
        }
      }
    }
    
    const result: PageResult = {
      pageNumber,
      success: true,
      urlCount: links.length,
      newUniqueUrls
    };
    
    console.log(`   ✅ Page ${pageNumber}: ${links.length} total links, ${newUniqueUrls} new unique domains`);
    
    return result;
    
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`   ❌ Page ${pageNumber} failed: ${errorMsg}`);
    return {
      pageNumber,
      success: false,
      urlCount: 0,
      newUniqueUrls: 0,
      error: errorMsg
    };
  }
}

async function scrapeAllPages(browser: Browser): Promise<{ urls: Map<string, ScrapedUrl>, results: PageResult[] }> {
  const page = await browser.newPage();
  const allUrls = new Map<string, ScrapedUrl>();
  const pageResults: PageResult[] = [];
  
  try {
    console.log(`🔍 Starting to scrape siteinspire.com from page ${START_PAGE} to ${END_PAGE}...`);
    
    for (let pageNumber = START_PAGE; pageNumber <= END_PAGE; pageNumber++) {
      // Scrape the current page
      const result = await scrapePage(page, pageNumber, allUrls);
      pageResults.push(result);
      
      // Progress update every 10 pages
      if (pageNumber % 10 === 0) {
        const uniqueCount = allUrls.size;
        const successfulPages = pageResults.filter(r => r.success).length;
        console.log(`📊 Progress: ${pageNumber}/${END_PAGE} pages, ${uniqueCount} unique domains, ${successfulPages} successful pages`);
      }
      
      // Add delay between requests to be respectful
      if (pageNumber < END_PAGE) {
        await page.waitForTimeout(DELAY_BETWEEN_PAGES);
      }
    }
    
    console.log(`🎉 Scraping completed! Processed ${END_PAGE} pages.`);
    return { urls: allUrls, results: pageResults };
    
  } finally {
    await page.close();
  }
}

function generateReport(urls: Map<string, ScrapedUrl>, results: PageResult[]): string {
  const successfulPages = results.filter(r => r.success);
  const failedPages = results.filter(r => !r.success);
  
  // Find URLs that appear on multiple pages (duplicates)
  const duplicateUrls = Array.from(urls.values()).filter(url => url.foundOnPages.length > 1);
  
  // Find the most common domains
  const sortedByFrequency = Array.from(urls.values()).sort((a, b) => b.foundOnPages.length - a.foundOnPages.length);
  
  return [
    `# Siteinspire.com Scraping Report`,
    `# Generated on: ${new Date().toISOString()}`,
    ``,
    `## Summary`,
    `- Pages attempted: ${START_PAGE} to ${END_PAGE} (${END_PAGE} total)`,
    `- Successful pages: ${successfulPages.length}`,
    `- Failed pages: ${failedPages.length}`,
    `- Unique domains found: ${urls.size}`,
    `- Domains appearing on multiple pages: ${duplicateUrls.length}`,
    ``,
    `## Failed Pages`,
    ...failedPages.map(p => `- Page ${p.pageNumber}: ${p.error}`),
    ``,
    `## Most Frequent Domains`,
    ...sortedByFrequency.slice(0, 10).map(url => 
      `- ${url.domain}: appears on ${url.foundOnPages.length} pages (${url.foundOnPages.slice(0, 5).join(', ')}${url.foundOnPages.length > 5 ? '...' : ''})`
    ),
    ``,
    `## Page-by-Page Results`,
    ...successfulPages.map(p => 
      `- Page ${p.pageNumber}: ${p.urlCount} links, ${p.newUniqueUrls} new unique domains`
    )
  ].join('\n');
}

function saveUrlsToFile(urls: Map<string, ScrapedUrl>, results: PageResult[], filePath: string): void {
  const urlArray = Array.from(urls.values());
  
  console.log(`\n🔍 Final analysis:`);
  console.log(`📊 Total unique domains: ${urlArray.length}`);
  console.log(`📄 Pages processed: ${results.length}`);
  console.log(`✅ Successful pages: ${results.filter(r => r.success).length}`);
  console.log(`❌ Failed pages: ${results.filter(r => !r.success).length}`);
  
  // Sort by domain for better readability
  urlArray.sort((a, b) => a.domain.localeCompare(b.domain));
  
  // Create output content
  const content = [
    `# Scraped URLs from siteinspire.com (Page 1-${END_PAGE})`,
    `# Total unique domains: ${urlArray.length}`,
    `# Scraped on: ${new Date().toISOString()}`,
    ``,
    `## Clean URLs (one per line)`,
    ...urlArray.map(url => url.cleanUrl),
    ``,
    `## Domains only (one per line)`,
    ...urlArray.map(url => url.domain),
    ``,
    `## Full data with page tracking (JSON)`,
    JSON.stringify(urlArray, null, 2)
  ].join('\n');
  
  writeFileSync(filePath, content, 'utf-8');
  console.log(`💾 Saved ${urlArray.length} unique URLs to ${filePath}`);
  
  // Save domains file
  const domainsFile = filePath.replace('.txt', '-domains.txt');
  const domainsContent = urlArray.map(url => url.domain).join('\n');
  writeFileSync(domainsFile, domainsContent, 'utf-8');
  console.log(`💾 Saved ${urlArray.length} domains to ${domainsFile}`);
  
  // Save detailed report
  const reportFile = filePath.replace('.txt', '-report.txt');
  const reportContent = generateReport(urls, results);
  writeFileSync(reportFile, reportContent, 'utf-8');
  console.log(`📋 Saved detailed report to ${reportFile}`);
}

async function main(): Promise<void> {
  const browser = await chromium.launch({ 
    headless: true, // Set to false if you want to see the browser in action
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  try {
    const { urls, results } = await scrapeAllPages(browser);
    
    if (urls.size === 0) {
      console.log('⚠️ No URLs were scraped. Please check the website structure.');
      return;
    }
    
    const outputPath = resolve(process.cwd(), OUTPUT_FILE);
    saveUrlsToFile(urls, results, outputPath);
    
    // Display sample results
    console.log('\n📊 Sample of scraped URLs:');
    const sampleUrls = Array.from(urls.values()).slice(0, 10);
    sampleUrls.forEach((url, index) => {
      const pagesList = url.foundOnPages.length > 3 
        ? `${url.foundOnPages.slice(0, 3).join(', ')}...` 
        : url.foundOnPages.join(', ');
      console.log(`${index + 1}. ${url.domain} -> ${url.cleanUrl} (found on pages: ${pagesList})`);
    });
    
    if (urls.size > 10) {
      console.log(`... and ${urls.size - 10} more URLs`);
    }
    
  } catch (err) {
    console.error('❌ Scraping failed:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  } finally {
    await browser.close();
  }
}

// Run the script
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('💥 Fatal error:', err);
    process.exit(1);
  });
}
