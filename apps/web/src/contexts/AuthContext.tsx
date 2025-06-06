"use client";
/* apps/web/src/contexts/AuthContext.tsx
   React Context for auth state and usage tracking */

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { User, AuthError } from '@supabase/supabase-js';
import { supabaseClient } from '@website-similarity/db/client-only';

interface UsageInfo {
  comparisons_used: number;
  daily_limit: number;
  has_reached_limit: boolean;
  usage_display: string;
  is_authenticated?: boolean;
}

interface AuthContextType {
  // Auth state
  user: User | null;
  loading: boolean;
  
  // Usage tracking
  usage: UsageInfo;
  
  // Actions  
  signIn: (emailOrUsername: string, password: string) => Promise<{ error?: AuthError | null }>;
  signUp: (email: string, password: string, username: string) => Promise<{ error?: AuthError | null }>;
  signOut: () => Promise<void>;
  refreshUsage: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [usage, setUsage] = useState<UsageInfo>({
    comparisons_used: 0,
    daily_limit: 3,
    has_reached_limit: false,
    usage_display: '0/3'
  });

  // Initialize auth state
  useEffect(() => {
    // Get initial session
    supabaseClient.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });

    // Listen for auth changes
    const { data: { subscription } } = supabaseClient.auth.onAuthStateChange(
      async (event, session) => {
        setUser(session?.user ?? null);
        setLoading(false);
        
        // Refresh usage when auth state changes
        await refreshUsage();
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  // Load usage info on mount and when user changes
  useEffect(() => {
    refreshUsage();
  }, [user]);

  const refreshUsage = async () => {
    try {
      const response = await fetch('/api/usage');
      if (response.ok) {
        const data = await response.json();
        setUsage({
          comparisons_used: data.comparisons_used,
          daily_limit: data.daily_limit,
          has_reached_limit: data.has_reached_limit,
          usage_display: data.usage_display,
          is_authenticated: data.is_authenticated
        });
      }
    } catch (error) {
      console.error('Failed to fetch usage:', error);
    }
  };

  const isEmail = (input: string): boolean => {
    return input.includes('@') && input.includes('.');
  };

  const signIn = async (emailOrUsername: string, password: string) => {
    let email = emailOrUsername;

    // If input is not an email format, try to find the user by username
    if (!isEmail(emailOrUsername)) {
      try {
        // Create an API endpoint to look up email by username
        const response = await fetch('/api/auth/lookup-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: emailOrUsername })
        });

        if (response.ok) {
          const data = await response.json();
          if (data.email) {
            email = data.email;
          } else {
            return {
              error: {
                message: 'No account found with this username. Please check your username or sign up for a new account.'
              } as AuthError
            };
          }
        } else {
          return {
            error: {
              message: 'No account found with this username. Please check your username or sign up for a new account.'
            } as AuthError
          };
        }
      } catch {
        return {
          error: {
            message: 'Unable to verify username. Please try again or use your email address.'
          } as AuthError
        };
      }
    }

    const { error } = await supabaseClient.auth.signInWithPassword({
      email,
      password
    });
    
    // Provide more specific error messages
    if (error) {
      if (error.message.includes('Invalid login credentials')) {
        return { 
          error: { 
            ...error, 
            message: 'Invalid credentials. Please check your email/username and password or sign up for a new account.' 
          } as AuthError 
        };
      }
      if (error.message.includes('Email not confirmed')) {
        return { 
          error: { 
            ...error, 
            message: 'Please check your email and click the confirmation link before signing in.' 
          } as AuthError 
        };
      }
    }
    
    return { error };
  };

  const signUp = async (email: string, password: string, username: string) => {
    const { error } = await supabaseClient.auth.signUp({
      email,
      password,
      options: {
        data: {
          username: username,
          full_name: username // Also store as full_name for compatibility
        }
      }
    });
    
    // Provide more specific error messages
    if (error) {
      if (error.message.includes('User already registered')) {
        return { 
          error: { 
            ...error, 
            message: 'An account with this email already exists. Please sign in instead or use a different email address.' 
          } as AuthError 
        };
      }
      if (error.message.includes('Password should be at least')) {
        return { 
          error: { 
            ...error, 
            message: 'Password must be at least 6 characters long.' 
          } as AuthError 
        };
      }
      if (error.message.includes('Invalid email')) {
        return { 
          error: { 
            ...error, 
            message: 'Please enter a valid email address.' 
          } as AuthError 
        };
      }
    }
    
    return { error };
  };

  const signOut = async () => {
    await supabaseClient.auth.signOut();
  };

  const value: AuthContextType = {
    user,
    loading,
    usage,
    signIn,
    signUp, 
    signOut,
    refreshUsage
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
} 