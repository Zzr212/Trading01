import React, { useState } from 'react';
import { KeyRound, ArrowRight } from 'lucide-react';

interface Props {
  onValidKey: (key: string) => void;
}

export default function ApiKeyScreen({ onValidKey }: Props) {
  const [key, setKey] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!key.trim()) return;
    
    setIsLoading(true);
    setError('');
    
    try {
      const res = await fetch('/api/verify-key', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${key}` }
      });
      
      const data = await res.json();
      if (data.valid) {
        onValidKey(key);
      } else {
        setError(data.error || 'Invalid API Key');
      }
    } catch (err) {
      setError('Failed to verify key. Is the server running?');
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
            Please enter your Google Gemini API Key to enable the AI technical analysis agent. This key will be stored securely in your browser and used only for trading analysis.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">
              Gemini API Key
            </label>
            <input
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="AIzaSy..."
              className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-4 py-3 text-neutral-200 outline-none focus:border-blue-500 transition-colors"
            />
          </div>
          
          {error && (
            <p className="text-red-500 text-sm bg-red-500/10 px-3 py-2 rounded-lg">{error}</p>
          )}

          <button
            type="submit"
            disabled={!key.trim() || isLoading}
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
