import React, { useState, useEffect } from 'react';
import { KeyRound, ArrowRight, Zap } from 'lucide-react';

interface Props {
  onValidKey: (geminiKey: string, groqKey: string) => void;
  onClose?: () => void;
  initialGemini?: string;
  initialGroq?: string;
}

export default function ApiKeyScreen({ onValidKey, onClose, initialGemini = '', initialGroq = '' }: Props) {
  const [geminiKey, setGeminiKey] = useState(initialGemini);
  const [groqKey, setGroqKey] = useState(initialGroq);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [statusLog, setStatusLog] = useState<string>('');
  const [successMsg, setSuccessMsg] = useState('');


  useEffect(() => {
    let interval: any;
    if (isLoading) {
      const statuses = [
        "Connecting to AI Providers...",
        "Testing Gemini-3.6-Flash...",
        "Testing Gemini-2.5-Flash...",
        "Testing Groq Llama-3.3-70B...",
        "Testing Groq Llama-3.1-8B...",
        "Verifying capabilities..."
      ];
      let i = 0;
      setStatusLog(statuses[0]);
      interval = setInterval(() => {
        i++;
        if (i < statuses.length) setStatusLog(statuses[i]);
      }, 800);
    } else {
      setStatusLog('');
    }
    return () => clearInterval(interval);
  }, [isLoading]);

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
        setSuccessMsg(`Connected successfully via ${data.provider} (${data.model})`);
        setTimeout(() => {
          onValidKey(geminiKey.trim(), groqKey.trim());
        }, 1500);
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
    <div className="w-full max-w-md bg-neutral-900 border border-neutral-800 rounded-2xl p-8 flex flex-col gap-6 shadow-2xl relative">
        
        {onClose && (
          <button onClick={onClose} className="absolute top-4 right-4 text-neutral-500 hover:text-neutral-300">
            ✕
          </button>
        )}

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
          
          {isLoading && (
            <div className="bg-blue-500/10 border border-blue-500/20 px-4 py-3 rounded-lg flex items-center gap-3">
              <div className="w-4 h-4 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
              <p className="text-blue-400 text-sm font-medium">{statusLog}</p>
            </div>
          )}
          
          {successMsg && !isLoading && (
            <div className="bg-green-500/10 border border-green-500/20 px-4 py-3 rounded-lg flex items-center gap-3">
              <Zap size={16} className="text-green-500" />
              <p className="text-green-400 text-sm font-medium">{successMsg}</p>
            </div>
          )}

          {error && (
            <div className="bg-red-500/10 border border-red-500/20 p-4 rounded-lg flex flex-col gap-2 max-h-48 overflow-y-auto">
              <p className="text-red-500 text-sm font-bold">Verification Failed:</p>
              <pre className="text-red-400 text-xs whitespace-pre-wrap font-mono">{error}</pre>
            </div>
          )}

          <button
            type="submit"
            disabled={(!geminiKey.trim() && !groqKey.trim()) || isLoading}
            className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:hover:bg-blue-600 text-white font-semibold py-3 rounded-lg flex items-center justify-center gap-2 transition-colors mt-2"
          >
            {isLoading ? 'Verifying...' : 'Verify & Save'}
            {!isLoading && <ArrowRight size={18} />}
          </button>
        </form>
    </div>
  );
}
