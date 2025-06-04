"use client";
import 'dotenv/config';
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Search, Globe, ArrowRight, Loader2, ExternalLink, Zap } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

interface SimilarWebsite {
  url: string;
  screenshot: string;
  title?: string;
  similarity_score?: number;
}

interface CachedResult {
  results: SimilarWebsite[];
  timestamp: number;
  expiresAt: number;
}

// Cache configuration
const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes in milliseconds

export default function FindPage() {
  const [url, setUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [results, setResults] = useState<SimilarWebsite[]>([]);
  const [error, setError] = useState("");
  const [cacheHit, setCacheHit] = useState(false);

  // Check cache on component mount
  useEffect(() => {
    // Clear expired cache entries on page load
    clearExpiredCache();
  }, []);

  const getCacheKey = (normalizedUrl: string) => `similarity_cache_${normalizedUrl}`;

  const clearExpiredCache = () => {
    const keys = Object.keys(localStorage).filter(key => key.startsWith('similarity_cache_'));
    keys.forEach(key => {
      try {
        const cached = JSON.parse(localStorage.getItem(key) || '{}') as CachedResult;
        if (cached.expiresAt && Date.now() > cached.expiresAt) {
          localStorage.removeItem(key);
        }
      } catch {
        // Invalid cache entry, remove it
        localStorage.removeItem(key);
      }
    });
  };

  const getCachedResult = (normalizedUrl: string): SimilarWebsite[] | null => {
    try {
      const cacheKey = getCacheKey(normalizedUrl);
      const cached = localStorage.getItem(cacheKey);
      if (!cached) return null;

      const cachedResult = JSON.parse(cached) as CachedResult;
      
      // Check if cache is still valid
      if (Date.now() > cachedResult.expiresAt) {
        localStorage.removeItem(cacheKey);
        return null;
      }

      return cachedResult.results;
    } catch {
      return null;
    }
  };

  const setCachedResult = (normalizedUrl: string, results: SimilarWebsite[]) => {
    try {
      const cacheKey = getCacheKey(normalizedUrl);
      const cachedResult: CachedResult = {
        results,
        timestamp: Date.now(),
        expiresAt: Date.now() + CACHE_DURATION
      };
      localStorage.setItem(cacheKey, JSON.stringify(cachedResult));
    } catch (error) {
      console.warn('Failed to cache results:', error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;

    setIsLoading(true);
    setError("");
    setCacheHit(false);
    
    try {
      const normalizedUrl = normalizeUrl(url.trim());
      
      // Check cache first
      const cachedResults = getCachedResult(normalizedUrl);
      if (cachedResults) {
        console.log('🎯 Cache hit for:', normalizedUrl);
        setResults(cachedResults);
        setCacheHit(true);
        setIsLoading(false);
        return;
      }

      console.log('🔍 Cache miss, fetching from API for:', normalizedUrl);
      
      const response = await fetch("/api/find-similar", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url: normalizedUrl }),
      });

      if (!response.ok) {
        throw new Error("Failed to find similar websites");
      }

      const data = await response.json();
      const similarWebsites = data.similar_websites || [];
      
      setResults(similarWebsites);
      
      // Cache the results for future use
      setCachedResult(normalizedUrl, similarWebsites);
      
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setIsLoading(false);
    }
  };

  const normalizeUrl = (inputUrl: string) => {
    // Add https:// if no protocol is provided
    if (!inputUrl.match(/^https?:\/\//)) {
      return `https://${inputUrl}`;
    }
    return inputUrl;
  };

  const isValidUrl = (string: string) => {
    try {
      new URL(normalizeUrl(string));
      return true;
    } catch {
      return false;
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/50 bg-card/20">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <Link href="/" className="text-xl font-bold text-gradient">
              Similrweb
            </Link>
            <Badge variant="secondary" className="text-sm">
              <Zap className="w-4 h-4 mr-2" />
              AI-Powered Analysis
            </Badge>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        {/* Search Section */}
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-8">
            <h1 className="text-4xl sm:text-5xl font-bold mb-4">
              Find <span className="text-gradient">Similar</span> Websites
            </h1>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Enter a website URL to discover visually similar websites and analyze design patterns.
            </p>
          </div>

          {/* Input Form */}
          <Card className="feature-gradient border-primary/20 mb-8">
            <CardContent className="p-6">
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="flex flex-col sm:flex-row gap-4">
                  <div className="flex-1 relative">
                    <Globe className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-5 h-5" />
                    <Input
                      type="text"
                      placeholder="https://example.com"
                      value={url}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setUrl(e.target.value)}
                      className="pl-10 pr-4 py-3 text-lg"
                      disabled={isLoading}
                    />
                  </div>
                  <Button
                    type="submit"
                    size="lg"
                    disabled={!url.trim() || !isValidUrl(url.trim()) || isLoading}
                    className="cta-gradient hover-glow text-white font-semibold px-8 py-3 group"
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                        Analyzing...
                      </>
                    ) : (
                      <>
                        <Search className="w-5 h-5 mr-2" />
                        Find Similar
                        <ArrowRight className="w-5 h-5 ml-2 group-hover:translate-x-1 transition-transform" />
                      </>
                    )}
                  </Button>
                </div>
                
                {error && (
                  <div className="text-red-400 text-sm mt-2 p-3 bg-red-400/10 rounded-lg border border-red-400/20">
                    {error}
                  </div>
                )}
              </form>
            </CardContent>
          </Card>

          {/* Results Section */}
          {isLoading && (
            <div className="space-y-6">
              <div className="text-center py-12">
                <div className="relative w-24 h-24 mx-auto mb-6">
                  {/* Outer rotating ring */}
                  <div className="absolute inset-0 rounded-full border-4 border-primary/20"></div>
                  <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-primary animate-spin"></div>
                  
                  {/* Inner pulsing circle */}
                  <div className="absolute inset-4 rounded-full bg-primary/10 animate-pulse flex items-center justify-center">
                    <Search className="w-8 h-8 text-primary animate-bounce" />
                  </div>
                </div>
                
                <h3 className="text-xl font-semibold mb-2">Analyzing Website</h3>
                <p className="text-muted-foreground mb-4">
                  We're capturing and analyzing the website design patterns...
                </p>
                
                {/* Animated progress dots */}
                <div className="flex justify-center space-x-1">
                  <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                  <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                  <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                </div>
              </div>
            </div>
          )}

          {results.length > 0 && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold">
                  Similar Websites
                </h2>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-sm">
                    {results.length} results found
                  </Badge>
                  {cacheHit && (
                    <Badge variant="secondary" className="text-sm bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-400">
                      ⚡ Cached Result
                    </Badge>
                  )}
                </div>
              </div>

              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                {results.map((website, index) => (
                  <Card key={index} className="feature-gradient border-primary/20 hover-glow group overflow-hidden">
                    <div className="relative aspect-video bg-muted/20 overflow-hidden">
                      <Image
                        src={website.screenshot}
                        alt={`Screenshot of ${website.url}`}
                        fill
                        className="object-cover group-hover:scale-105 transition-transform duration-300"
                        sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                      />
                      {website.similarity_score && (
                        <div className="absolute top-3 right-3">
                          <Badge className="bg-primary/90 text-white">
                            {Math.round(website.similarity_score * 100)}% match
                          </Badge>
                        </div>
                      )}
                    </div>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-lg truncate">
                        {website.title || new URL(website.url).hostname}
                      </CardTitle>
                      <CardDescription className="text-sm text-muted-foreground truncate">
                        {website.url}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full group/button"
                        asChild
                      >
                        <a
                          href={website.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center justify-center"
                        >
                          Visit Website
                          <ExternalLink className="w-4 h-4 ml-2 group-hover/button:translate-x-1 transition-transform" />
                        </a>
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {/* Empty State */}
          {!isLoading && results.length === 0 && !error && (
            <div className="text-center py-12">
              <div className="w-20 h-20 bg-muted/20 rounded-full flex items-center justify-center mx-auto mb-6">
                <Search className="w-10 h-10 text-muted-foreground" />
              </div>
              <h3 className="text-xl font-semibold mb-2">Ready to Explore</h3>
              <p className="text-muted-foreground">
                Enter a website URL above to find visually similar websites and analyze design patterns.
              </p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
} 