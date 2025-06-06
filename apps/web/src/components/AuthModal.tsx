"use client";
import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, Mail, Lock, User, X, CheckCircle } from 'lucide-react';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialMode?: 'signin' | 'signup';
}

export function AuthModal({ isOpen, onClose, initialMode = 'signup' }: AuthModalProps) {
  const [mode, setMode] = useState<'signin' | 'signup'>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showEmailConfirmation, setShowEmailConfirmation] = useState(false);
  
  const { signIn, signUp } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Basic validation
    if (!email.trim() || !password.trim()) return;
    if (mode === 'signup' && !username.trim()) return;

    setLoading(true);
    setError('');

    try {
      const { error } = mode === 'signin' 
        ? await signIn(email, password)
        : await signUp(email, password, username);

      if (error) {
        setError(error.message || 'Authentication failed');
      } else {
        if (mode === 'signup') {
          // Show email confirmation message for signup
          setShowEmailConfirmation(true);
        } else {
          // Close modal immediately for sign in
          onClose();
          setEmail('');
          setPassword('');
        }
      }
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const switchMode = () => {
    setMode(mode === 'signin' ? 'signup' : 'signin');
    setError('');
    setShowEmailConfirmation(false);
  };

  const handleClose = () => {
    onClose();
    setEmail('');
    setPassword('');
    setUsername('');
    setShowEmailConfirmation(false);
    setError('');
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <Card className="w-full max-w-md border-primary/20" style={{ backgroundColor: '#0a0a0a' }}>
        <CardHeader className="relative">
          <button
            onClick={handleClose}
            className="absolute right-4 top-4 text-muted-foreground hover:text-foreground"
          >
            <X className="w-5 h-5" />
          </button>
          
          <div className="text-center space-y-2">
            {showEmailConfirmation ? (
              <>
                <Badge variant="secondary" className="text-sm bg-green-500/20 text-green-400 border-green-500/30">
                  <CheckCircle className="w-4 h-4 mr-2" />
                  Check Your Email
                </Badge>
                
                <CardTitle className="text-2xl">
                  Confirm Your Email
                </CardTitle>
                
                <CardDescription>
                  We&apos;ve sent a confirmation link to <strong>{email}</strong>. 
                  Please check your email and click the link to activate your account.
                </CardDescription>
              </>
            ) : (
              <>
                <Badge variant="secondary" className="text-sm">
                  <User className="w-4 h-4 mr-2" />
                  {mode === 'signup' ? 'Get Unlimited Access' : 'Welcome Back'}
                </Badge>
                
                <CardTitle className="text-2xl">
                  {mode === 'signup' ? 'Create Account' : 'Sign In'}
                </CardTitle>
                
                <CardDescription>
                  {mode === 'signup' 
                    ? 'Sign up to get unlimited website comparisons and advanced features'
                    : 'Sign in to access your unlimited comparisons'
                  }
                </CardDescription>
              </>
            )}
          </div>
        </CardHeader>
        
        <CardContent>
          {showEmailConfirmation ? (
            <div className="space-y-4">
              <div className="text-center space-y-4">
                <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto">
                  <Mail className="w-8 h-8 text-green-400" />
                </div>
                
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">
                    Didn&apos;t receive the email? Check your spam folder or 
                  </p>
                  <Button
                    variant="link"
                    size="sm"
                    className="text-primary hover:underline p-0 h-auto"
                    onClick={() => {
                      setShowEmailConfirmation(false);
                      setMode('signup');
                    }}
                  >
                    try signing up again
                  </Button>
                </div>
              </div>
              
              <Button
                onClick={handleClose}
                className="w-full"
                variant="outline"
              >
                Got it, thanks!
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                {mode === 'signup' && (
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
                    <Input
                      type="text"
                      placeholder="Enter your username"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      className="pl-10"
                      disabled={loading}
                      required={mode === 'signup'}
                      minLength={2}
                      maxLength={30}
                    />
                  </div>
                )}
                
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
                  <Input
                    type="text"
                    placeholder={mode === 'signin' ? "Enter your email or username" : "Enter your email"}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="pl-10"
                    disabled={loading}
                    required
                  />
                </div>
                
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
                  <Input
                    type="password"
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pl-10"
                    disabled={loading}
                    required
                    minLength={6}
                  />
                </div>
              </div>

              {error && (
                <div className="text-destructive text-sm p-3 bg-destructive/10 rounded-lg border border-destructive/20">
                  {error}
                </div>
              )}

              <Button
                type="submit"
                className="w-full cta-gradient hover-glow text-white font-semibold"
                disabled={loading || !email.trim() || !password.trim() || (mode === 'signup' && !username.trim())}
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    {mode === 'signup' ? 'Creating Account...' : 'Signing In...'}
                  </>
                ) : (
                  mode === 'signup' ? 'Create Account' : 'Sign In'
                )}
              </Button>

              <div className="text-center text-sm text-muted-foreground">
                {mode === 'signup' ? 'Already have an account?' : "Don't have an account?"}{' '}
                <button
                  type="button"
                  onClick={switchMode}
                  className="text-primary hover:underline font-medium"
                  disabled={loading}
                >
                  {mode === 'signup' ? 'Sign in' : 'Sign up'}
                </button>
              </div>

              {mode === 'signup' && (
                <div className="text-xs text-muted-foreground text-center">
                  By signing up, you agree to our Terms of Service and Privacy Policy
                </div>
              )}
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
} 