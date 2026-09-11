import re

with open('server.ts', 'r') as f:
    content = f.read()

# Remove genai import
content = re.sub(r'import \{ GoogleGenAI \} from "@google/genai";\n', "", content)

# Remove callAIWithFallback function entirely
call_ai = r"async function callAIWithFallback.*?throw new Error.*?\}\n\}\n"
content = re.sub(call_ai, "", content, flags=re.DOTALL)

# Remove /api/verify-key
verify_key = r"  app\.post\(\"/api/verify-key\".*?\}\);\n"
content = re.sub(verify_key, "", content, flags=re.DOTALL)

# Remove /api/analyze-sr
analyze_sr = r"  app\.post\(\"/api/analyze-sr\".*?\}\);\n"
content = re.sub(analyze_sr, "", content, flags=re.DOTALL)

# Remove /api/analyze
analyze = r"  app\.post\(\"/api/analyze\".*?\}\);\n"
content = re.sub(analyze, "", content, flags=re.DOTALL)

with open('server.ts', 'w') as f:
    f.write(content)
