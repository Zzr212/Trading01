import * as tf from '@tensorflow/tfjs';

export class TradePredictor {
  private model: tf.Sequential;
  private isTrained: boolean = false;
  private trainingData: { features: number[], label: number }[] = [];

  constructor() {
    this.model = tf.sequential();
    // Features: [RSI, MACD, Price_EMA9_Diff, Price_EMA21_Diff, IsLong (1 or 0), MacroBullish (1 or 0)]
    this.model.add(tf.layers.dense({ units: 16, inputShape: [6], activation: 'relu' }));
    this.model.add(tf.layers.dense({ units: 8, activation: 'relu' }));
    this.model.add(tf.layers.dense({ units: 1, activation: 'sigmoid' }));

    this.model.compile({
      optimizer: tf.train.adam(0.01),
      loss: 'binaryCrossentropy',
      metrics: ['accuracy']
    });
    
    // Seed with basic heuristics to give reasonable starting predictions
    this.seedInitialData();
  }
  
  private seedInitialData() {
    // Generate synthetic data to bootstrap the model
    // 1 = Win, 0 = Loss
    for(let i=0; i<100; i++) {
        // Good Long: RSI ~45-55, MACD > 0, Price slightly above EMA, Long=1, MacroBullish=1
        this.trainingData.push({ features: [50 + (Math.random()*10 - 5), Math.random(), Math.random(), Math.random(), 1, 1], label: 1 });
        // Bad Long: RSI > 70, Long=1
        this.trainingData.push({ features: [75 + (Math.random()*10), -Math.random(), -Math.random(), -Math.random(), 1, 0], label: 0 });
        // Good Short: RSI ~45-55, MACD < 0, Price slightly below EMA, Long=0, MacroBullish=0
        this.trainingData.push({ features: [50 + (Math.random()*10 - 5), -Math.random(), -Math.random(), -Math.random(), 0, 0], label: 1 });
        // Bad Short: RSI < 30, Long=0
        this.trainingData.push({ features: [25 - (Math.random()*10), Math.random(), Math.random(), Math.random(), 0, 1], label: 0 });
    }
    
    this.trainModel();
  }

  public async recordResultAndTrain(features: number[], result: 'WON' | 'LOST') {
    this.trainingData.push({
      features,
      label: result === 'WON' ? 1 : 0
    });
    
    // Keep max 1000 memory points
    if (this.trainingData.length > 1000) {
        this.trainingData.shift();
    }
    
    // Retrain every 5 trades
    if (this.trainingData.length % 5 === 0) {
       await this.trainModel();
    }
  }

  private async trainModel() {
    if (this.trainingData.length === 0) return;
    
    const features = this.trainingData.map(d => d.features);
    const labels = this.trainingData.map(d => d.label);

    const xs = tf.tensor2d(features);
    const ys = tf.tensor2d(labels, [labels.length, 1]);

    await this.model.fit(xs, ys, {
      epochs: 10,
      batchSize: 32,
      shuffle: true,
      verbose: 0
    });

    xs.dispose();
    ys.dispose();
    this.isTrained = true;
    console.log(`[TF.js] AI Model updated. Memory size: ${this.trainingData.length} trades.`);
  }

  public getStatus() {
    return {
      status: this.isTrained ? 'ACTIVE' : 'INITIALIZING',
      backend: tf.getBackend(),
      memorySize: this.trainingData.length,
      layers: this.model.layers.length,
      isTrained: this.isTrained,
    };
  }

  public predict(features: number[]): number {
    if (!this.isTrained) return 50; 
    try {
        const input = tf.tensor2d([features]);
        const prediction = this.model.predict(input) as tf.Tensor;
        const value = prediction.dataSync()[0];
        input.dispose();
        prediction.dispose();
        
        // Scale 0.0 - 1.0 to 1 - 99
        let conf = Math.round(value * 100);
        return Math.max(1, Math.min(99, conf));
    } catch(e) {
        return 50;
    }
  }
}
