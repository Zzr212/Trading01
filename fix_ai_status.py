with open('src/lib/ai.ts', 'r') as f:
    content = f.read()

status_method = """  public getStatus() {
    return {
      status: this.isTrained ? 'ACTIVE' : 'INITIALIZING',
      backend: tf.getBackend(),
      memorySize: this.trainingData.length,
      layers: this.model.layers.length,
      isTrained: this.isTrained,
    };
  }

  public predict(features: number[]): number {"""

content = content.replace("  public predict(features: number[]): number {", status_method)

with open('src/lib/ai.ts', 'w') as f:
    f.write(content)
print("ai.ts updated successfully")
