import re

with open('src/components/CandlestickChart.tsx', 'r') as f:
    content = f.read()

watermark_code = """    ctx.clearRect(0, 0, width, height);

    // Draw Watermark
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '900 120px sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.025)';
    ctx.fillText('TradingView', width / 2, height / 2);
    ctx.restore();"""

content = content.replace("    ctx.clearRect(0, 0, width, height);", watermark_code)

with open('src/components/CandlestickChart.tsx', 'w') as f:
    f.write(content)
