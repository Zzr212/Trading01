with open('bot.ts', 'r') as f:
    content = f.read()

# Replace "    }  }}  public getDiagnostics() {" with "    }  }\n\n  public getDiagnostics() {"
content = content.replace("    }  }}  public getDiagnostics() {", "    }\n  }\n\n  public getDiagnostics() {")

with open('bot.ts', 'w') as f:
    f.write(content)
print("Fixed closing brace in bot.ts")
