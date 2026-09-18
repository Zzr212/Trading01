#!/usr/bin/env python3
"""
Skripta za automatsko ažuriranje MetaTrader 5 Bridge-a na Oracle VPS serveru.
Pokretanje: python3 update_oracle_mt5.py
"""
import os
import sys
import subprocess
import urllib.request
import tarfile

LIVE_TUNNEL_URL = "https://marvel-epinions-conditional-suspected.trycloudflare.com"

print("="*60)
print(">>> AŽURIRANJE AI TRADER MT5 BRIDGE NA ORACLE VPS <<<")
print("="*60)

bundle_url = f"{LIVE_TUNNEL_URL}/api/download/bundle.tar.gz"
archive_name = "bundle.tar.gz"

try:
    print(f"[*] Preuzimanje ažuriranih fajlova sa Cloudflare tunela...")
    urllib.request.urlretrieve(bundle_url, archive_name)
    
    if os.path.exists(archive_name) and os.path.getsize(archive_name) > 5000:
        print(f"[+] Paket uspešno preuzet ({os.path.getsize(archive_name)} bajtova).")
        print(f"[*] Raspakivanje fajlova (server.ts, bot.ts, src/...)...")
        with tarfile.open(archive_name, "r:gz") as tar:
            tar.extractall(".")
        print(f"[+] Svi fajlovi uspešno ažurirani!")
        os.remove(archive_name)
        
        print("\n" + "="*60)
        print("USPEH: server.ts, bot.ts i MT5 bridge su ažurirani na Oracle serveru!")
        print("Sada samo restartujte server:")
        print("   npm run dev    (ili restartujte vaš pm2 proces)")
        print("="*60)
    else:
        print("[-] Preuzeti fajl je premali ili oštećen.")
except Exception as e:
    print(f"[-] Greška prilikom automatskog preuzimanja: {e}")
    print("\nAlternativa: Možete preuzeti ZIP iz Google AI Studio projekta i prekopirati fajlove.")
