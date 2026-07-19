# ============================================================
#  Digitaler Zwilling - DWG/DXF Viewer + LibreDWG-Konverter
#  Ein Container: Node-Server + LibreDWG (dwg2dxf)
#  Multi-Arch: baut auch auf ARM (Oracle Always Free / Ampere)
# ============================================================
FROM node:20-bookworm-slim

# --- 1) LibreDWG (Open Source, GPL) aus Quellcode bauen ---
#     liefert das Kommandozeilen-Tool "dwg2dxf"
RUN apt-get update && apt-get install -y --no-install-recommends \
      git build-essential autoconf automake libtool pkg-config \
      texinfo gperf perl python3 ca-certificates curl \
 && curl -fsSL https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js -o /opt/three.min.js \
 && rm -rf /var/lib/apt/lists/*

RUN git clone --depth 1 https://github.com/LibreDWG/libredwg.git /tmp/libredwg \
 && cd /tmp/libredwg \
 && sh autogen.sh \
 && ./configure --disable-bindings \
 && make -j"$(nproc)" \
 && make install \
 && ldconfig \
 && cd / && rm -rf /tmp/libredwg \
 && dwg2dxf --version

# --- 2) Anwendung ---
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY server ./server
COPY frontend ./frontend
# Three.js lokal einbinden (wird beim Build heruntergeladen -> keine externe CDN-Abhängigkeit zur Laufzeit)
RUN cp /opt/three.min.js /app/frontend/three.min.js

# Datenverzeichnis für dauerhaft gespeicherte Standortmodelle.
# Wird beim Start als Docker-Volume eingehängt (-v zwilling-data:/data),
# damit die Daten Rebuilds und Neustarts überstehen.
ENV DATA_DIR=/data
RUN mkdir -p /data

ENV PORT=3000
EXPOSE 3000
CMD ["node", "server/server.js"]
