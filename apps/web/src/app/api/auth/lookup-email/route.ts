import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@website-similarity/db";

export async function POST(request: NextRequest) {
  try {
    const { username } = await request.json() as { username?: string };

    if (!username) {
      return NextResponse.json(
        { error: "Username is required" },
        { status: 400 }
      );
    }

    // Query Supabase auth users to find user with matching username in metadata
    const { data: users, error } = await supabase.auth.admin.listUsers();

    if (error) {
      console.error('Error fetching users:', error);
      return NextResponse.json(
        { error: "Failed to lookup username" },
        { status: 500 }
      );
    }

    // Find user with matching username in metadata
    const user = users.users.find(user => 
      user.user_metadata?.username === username || 
      user.user_metadata?.full_name === username
    );

    if (user) {
      return NextResponse.json({ email: user.email });
    } else {
      return NextResponse.json({ email: null });
    }

  } catch (error) {
    console.error('Lookup email API error:', error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
} 