import { NextResponse } from "next/server";
import { cookies } from 'next/headers';
import { 
  getSessionFromCookie, 
  createNewSession, 
  shouldResetSession, 
  resetSessionForNewDay,
  hasReachedLimit,
  getUsageDisplay,
  SESSION_COOKIE_NAME
} from "@/lib/session";

export async function GET() {
  try {
    await cookies();
    
    // Try to get existing session
    let session = await getSessionFromCookie();
    
    // Create new session if none exists
    if (!session) {
      session = createNewSession();
    }
    
    // Reset session if it's a new day
    if (shouldResetSession(session)) {
      session = resetSessionForNewDay(session);
    }
    
    // Update cookie with current session
    const response = NextResponse.json({
      comparisons_used: session.comparisons_used,
      daily_limit: session.daily_limit,
      has_reached_limit: hasReachedLimit(session),
      usage_display: getUsageDisplay(session),
      reset_date: session.reset_date
    });
    
    // Set secure cookie
    response.cookies.set(SESSION_COOKIE_NAME, JSON.stringify(session), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 30, // 30 days
      path: '/'
    });
    
    return response;
    
  } catch (error) {
    console.error('Usage API error:', error);
    return NextResponse.json(
      { error: "Failed to get usage info" },
      { status: 500 }
    );
  }
} 