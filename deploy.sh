#!/usr/bin/env bash
# ============================================================
#  Ein-Klick-Deploy für den Digitalen Zwilling
#  Aufruf auf dem Server:   bash ~/dwg-zwilling/deploy.sh
# ============================================================
set -e
cd ~/dwg-zwilling

echo ">> Hole neueste Version von GitHub ..."
git pull

echo ">> Baue das Tool (DWG-Konverter kommt aus dem Zwischenspeicher) ..."
sudo docker build -t dwg-zwilling .

echo ">> Starte den Container neu ..."
sudo docker rm -f zwilling 2>/dev/null || true
sudo docker run -d --restart unless-stopped -p 80:3000 -v zwilling-data:/data --name zwilling dwg-zwilling

echo ""
echo "FERTIG - das Tool laeuft auf http://130.61.206.186"
echo "(Im Browser mit Strg+F5 neu laden.)"
