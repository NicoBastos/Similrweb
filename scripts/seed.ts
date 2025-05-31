#!/usr/bin/env ts-node
/* scripts/seed.ts */
import 'dotenv/config';
import { chromium } from 'playwright';
import { supabase } from '../packages/db/index.ts';
import { embedImage } from '../packages/embed/index.ts';

const urls = process.argv.slice(2);

if (urls.length === 0) {
  console.error('Usage: ts-node scripts/seed.ts <url1> [url2] [url3] ...');
  process.exit(1);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

for (const url of urls) {
  try {
    console.log('📷 Taking screenshot of', url);
    await page.goto(url, { waitUntil: 'networkidle', timeout: 40000 });
    const buf = await page.screenshot({ 
      clip: { x: 0, y: 0, width: 1024, height: 1024 }, 
      type: 'jpeg', 
      quality: 92 
    });
    
    console.log('☁️ Uploading screenshot to storage...');
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

    console.log('🧠 Generating CLIP embedding...');
    const embedding = await embedImage(buf);
    console.log('✅ Embedding generated, dimensions:', embedding.length);

    console.log('💾 Inserting into database...');
    const { data: insertData, error: insertError } = await supabase.rpc('insert_landing_vector', { 
      p_url: url, 
      p_emb: embedding, 
      p_shot: publicUrl 
    });

    if (insertError) {
      console.error('❌ Database insertion failed:', insertError);
      throw insertError;
    }

    console.log('✅ Database insertion successful:', insertData);
    console.log('🎉 seeded', url);
  } catch (err) { 
    console.error('❌ fail', url, err); 
  }
}

await browser.close();
