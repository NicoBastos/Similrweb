import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@website-similarity/db";

interface SimilarWebsite {
  id: number;
  url: string;
  screenshot_url: string;
  similarity: number;
  created_at: string;
}

export async function POST(request: NextRequest) {
  try {
    const { url } = await request.json();

    if (!url) {
      return NextResponse.json(
        { error: "URL is required" },
        { status: 400 }
      );
    }

    // Validate URL format
    try {
      new URL(url);
    } catch {
      return NextResponse.json(
        { error: "Invalid URL format" },
        { status: 400 }
      );
    }

    console.log('🔍 Finding similar websites for:', url);

    // Step 1: Get embedding for the provided URL
    console.log('📊 Getting embedding for URL...');
    const embedResponse = await fetch(`${request.nextUrl.origin}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });

    if (!embedResponse.ok) {
      const embedError = await embedResponse.json();
      console.error('❌ Embed endpoint failed:', embedError);
      return NextResponse.json(
        { 
          error: "Failed to generate embedding", 
          details: embedError.details || embedError.error 
        },
        { status: 500 }
      );
    }

    const embedResult = await embedResponse.json();
    const queryEmbedding = embedResult.embedding;

    if (!queryEmbedding || !Array.isArray(queryEmbedding)) {
      console.error('❌ Invalid embedding received:', embedResult);
      return NextResponse.json(
        { error: "Invalid embedding generated" },
        { status: 500 }
      );
    }

    console.log(`✅ Embedding generated: ${queryEmbedding.length} dimensions`);

    // Step 2: Query Supabase for similar embeddings using match_vectors
    console.log('🔎 Searching for similar websites in database...');
    const matchCount = 10; // Return top 10 similar websites
    
    const { data: similarWebsites, error: dbError } = await supabase.rpc('match_vectors', {
      query_emb: queryEmbedding,
      match_count: matchCount
    });

    if (dbError) {
      console.error('❌ Database query failed:', dbError);
      return NextResponse.json(
        { 
          error: "Database query failed", 
          details: dbError.message 
        },
        { status: 500 }
      );
    }

    if (!similarWebsites || similarWebsites.length === 0) {
      console.log('📭 No similar websites found');
      return NextResponse.json({
        similar_websites: [],
        query_url: url,
        processed_at: new Date().toISOString(),
        message: "No similar websites found in database"
      });
    }

    // Step 3: Transform results to match expected format
    const transformedResults = similarWebsites.map((website: SimilarWebsite) => ({
      url: website.url,
      screenshot: website.screenshot_url,
      title: new URL(website.url).hostname, // Generate title from hostname
      similarity_score: Math.round(website.similarity * 100) / 100, // Round to 2 decimal places
      id: website.id,
      created_at: website.created_at
    }));

    console.log(`✅ Found ${transformedResults.length} similar websites`);

    return NextResponse.json({
      similar_websites: transformedResults,
      query_url: url,
      query_embedding_dimensions: queryEmbedding.length,
      processed_at: new Date().toISOString()
    });

  } catch (error) {
    console.error("❌ Error in find-similar API:", error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    return NextResponse.json(
      { 
        error: "Internal server error",
        details: errorMessage
      },
      { status: 500 }
    );
  }
} 