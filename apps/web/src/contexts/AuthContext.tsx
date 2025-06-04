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
}

interface AuthContextType {
  // Auth state
  user: User | null;
  loading: boolean;
  
  // Usage tracking
  usage: UsageInfo;
  
  // Actions  
  signIn: (email: string, password: string) => Promise<{ error?: AuthError | null }>;
  signUp: (email: string, password: string) => Promise<{ error?: AuthError | null }>;
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
          usage_display: data.usage_display
        });
      }
    } catch (error) {
      console.error('Failed to fetch usage:', error);
    }
  };

  const signIn = async (email: string, password: string) => {
    const { error } = await supabaseClient.auth.signInWithPassword({
      email,
      password
    });
    return { error };
  };

  const signUp = async (email: string, password: string) => {
    const { error } = await supabaseClient.auth.signUp({
      email,
      password
    });
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