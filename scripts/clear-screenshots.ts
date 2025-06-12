/* scripts/clear-screenshots.ts
   CLI script to delete all files from the screenshots bucket */

import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// Load environment variables from the monorepo root
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = resolve(__dirname, '../.env');
console.log('🔍 Loading .env from:', envPath);
const result = config({ path: envPath });


async function clearScreenshots() {
  // Import after environment variables are loaded
  const { supabase } = await import('../packages/db/service-role');
  try {
    console.log('Fetching all files from screenshots/screens folder...');
    
    let allFiles: any[] = [];
    let offset = 0;
    const limit = 1000; // Supabase max limit per request
    
    // Fetch all files with pagination
    while (true) {
      const { data: files, error: listError } = await supabase
        .storage
        .from('screenshots')
        .list('screens', {
          limit,
          offset
        });

      if (listError) {
        throw new Error(`Failed to list files: ${listError.message}`);
      }

      if (!files || files.length === 0) {
        break; // No more files
      }

      allFiles = allFiles.concat(files);
      console.log(`Fetched ${files.length} files (total so far: ${allFiles.length})`);
      
      if (files.length < limit) {
        break; // Last batch
      }
      
      offset += limit;
    }

    if (allFiles.length === 0) {
      console.log('No files found in screenshots/screens folder.');
      return;
    }

    console.log(`\nFound ${allFiles.length} total files in screens folder. Deleting...`);

    // Delete in batches with delays to avoid rate limits
    const batchSize = 50; // Reduced batch size
    let deletedCount = 0;
    
    for (let i = 0; i < allFiles.length; i += batchSize) {
      const batch = allFiles.slice(i, i + batchSize);
      const filePaths = batch.map(file => `screens/${file.name}`);
      const batchNum = Math.floor(i/batchSize) + 1;
      const totalBatches = Math.ceil(allFiles.length/batchSize);
      
      let retries = 3;
      let success = false;
      
      while (retries > 0 && !success) {
        try {
          const { error: deleteError } = await supabase
            .storage
            .from('screenshots')
            .remove(filePaths);
          
          if (deleteError) {
            throw deleteError;
          }
          
          success = true;
          deletedCount += batch.length;
          console.log(`✅ Deleted batch ${batchNum}/${totalBatches} (${deletedCount}/${allFiles.length} files)`);
          
          // Add delay between batches to avoid rate limits
          if (i + batchSize < allFiles.length) {
            await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay
          }
          
        } catch (error) {
          retries--;
          console.log(`⚠️  Batch ${batchNum} failed, retrying... (${retries} retries left)`);
          
          if (retries === 0) {
            console.error(`❌ Batch ${batchNum} failed after all retries:`, error);
          } else {
            // Wait longer before retry
            await new Promise(resolve => setTimeout(resolve, 3000)); // 3 second delay before retry
          }
        }
      }
    }

    console.log(`\n✅ Successfully deleted ${deletedCount} files from screenshots/screens folder.`);

  } catch (error) {
    console.error('Error clearing screenshots:', error);
    process.exit(1);
  }
}

clearScreenshots(); 