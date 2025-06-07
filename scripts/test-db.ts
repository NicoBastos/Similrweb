#!/usr/bin/env ts-node
import 'dotenv/config';
import { supabase } from '../packages/db/service-role.ts';

async function testDatabase() {
  console.log('🔍 Testing database connection and checking for websites...\n');
  
  try {
    // Get count of websites
    const { count, error: countError } = await supabase
      .from('landing_vectors')
      .select('*', { count: 'exact', head: true });
    
    if (countError) {
      console.error('❌ Error getting count:', countError);
      return;
    }
    
    console.log(`📊 Total websites in database: ${count}`);
    
    if (count && count > 0) {
      // Get a few sample websites
      const { data: samples, error: sampleError } = await supabase
        .from('landing_vectors')
        .select('url, screenshot_url, created_at')
        .limit(5);
      
      if (sampleError) {
        console.error('❌ Error getting samples:', sampleError);
        return;
      }
      
      console.log('\n📝 Sample websites:');
      samples?.forEach((site, index) => {
        console.log(`${index + 1}. ${site.url}`);
        console.log(`   Screenshot: ${site.screenshot_url}`);
        console.log(`   Created: ${site.created_at}\n`);
      });
    }
    
  } catch (error) {
    console.error('❌ Database test failed:', error);
  }
}

testDatabase(); 