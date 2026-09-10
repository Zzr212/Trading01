import re

with open('src/components/ApiKeyScreen.tsx', 'r') as f:
    content = f.read()

# Add states for status
imports = "import React, { useState, useEffect } from 'react';"
content = content.replace("import React, { useState } from 'react';", imports)

new_states = """  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [statusLog, setStatusLog] = useState<string>('');
  const [successMsg, setSuccessMsg] = useState('');"""
content = content.replace("  const [isLoading, setIsLoading] = useState(false);\n  const [error, setError] = useState('');", new_states)

# Add fake progress effect
effect = """
  useEffect(() => {
    let interval: any;
    if (isLoading) {
      const statuses = [
        "Connecting to AI Providers...",
        "Testing Gemini-2.5-Flash...",
        "Testing Gemini-2.5-Pro...",
        "Testing Groq Llama-3.3-70B...",
        "Testing Groq Llama-8B...",
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
"""

# Find handleSubmit to insert effect before it
content = content.replace("  const handleSubmit = async (e: React.FormEvent) => {", effect + "\n  const handleSubmit = async (e: React.FormEvent) => {")

# Update handleSubmit
old_submit = """      const data = await res.json();
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
  };"""

new_submit = """      const data = await res.json();
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
  };"""
content = content.replace(old_submit, new_submit)

# Update UI to show status
old_error = """          {error && (
            <p className="text-red-500 text-sm bg-red-500/10 px-3 py-2 rounded-lg">{error}</p>
          )}"""

new_error = """          {isLoading && (
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
          )}"""
content = content.replace(old_error, new_error)

with open('src/components/ApiKeyScreen.tsx', 'w') as f:
    f.write(content)
