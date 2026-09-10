import re

with open('src/components/ApiKeyScreen.tsx', 'r') as f:
    content = f.read()

content = """import React, { useState } from 'react';
import { KeyRound, ArrowRight, Zap } from 'lucide-react';

interface Props {
  onValidKey: (geminiKey: string, groqKey: string) => void;
}

export default function ApiKeyScreen({ onValidKey }: Props) {
  const [geminiKey, setGeminiKey] = useState('');
  const [groqKey, setGroqKey] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!geminiKey.trim() && !groqKey.trim()) {
      setError("Please provide at least one API key");
      return;
    }
    
    setIsLoading(true);
    setError('');
    
    try {
      const res = await fetch('/api/verify-key', {
        method: 'POST',
        headers: { 
          'x-gemini-key': geminiKey.trim(),
          'x-groq-key': groqKey.trim()
        }
      });
      
      const data = await res.json();
      if (data.valid) {
        onValidKey(geminiKey.trim(), groqKey.trim());
      } else {
        setError(data.error || 'Invalid API Keys. Please check your inputs.');
      }
    } catch (err) {
      setError('Failed to verify keys. Is the server running?');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-neutral-950 flex flex-col items-center justify-center p-4">
      <div className="max-w-md w-full bg-neutral-900 border border-neutral-800 rounded-2xl p-8 flex flex-col gap-6 shadow-2xl">
        <div className="w-12 h-12 bg-blue-500/10 rounded-xl flex items-center justify-center text-blue-500 mb-2">
          <KeyRound size={24} />
        </div>
        
        <div>
          <h1 className="text-2xl font-bold text-white mb-2">Welcome to AI Trader</h1>
          <p className="text-neutral-400 text-sm">
            Enter your API keys to enable the AI technical analysis agent. We recommend providing a Groq key as a fallback in case you hit Gemini rate limits.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          {/* Gemini Key */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-neutral-500 uppercase tracking-wider flex justify-between">
              <span>Google Gemini Key</span>
              <span className="text-blue-500 font-normal">Primary</span>
            </label>
            <input
              type="password"
              value={geminiKey}
              onChange={(e) => setGeminiKey(e.target.value)}
              placeholder="AIzaSy..."
              className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-4 py-3 text-neutral-200 outline-none focus:border-blue-500 transition-colors"
            />
          </div>

          {/* Groq Key */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-neutral-500 uppercase tracking-wider flex justify-between items-center">
              <span className="flex items-center gap-1.5"><Zap size={12} className="text-amber-500"/> Groq API Key</span>
              <span className="text-amber-500 font-normal">Fallback (Free)</span>
            </label>
            <p className="text-[10px] text-neutral-500 leading-tight">Get a fast, free key at <a href="https://console.groq.com/" target="_blank" rel="noreferrer" className="text-blue-500 underline">console.groq.com</a> if you hit quota limits.</p>
            <input
              type="password"
              value={groqKey}
              onChange={(e) => setGroqKey(e.target.value)}
              placeholder="gsk_..."
              className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-4 py-3 text-neutral-200 outline-none focus:border-amber-500 transition-colors"
            />
          </div>
          
          {error && (
            <p className="text-red-500 text-sm bg-red-500/10 px-3 py-2 rounded-lg">{error}</p>
          )}

          <button
            type="submit"
            disabled={(!geminiKey.trim() && !groqKey.trim()) || isLoading}
            className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:hover:bg-blue-600 text-white font-semibold py-3 rounded-lg flex items-center justify-center gap-2 transition-colors mt-2"
          >
            {isLoading ? 'Verifying...' : 'Start Trading'}
            {!isLoading && <ArrowRight size={18} />}
          </button>
        </form>
      </div>
    </div>
  );
}
"""

with open('src/components/ApiKeyScreen.tsx', 'w') as f:
    f.write(content)
