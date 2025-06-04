"use client";

import { useState } from 'react';

export default function DebugAuth() {
  const [result, setResult] = useState<string>('');
  const [loading, setLoading] = useState(false);

  const testDirectSupabase = async () => {
    setLoading(true);
    setResult('Testing...');
    
    try {
      // Import Supabase dynamically
      const { createClient } = await import('@supabase/supabase-js');
      
      console.log('🔍 Creating Supabase client with hardcoded values...');
      
      const client = createClient(
        'https://fpwkocfpazvkggbwfvoq.supabase.co',
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZwd2tvY2ZwYXp2a2dnYndmdm9xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDg3MjEyODIsImV4cCI6MjA2NDI5NzI4Mn0.PTmSw37DnsL7etFf0Nf6njGWwsY1JvXqpWtlrUHC4aE',
        {
          auth: {
            debug: true,
            autoRefreshToken: false,
            persistSession: false
          }
        }
      );
      
      console.log('✅ Client created, testing signup...');
      
      const { data, error } = await client.auth.signUp({
        email: 'test@example.com',
        password: 'testpass123'
      });
      
      if (error) {
        console.error('❌ Signup error:', error);
        setResult(`Error: ${error.message}`);
      } else {
        console.log('✅ Signup success:', data);
        setResult(`Success! User created: ${data.user?.email}`);
      }
      
    } catch (err) {
      console.error('❌ Test failed:', err);
      setResult(`Test failed: ${err}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Debug Supabase Auth</h1>
      
      <div className="space-y-4">
        <button
          onClick={testDirectSupabase}
          disabled={loading}
          className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 disabled:opacity-50"
        >
          {loading ? 'Testing...' : 'Test Direct Supabase Signup'}
        </button>
        
        {result && (
          <div className="p-4 bg-gray-100 rounded">
            <h3 className="font-bold">Result:</h3>
            <pre className="mt-2 text-sm">{result}</pre>
          </div>
        )}
        
        <div className="p-4 bg-yellow-50 rounded">
          <h3 className="font-bold">Instructions:</h3>
          <ol className="list-decimal list-inside mt-2 space-y-1 text-sm">
            <li>Open browser console (F12)</li>
            <li>Click the test button</li>
            <li>Check console for detailed logs</li>
            <li>Report back what you see</li>
          </ol>
        </div>
      </div>
    </div>
  );
} 