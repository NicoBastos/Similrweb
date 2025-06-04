/* apps/web/src/lib/session.ts
   Session management for anonymous usage tracking */

import { cookies } from 'next/headers';
import { v4 as uuidv4 } from 'uuid';

export interface UsageSession {
  id: string;
  comparisons_used: number;
  daily_limit: number;
  reset_date: string; // ISO date string
  created_at: string;
}

export const SESSION_COOKIE_NAME = 'similrweb_session';
export const DAILY_FREE_LIMIT = 3;

export function generateSessionId(): string {
  return uuidv4();
}

export function getTodayDateString(): string {
  return new Date().toISOString().split('T')[0]; // YYYY-MM-DD
}

export async function getSessionFromCookie(): Promise<UsageSession | null> {
  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME);
    
    if (!sessionCookie?.value) {
      return null;
    }

    return JSON.parse(sessionCookie.value) as UsageSession;
  } catch {
    return null;
  }
}

export function createNewSession(): UsageSession {
  const today = getTodayDateString();
  return {
    id: generateSessionId(),
    comparisons_used: 0,
    daily_limit: DAILY_FREE_LIMIT,
    reset_date: today,
    created_at: new Date().toISOString()
  };
}

export function shouldResetSession(session: UsageSession): boolean {
  const today = getTodayDateString();
  return session.reset_date !== today;
}

export function resetSessionForNewDay(session: UsageSession): UsageSession {
  const today = getTodayDateString();
  return {
    ...session,
    comparisons_used: 0,
    reset_date: today
  };
}

export function incrementSessionUsage(session: UsageSession): UsageSession {
  return {
    ...session,
    comparisons_used: session.comparisons_used + 1
  };
}

export function hasReachedLimit(session: UsageSession): boolean {
  return session.comparisons_used >= session.daily_limit;
}

export function getUsageDisplay(session: UsageSession): string {
  return `${session.comparisons_used}/${session.daily_limit}`;
} 