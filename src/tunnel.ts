import { spawn, ChildProcess } from 'child_process';
import fs from 'fs';

let currentTunnelUrl: string = '';
let tunnelProcess: ChildProcess | null = null;
let onUrlChangeCallbacks: Array<(url: string) => void> = [];

export function getTunnelUrl(): string {
  return currentTunnelUrl;
}

export function onTunnelUrlChange(cb: (url: string) => void) {
  onUrlChangeCallbacks.push(cb);
  if (currentTunnelUrl) {
    cb(currentTunnelUrl);
  }
}

export async function startCloudflareTunnel(port = 3000): Promise<string> {
  const binaryPath = '/tmp/cloudflared';

  // Ensure cloudflared binary is available
  if (!fs.existsSync(binaryPath)) {
    console.log('[Tunnel] Downloading cloudflared binary...');
    try {
      const { execSync } = await import('child_process');
      execSync(`curl -sL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o ${binaryPath} && chmod +x ${binaryPath}`);
      console.log('[Tunnel] Cloudflared downloaded successfully.');
    } catch (e: any) {
      console.error('[Tunnel] Failed to download cloudflared:', e.message);
      return '';
    }
  }

  return new Promise((resolve) => {
    let resolved = false;

    // Check if an existing tunnel process is running
    if (tunnelProcess) {
      try { tunnelProcess.kill(); } catch (_) {}
    }

    console.log('[Tunnel] Launching Cloudflare quick tunnel for port', port);
    tunnelProcess = spawn(binaryPath, ['tunnel', '--protocol', 'http2', '--url', `http://localhost:${port}`]);

    const handleOutput = (data: Buffer) => {
      const text = data.toString();
      const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (match && match[0]) {
        currentTunnelUrl = match[0];
        console.log('[Tunnel] Live public MT5 endpoint established:', currentTunnelUrl);
        onUrlChangeCallbacks.forEach(cb => cb(currentTunnelUrl));
        if (!resolved) {
          resolved = true;
          resolve(currentTunnelUrl);
        }
      }
    };

    tunnelProcess.stdout?.on('data', handleOutput);
    tunnelProcess.stderr?.on('data', handleOutput);

    tunnelProcess.on('exit', (code) => {
      console.log('[Tunnel] Process exited with code', code, '- scheduling restart in 5s...');
      setTimeout(() => {
        startCloudflareTunnel(port).catch(() => {});
      }, 5000);
    });

    // Timeout fallback after 15s
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve(currentTunnelUrl);
      }
    }, 15000);
  });
}
