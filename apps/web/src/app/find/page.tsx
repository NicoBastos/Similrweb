"use client";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Search, Globe, ArrowRight, Loader2, ExternalLink, Zap } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { UsageIndicator } from "@/components/UsageIndicator";
import { useAuth } from "@/contexts/AuthContext";
import { ProgressSteps } from "@/components/ProgressSteps";

interface SimilarWebsite {
  url: string;
  screenshot: string;
  title?: string;
  similarity_score?: number;
  id?: number;
  created_at?: string;
  is_original?: boolean;
}

interface CachedResult {
  results: SimilarWebsite[];
  original: SimilarWebsite | null;
  timestamp: number;
  expiresAt: number;
}

// Cache configuration
const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes in milliseconds

export default function FindPage() {
  const [url, setUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [results, setResults] = useState<SimilarWebsite[]>([]);
  const [originalWebsite, setOriginalWebsite] = useState<SimilarWebsite | null>(null);
  const [error, setError] = useState("");
  const [cacheHit, setCacheHit] = useState(false);
  const [isRateLimited, setIsRateLimited] = useState(false);
  const [showProgress, setShowProgress] = useState(false);
  const [currentUrl, setCurrentUrl] = useState("");
  
  const { refreshUsage } = useAuth();

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

  const getCachedResult = (normalizedUrl: string): { results: SimilarWebsite[]; original: SimilarWebsite | null } | null => {
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

      return { results: cachedResult.results, original: cachedResult.original };
    } catch {
      return null;
    }
  };

  const setCachedResult = (normalizedUrl: string, results: SimilarWebsite[], original: SimilarWebsite | null) => {
    try {
      const cacheKey = getCacheKey(normalizedUrl);
      const cachedResult: CachedResult = {
        results,
        original,
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
    setIsRateLimited(false);
    setCacheHit(false);
    setShowProgress(false);
    
    try {
      const normalizedUrl = normalizeUrl(url.trim());
      setCurrentUrl(normalizedUrl);
      
      // Check cache first
      const cachedData = getCachedResult(normalizedUrl);
      if (cachedData) {
        console.log('🎯 Cache hit for:', normalizedUrl);
        setResults(cachedData.results);
        setOriginalWebsite(cachedData.original);
        setCacheHit(true);
        setIsLoading(false);
        return;
      }

      console.log('🔍 Cache miss, fetching from API for:', normalizedUrl);
      
      // Show progress steps for new requests
      setShowProgress(true);
      
      const response = await fetch("/api/find-similar", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url: normalizedUrl }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 429) {
          // Rate limited
          setIsRateLimited(true);
          setError(data.message || "Daily limit reached");
          await refreshUsage(); // Refresh usage state
        } else {
          throw new Error(data.error || "Failed to find similar websites");
        }
        return;
      }

      const similarWebsites = data.similar_websites || [];
      const originalWebsiteData = data.original_website || null;
      
      // Debug logging (remove in production)
      if (process.env.NODE_ENV === 'development') {
        console.log('📊 API Response Debug:', {
          similarWebsites: similarWebsites.length,
          originalWebsite: originalWebsiteData,
          hasScreenshot: !!originalWebsiteData?.screenshot
        });
      }
      
      setResults(similarWebsites);
      setOriginalWebsite(originalWebsiteData);
      
      // Temporary debug logging
      console.log('🎯 Setting original website:', originalWebsiteData);
      console.log('🎯 Has screenshot:', !!originalWebsiteData?.screenshot);
      
      // Cache the results for future use
      setCachedResult(normalizedUrl, similarWebsites, originalWebsiteData);
      
      // Refresh usage count after successful request
      await refreshUsage();
      
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setIsLoading(false);
      setShowProgress(false);
    }
  };

  const handleProgressComplete = () => {
    // Progress animation completed, results should be ready
    setShowProgress(false);
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
            <UsageIndicator />
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
                      className="pl-12 h-12 text-lg border-primary/20 bg-card/50"
                      disabled={isLoading}
                    />
                  </div>
                  <Button 
                    type="submit" 
                    size="lg"
                    disabled={isLoading || !url.trim() || !isValidUrl(url.trim())}
                    className="cta-gradient hover-glow text-white font-semibold px-8 h-12 group"
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                        {showProgress ? "Processing..." : "Analyzing..."}
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
                
                {url.trim() && !isValidUrl(url.trim()) && (
                  <p className="text-destructive text-sm">
                    Please enter a valid URL (e.g., https://example.com)
                  </p>
                )}
              </form>
            </CardContent>
          </Card>

          {/* Progress Steps */}
          <ProgressSteps 
            isActive={showProgress && isLoading}
            onComplete={handleProgressComplete}
            websiteUrl={currentUrl}
          />

          {/* Rate Limit Message */}
          {isRateLimited && (
            <Card className="border-destructive/20 bg-destructive/5 mb-8">
              <CardContent className="p-6 text-center">
                <h3 className="text-lg font-semibold text-destructive mb-2">
                  Daily Limit Reached
                </h3>
                <p className="text-muted-foreground mb-4">
                  You&apos;ve used all your free comparisons for today. Sign up to get unlimited access!
                </p>
                <UsageIndicator showUpgradePrompt={true} />
              </CardContent>
            </Card>
          )}

          {/* Error Message */}
          {error && !isRateLimited && (
            <Card className="border-destructive/20 bg-destructive/5 mb-8">
              <CardContent className="p-4">
                <p className="text-destructive text-center">{error}</p>
              </CardContent>
            </Card>
          )}

          {/* Cache Hit Indicator */}
          {cacheHit && results.length > 0 && (
            <div className="flex justify-center mb-4">
              <Badge variant="secondary" className="text-sm">
                <Zap className="w-4 h-4 mr-2" />
                Results loaded from cache
              </Badge>
            </div>
          )}

          {/* Results Section */}
          {results.length > 0 && (
            <div className="space-y-8">

              
                                              {/* Original Website Display */}
                {originalWebsite && (
                  <div className="space-y-4">
                    <div className="text-center">
                      <h2 className="text-2xl font-bold mb-2">
                        Original Website
                      </h2>
                      <p className="text-muted-foreground">
                        The website you&apos;re comparing against
                      </p>

                    </div>
                  
                  <div className="flex justify-center">
                    <Card className="w-full max-w-2xl border-primary/20 bg-gradient-to-br from-primary/5 via-transparent to-primary/10">
                      <CardHeader className="p-0">
                        <div className="relative aspect-video rounded-t-lg overflow-hidden bg-muted">
                          {originalWebsite.screenshot ? (
                            <Image
                              src={originalWebsite.screenshot}
                              alt={`Screenshot of ${originalWebsite.title || originalWebsite.url}`}
                              fill
                              className="object-cover"
                              sizes="(max-width: 768px) 100vw, 672px"
                              priority
                              onError={() => {
                                console.error('🖼️ Image failed to load:', originalWebsite.screenshot);
                              }}
                              onLoad={() => {
                                console.log('✅ Image loaded successfully:', originalWebsite.screenshot);
                              }}
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center bg-muted">
                              <p className="text-muted-foreground">Screenshot processing...</p>
                            </div>
                          )}
                          <div className="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent" />
                          <div className="absolute top-3 left-3">
                            <Badge className="bg-primary text-primary-foreground font-medium">
                              Original
                            </Badge>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent className="p-6">
                        <CardTitle className="text-xl mb-2 line-clamp-1">
                          {originalWebsite.title || new URL(originalWebsite.url).hostname}
                        </CardTitle>
                        <CardDescription className="text-base mb-4 line-clamp-2">
                          {originalWebsite.url}
                        </CardDescription>
                        <Button 
                          variant="outline" 
                          size="lg" 
                          className="w-full group/btn"
                          asChild
                        >
                          <a 
                            href={originalWebsite.url} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="flex items-center justify-center"
                          >
                            Visit Original Website
                            <ExternalLink className="w-5 h-5 ml-2 group-hover/btn:translate-x-1 transition-transform" />
                          </a>
                        </Button>
                      </CardContent>
                    </Card>
                  </div>
                </div>
              )}

              <div className="text-center">
                <h2 className="text-2xl font-bold mb-2">
                  Similar Websites Found
                </h2>
                <p className="text-muted-foreground">
                  {results.length} visually similar websites discovered
                </p>
              </div>
              
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                {results.map((website, index) => (
                  <Card key={index} className="group hover:shadow-lg transition-all duration-300 border-primary/10">
                    <CardHeader className="p-0">
                      <div className="relative aspect-video rounded-t-lg overflow-hidden bg-muted">
                        <Image
                          src={website.screenshot}
                          alt={`Screenshot of ${website.title || website.url}`}
                          fill
                          className="object-cover transition-transform duration-300 group-hover:scale-105"
                          sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent" />
                        <div className="absolute bottom-3 left-3 right-3">
                          <Badge variant="secondary" className="text-xs">
                            {website.similarity_score ? `${Math.round(website.similarity_score * 100)}% similar` : 'Match found'}
                          </Badge>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="p-4">
                      <CardTitle className="text-lg mb-2 line-clamp-1">
                        {website.title || new URL(website.url).hostname}
                      </CardTitle>
                      <CardDescription className="text-sm mb-3 line-clamp-2">
                        {website.url}
                      </CardDescription>
                      <Button 
                        variant="outline" 
                        size="sm" 
                        className="w-full group/btn"
                        asChild
                      >
                        <a 
                          href={website.url} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="flex items-center justify-center"
                        >
                          Visit Website
                          <ExternalLink className="w-4 h-4 ml-2 group-hover/btn:translate-x-1 transition-transform" />
                        </a>
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {/* No Results */}
          {!isLoading && !error && results.length === 0 && url.trim() && (
            <Card className="border-primary/20 bg-card/50">
              <CardContent className="p-8 text-center">
                <h3 className="text-xl font-semibold mb-2">No Similar Websites Found</h3>
                <p className="text-muted-foreground">
                  We couldn&apos;t find any visually similar websites in our database. Try a different URL or check back later as we add more websites.
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </main>
    </div>
  );
} 