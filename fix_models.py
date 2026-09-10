import re

with open('server.ts', 'r') as f:
    content = f.read()

# Update the models in server.ts
old_models_declaration = """  const geminiModels = ["gemini-2.5-flash", "gemini-2.5-pro"];
  const groqModels = ["llama-3.3-70b-versatile", "llama3-8b-8192", "mixtral-8x7b-32768"];"""

new_models_declaration = """  const geminiModels = ["gemini-3.6-flash", "gemini-2.5-flash", "gemini-2.5-pro"];
  const groqModels = ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "mixtral-8x7b-32768"];"""

content = content.replace(old_models_declaration, new_models_declaration)

with open('server.ts', 'w') as f:
    f.write(content)

with open('src/components/ApiKeyScreen.tsx', 'r') as f:
    content_screen = f.read()

old_status = """      const statuses = [
        "Connecting to AI Providers...",
        "Testing Gemini-2.5-Flash...",
        "Testing Gemini-2.5-Pro...",
        "Testing Groq Llama-3.3-70B...",
        "Testing Groq Llama-8B...",
        "Verifying capabilities..."
      ];"""

new_status = """      const statuses = [
        "Connecting to AI Providers...",
        "Testing Gemini-3.6-Flash...",
        "Testing Gemini-2.5-Flash...",
        "Testing Groq Llama-3.3-70B...",
        "Testing Groq Llama-3.1-8B...",
        "Verifying capabilities..."
      ];"""

content_screen = content_screen.replace(old_status, new_status)

with open('src/components/ApiKeyScreen.tsx', 'w') as f:
    f.write(content_screen)
