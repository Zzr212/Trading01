import re

with open('server.ts', 'r') as f:
    content = f.read()

fallback_func_old = re.search(r"async function callAIWithFallback.*?throw new Error\(`All AI providers failed.*?`\);\n\}", content, re.DOTALL)

if fallback_func_old:
    new_func = """async function callAIWithFallback(geminiKey: string | undefined, groqKey: string | undefined, prompt: string, isJson = true) {
  let errors: string[] = [];
  
  const geminiModels = ["gemini-2.5-flash", "gemini-2.5-pro"];
  const groqModels = ["llama-3.3-70b-versatile", "llama3-8b-8192", "mixtral-8x7b-32768"];

  if (geminiKey) {
    const ai = new GoogleGenAI({ apiKey: geminiKey });
    for (const model of geminiModels) {
      try {
        const response = await ai.models.generateContent({
          model: model,
          contents: prompt,
          config: isJson ? { responseMimeType: "application/json" } : undefined
        });
        return { text: response.text, provider: 'Gemini', model };
      } catch (e: any) {
        console.warn(`Gemini (${model}) failed: ${e.message}`);
        errors.push(`Gemini ${model}: ${e.message}`);
      }
    }
  }

  if (groqKey) {
    for (const model of groqModels) {
      try {
        const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${groqKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: model,
            messages: [{ role: "user", content: prompt }],
            response_format: isJson ? { type: "json_object" } : undefined
          })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || "Groq API Error");
        return { text: data.choices[0].message.content, provider: 'Groq', model };
      } catch (e: any) {
        console.warn(`Groq (${model}) failed: ${e.message}`);
        errors.push(`Groq ${model}: ${e.message}`);
      }
    }
  }
  
  throw new Error(`All models failed.\\nAttempts:\\n${errors.join('\\n')}`);
}"""
    content = content.replace(fallback_func_old.group(0), new_func)
    
    # Update analyze endpoints to use text property from new return format
    content = content.replace("const text = await callAIWithFallback(", "const { text } = await callAIWithFallback(")
    
    # Update verify-key to return logs
    old_verify = """  app.post("/api/verify-key", async (req, res) => {
    const geminiKey = req.headers['x-gemini-key'] as string;
    const groqKey = req.headers['x-groq-key'] as string;
    
    if (!geminiKey && !groqKey) return res.status(401).json({ error: "No keys provided" });
    
    try {
      await callAIWithFallback(geminiKey, groqKey, "Respond with exactly 'ok'.", false);
      res.json({ valid: true });
    } catch (e: any) {
      res.status(400).json({ valid: false, error: e.message || "Invalid keys or Quota exceeded." });
    }
  });"""
    new_verify = """  app.post("/api/verify-key", async (req, res) => {
    const geminiKey = req.headers['x-gemini-key'] as string;
    const groqKey = req.headers['x-groq-key'] as string;
    
    if (!geminiKey && !groqKey) return res.status(401).json({ error: "No keys provided" });
    
    try {
      const { provider, model } = await callAIWithFallback(geminiKey, groqKey, "Respond with exactly 'ok'.", false);
      res.json({ valid: true, provider, model });
    } catch (e: any) {
      res.status(400).json({ valid: false, error: e.message });
    }
  });"""
    content = content.replace(old_verify, new_verify)

    with open('server.ts', 'w') as f:
        f.write(content)
else:
    print("Could not find fallback function")
