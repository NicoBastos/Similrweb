import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Eye, Zap, Target, ArrowRight, Search, BarChart3, CheckCircle, Github, Mail } from "lucide-react";
import Link from "next/link";
import { UsageIndicator } from "@/components/UsageIndicator";

export default function Home() {
  // Development flag to show under construction page
  const underconstruction = false;

  if (underconstruction) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-6 max-w-md mx-auto px-4">
          <h1 className="text-4xl font-bold text-gradient">
            Similrweb
          </h1>
          <h2 className="text-2xl font-semibold text-foreground/80">
            Under Construction
          </h2>
          <p className="text-foreground/60">
            Check back soon!
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Hero Section */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-secondary/10" />
        
        {/* Header */}
        <header className="relative border-b border-border/50 bg-card/20">
          <div className="container mx-auto px-4 py-4">
            <div className="flex items-center justify-between">
              <Link href="/" className="text-xl font-bold text-gradient">
                Similrweb
              </Link>
              <UsageIndicator />
            </div>
          </div>
        </header>
        
        <div className="relative container mx-auto px-4 py-20 sm:py-32">
          <div className="text-center space-y-8">
            <Badge variant="secondary" className="text-sm font-medium">
              <Zap className="w-4 h-4 mr-2" />
              AI-Powered Website Analysis
            </Badge>
            
            <h1 className="text-5xl sm:text-7xl font-bold tracking-tight">
              <span className="text-gradient">Similrweb</span>
            </h1>
            
            <p className="text-xl sm:text-2xl text-foreground/80 max-w-2xl mx-auto leading-relaxed">
              See the web through similarity
            </p>
            
            <p className="text-lg text-foreground/70 max-w-3xl mx-auto">
              Discover design patterns, analyze visual similarities, and understand web aesthetics with our advanced AI-powered comparison tool.
            </p>
            
            <div className="flex flex-col sm:flex-row gap-4 justify-center items-center mt-12">
              <Link href="/find">
                <Button 
                  size="lg" 
                  className="cta-gradient hover-glow text-white font-semibold px-8 py-4 rounded-full text-lg group"
                >
                  Start Comparing Websites
                  <ArrowRight className="w-5 h-5 ml-2 group-hover:translate-x-1 transition-transform" />
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-20 sm:py-32">
        <div className="container mx-auto px-4">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">
              Powerful <span className="text-gradient">Features</span>
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Everything you need to analyze and compare website designs with cutting-edge AI technology.
            </p>
          </div>
          
          <div className="grid md:grid-cols-3 gap-8">
            <Card className="feature-gradient border-primary/20 hover-glow group">
              <CardHeader className="text-center pb-4">
                <div className="w-16 h-16 bg-primary/20 rounded-full flex items-center justify-center mx-auto mb-4 group-hover:bg-primary/30 transition-colors">
                  <Eye className="w-8 h-8 text-primary" />
                </div>
                <CardTitle className="text-xl">Visual Similarity Detection</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription className="text-center text-base text-foreground/70 leading-relaxed">
                  Advanced computer vision algorithms analyze layout, color schemes, typography, and design patterns to identify visual relationships between websites.
                </CardDescription>
              </CardContent>
            </Card>

            <Card className="feature-gradient border-primary/20 hover-glow group">
              <CardHeader className="text-center pb-4">
                <div className="w-16 h-16 bg-secondary/20 rounded-full flex items-center justify-center mx-auto mb-4 group-hover:bg-secondary/30 transition-colors">
                  <BarChart3 className="w-8 h-8 text-secondary" />
                </div>
                <CardTitle className="text-xl">Comprehensive Analytics</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription className="text-center text-base text-foreground/70 leading-relaxed">
                  Get detailed insights with similarity scores, design trend analysis, and comprehensive reports that help you understand web design patterns.
                </CardDescription>
              </CardContent>
            </Card>

            <Card className="feature-gradient border-primary/20 hover-glow group">
              <CardHeader className="text-center pb-4">
                <div className="w-16 h-16 bg-accent/20 rounded-full flex items-center justify-center mx-auto mb-4 group-hover:bg-accent/30 transition-colors">
                  <Target className="w-8 h-8 text-accent" />
                </div>
                <CardTitle className="text-xl">Smart Recommendations</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription className="text-center text-base text-foreground/70 leading-relaxed">
                  Receive AI-powered suggestions for design improvements and discover websites with similar aesthetics to inspire your next project.
                </CardDescription>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section className="py-20 sm:py-32 bg-card/30">
        <div className="container mx-auto px-4">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">
              How It <span className="text-gradient">Works</span>
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Get started with website comparison in three simple steps.
            </p>
          </div>
          
          <div className="grid md:grid-cols-3 gap-8 md:gap-12">
            <div className="text-center space-y-4">
              <div className="w-20 h-20 bg-primary/20 rounded-full flex items-center justify-center mx-auto mb-6">
                <Search className="w-10 h-10 text-primary" />
              </div>
              <div className="text-primary font-bold text-sm tracking-wide">STEP 1</div>
              <h3 className="text-xl font-semibold">Enter Website URLs</h3>
              <p className="text-foreground/70 leading-relaxed">
                Simply paste the URLs of the websites you want to compare. Our system supports any publicly accessible website.
              </p>
            </div>

            <div className="text-center space-y-4">
              <div className="w-20 h-20 bg-secondary/20 rounded-full flex items-center justify-center mx-auto mb-6">
                <Zap className="w-10 h-10 text-secondary" />
              </div>
              <div className="text-secondary font-bold text-sm tracking-wide">STEP 2</div>
              <h3 className="text-xl font-semibold">AI Analysis</h3>
              <p className="text-foreground/70 leading-relaxed">
                Our advanced AI algorithms capture screenshots and analyze visual elements, extracting key design features and patterns.
              </p>
            </div>

            <div className="text-center space-y-4">
              <div className="w-20 h-20 bg-accent/20 rounded-full flex items-center justify-center mx-auto mb-6">
                <CheckCircle className="w-10 h-10 text-accent" />
              </div>
              <div className="text-accent font-bold text-sm tracking-wide">STEP 3</div>
              <h3 className="text-xl font-semibold">Get Results</h3>
              <p className="text-foreground/70 leading-relaxed">
                Receive detailed similarity scores, visual comparisons, and actionable insights to inform your design decisions.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 sm:py-32">
        <div className="container mx-auto px-4">
          <div className="text-center space-y-8">
            <h2 className="text-3xl sm:text-4xl font-bold">
              Ready to <span className="text-gradient">Explore</span> Website Similarities?
            </h2>
            <p className="text-lg text-foreground/70 max-w-2xl mx-auto">
              Join thousands of designers and developers who use Similrweb to analyze and improve their web designs.
            </p>
            <Link href="/find">
              <Button 
                size="lg" 
                className="cta-gradient hover-glow text-white font-semibold px-10 py-4 rounded-full text-lg group"
              >
                Get Started for Free
                <ArrowRight className="w-5 h-5 ml-2 group-hover:translate-x-1 transition-transform" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/50 bg-card/20">
        <div className="container mx-auto px-4 py-12">
          <div className="grid md:grid-cols-4 gap-8">
            <div className="space-y-4">
              <h3 className="text-xl font-bold text-gradient">Similrweb</h3>
              <p className="text-foreground/80">
                AI-powered website similarity analysis for designers and developers.
              </p>
            </div>
            
            <div className="space-y-3">
              <h4 className="font-semibold">Product</h4>
              <div className="space-y-2 text-sm">
                <a href="https://github.com/NicoBastos/Similrweb" className="block text-foreground/60 hover:text-primary transition-colors">Source Code</a>
              </div>
            </div>
            
            <div className="space-y-3">
              <h4 className="font-semibold">Connect</h4>
              <div className="flex space-x-4">
                <a href="#" className="text-foreground/60 hover:text-primary transition-colors">
                  <Github className="w-5 h-5" />
                </a>
                <a href="mailto:nickbastos4gmail.com" className="text-foreground/60 hover:text-primary transition-colors">
                  <Mail className="w-5 h-5" />
                </a>
              </div>
            </div>
          </div>
          
          <div className="border-t border-border/50 mt-8 pt-8 text-center text-sm text-foreground/60">
            <p>&copy; 2025 Similrweb. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
