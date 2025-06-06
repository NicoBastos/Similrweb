"use client";
import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { User, Zap, LogIn } from 'lucide-react';
import { AuthModal } from './AuthModal';

interface UsageIndicatorProps {
  showUpgradePrompt?: boolean;
}

export function UsageIndicator({ showUpgradePrompt = false }: UsageIndicatorProps) {
  const { user, usage, loading, signOut } = useAuth();
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  
  // Debug frontend auth state
  console.log('🖥️ Frontend Auth Debug:', {
    hasUser: !!user,
    userId: user?.id,
    userEmail: user?.email,
    loading,
    usage: {
      comparisons_used: usage.comparisons_used,
      daily_limit: usage.daily_limit,
      has_reached_limit: usage.has_reached_limit,
      usage_display: usage.usage_display,
      is_authenticated: usage.is_authenticated
    }
  });

  if (loading) {
    return (
      <Badge variant="secondary" className="text-sm">
        <Zap className="w-4 h-4 mr-1" />
        Loading...
      </Badge>
    );
  }

  // Authenticated users see unlimited badge with username and sign out option
  if (user) {
    const username = user.user_metadata?.username || user.user_metadata?.full_name || user.email?.split('@')[0] || 'User';
    
    return (
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <Badge variant="default" className="text-sm bg-green-500/20 text-green-400 border-green-500/30">
            <User className="w-4 h-4 mr-1" />
            {username}
          </Badge>
          <Badge variant="secondary" className="text-xs">
            Unlimited
          </Badge>
        </div>
        
        <Button 
          size="sm" 
          variant="ghost"
          className="text-xs text-muted-foreground hover:text-foreground"
          onClick={signOut}
        >
          Sign Out
        </Button>
      </div>
    );
  }

  // Anonymous users see usage progress and sign in button
  const progressPercentage = (usage.comparisons_used / usage.daily_limit) * 100;
  const isNearLimit = usage.comparisons_used >= usage.daily_limit - 1;
  const hasReachedLimit = usage.has_reached_limit;

  return (
    <>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <Badge 
            variant={hasReachedLimit ? "destructive" : isNearLimit ? "secondary" : "outline"}
            className="text-sm"
          >
            <Zap className="w-4 h-4 mr-1" />
            {usage.usage_display} free today
          </Badge>
          
          {!hasReachedLimit && (
            <div className="w-16 h-2 bg-secondary rounded-full overflow-hidden">
              <Progress 
                value={progressPercentage} 
                className="h-full"
              />
            </div>
          )}
        </div>

        {/* Sign In Button */}
        <Button 
          size="sm" 
          variant="outline"
          className="border-primary/30 hover:bg-primary/10 text-xs"
          onClick={() => setIsAuthModalOpen(true)}
        >
          <LogIn className="w-4 h-4 mr-1" />
          Sign In
        </Button>

        {/* Upgrade prompt for near/at limit users */}
        {showUpgradePrompt && (isNearLimit || hasReachedLimit) && (
          <Button 
            size="sm" 
            variant="outline"
            className="border-primary/30 hover:bg-primary/10 text-xs"
            onClick={() => setIsAuthModalOpen(true)}
          >
            {hasReachedLimit ? 'Sign up for more' : 'Get unlimited'}
          </Button>
        )}
      </div>

      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        initialMode="signin"
      />
    </>
  );
} 