# Digitaler Zwilling – DWG/DXF Viewer

Ein komplett quelloffenes, portables Werkzeug: Nutzer laden eine **DWG-** oder **DXF-Datei**
hoch und erhalten ein drehbares **3D-Modell**, das nach Layern gefiltert und angeklickt werden
kann. Alles läuft in **einem Docker-Container** – auf deiner eigenen Hardware oder auf einer
kostenlosen Cloud-VM. Keine kostenpflichtigen Dienste, kein Lock-in.

## Wie es aufgebaut ist

Der Container enthält beides in einem:

* **Frontend** (`frontend/`) – Upload-Oberfläche + 3D-Viewer (läuft im Browser des Nutzers).
  DXF wird direkt im Browser gelesen.
* **Konverter-Backend** (`server/`) – ein schlanker Node-Server. Er liefert das Frontend aus
  und wandelt hochgeladene **DWG** mit **LibreDWG** (`dwg2dxf`, GPL) in DXF um.

Der teilbare Internet-Link ist damit einfach die Adresse dieses einen Containers. GitHub dient
nur als **Ablage für den Code**, aus der die VM ihn zieht – GitHub selbst führt nichts aus.

```
  Nutzer-Browser ──►  http://<deine-vm>            (ein Link, den du verschickst)
                        │
                        ▼
              ┌────────────────────────┐
              │  Docker-Container       │
              │  ├─ Node-Server (Port 3000)
              │  ├─ Frontend (3D-Viewer)
              │  └─ LibreDWG (dwg2dxf)  │
              └────────────────────────┘
```

---

## Schnelltest auf deinem eigenen Rechner (optional)

Wenn Docker installiert ist:

```bash
docker build -t dwg-zwilling .
docker run -p 8080:3000 dwg-zwilling
# Browser öffnen: http://localhost:8080  ->  "Beispiel ansehen" oder eigene Datei laden
```

Ohne Docker, nur das Frontend (DXF-Teil, ohne DWG-Umwandlung):

```bash
npm install
npm start          # http://localhost:3000
npm test           # führt den DXF-Parser-Test aus
```

---

## Deployment auf einer kostenlosen Oracle-Cloud-VM (Always Free)

Oracle Cloud stellt dauerhaft gratis eine echte, immer laufende Linux-VM bereit. Das reicht für
dieses Werkzeug locker aus. Rechne mit ~20–30 Minuten beim ersten Mal.

### Schritt 1 – Code auf GitHub ablegen
1. Neues (privates oder öffentliches) Repository auf GitHub anlegen, z. B. `dwg-zwilling`.
2. Den Inhalt dieses Ordners hochladen bzw. pushen:
   ```bash
   git init && git add . && git commit -m "Initial"
   git branch -M main
   git remote add origin https://github.com/<DEIN-NAME>/dwg-zwilling.git
   git push -u origin main
   ```

### Schritt 2 – VM anlegen
1. Bei <https://cloud.oracle.com> registrieren (Kreditkarte nur zur Verifikation; „Always Free"
   kostet nichts).
2. **Menu → Compute → Instances → Create Instance**.
3. Image & Shape:
   * Image: **Canonical Ubuntu 22.04**
   * Shape: **Ampere (ARM) VM.Standard.A1.Flex** – im „Always Free"-Kontingent
     (z. B. 1–2 OCPU, 6–12 GB RAM). *(Alternativ „VM.Standard.E2.1.Micro", x86.)*
4. **SSH-Keys**: den angebotenen privaten Schlüssel herunterladen (oder eigenen public key
   hinterlegen). Gut aufbewahren.
5. Instanz erstellen und die **öffentliche IP-Adresse** notieren.

### Schritt 3 – Port 80 freigeben (zwei Stellen!)
1. **In der Oracle-Konsole**: bei der Instanz auf das **Subnet → Security List → Add Ingress
   Rule**:
   * Source CIDR: `0.0.0.0/0`
   * IP Protocol: **TCP**, Destination Port: **80** (und optional **443**).
2. **Auf der VM selbst** (Ubuntu-Firewall), nach dem Einloggen (Schritt 4):
   ```bash
   sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
   sudo netfilter-persistent save   # falls vorhanden
   ```

### Schritt 4 – Einloggen und Docker installieren
```bash
ssh -i /pfad/zum/key ubuntu@<PUBLIC-IP>

# Docker installieren
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu
# einmal aus- und wieder einloggen, damit die Gruppe greift
exit
ssh -i /pfad/zum/key ubuntu@<PUBLIC-IP>
```

### Schritt 5 – App holen, bauen, starten
```bash
sudo apt-get update && sudo apt-get install -y git
git clone https://github.com/<DEIN-NAME>/dwg-zwilling.git
cd dwg-zwilling

docker build -t dwg-zwilling .        # baut auch LibreDWG (dauert beim 1. Mal einige Minuten)
docker run -d --restart unless-stopped -p 80:3000 --name zwilling dwg-zwilling
```

### Schritt 6 – Testen
Im Browser `http://<PUBLIC-IP>` öffnen. „Beispiel ansehen" oder eine eigene DXF/DWG hochladen.
**Diesen Link kannst du jetzt an andere verschicken.**

---

## Optional: schöner Link mit HTTPS

Eine reine IP mit `http://` funktioniert, ist aber unschön und ohne Verschlüsselung. Zwei
kostenlose Wege:

* **Cloudflare Tunnel** – kostenlos, keine Portfreigabe nötig, liefert automatisch HTTPS und
  eine `*.trycloudflare.com`- oder deine eigene Domain. Ideal, wenn du die VM nicht direkt aus
  dem Netz erreichbar machen willst.
* **Caddy** als Reverse-Proxy vor dem Container – holt automatisch ein Let's-Encrypt-Zertifikat,
  wenn du eine (auch kostenlose) Domain auf die IP zeigen lässt.

Sag Bescheid, dann ergänze ich die passende Konfiguration.

---

## Aktualisieren

```bash
cd dwg-zwilling && git pull
docker build -t dwg-zwilling .
docker rm -f zwilling
docker run -d --restart unless-stopped -p 80:3000 --name zwilling dwg-zwilling
```

---

## Fehlerbehebung

* **DWG lässt sich nicht umwandeln** – LibreDWG unterstützt sehr neue/exotische DWG-Versionen
  nicht immer vollständig. Als Ausweg die Datei im CAD als **DXF** speichern (funktioniert
  garantiert) oder alternativ den *ODA File Converter* im Container einsetzen (kostenlos
  nutzbar, robuster; sag Bescheid, dann baue ich die Variante).
* **`dwg2dxf` fehlt beim Build** – der Build von LibreDWG braucht Netz. Auf der VM ist das
  gegeben. Alternativ zum Quellcode-Build lässt sich in vielen Distributionen
  `apt-get install libredwg-tools` nutzen.
* **Seite nicht erreichbar** – fast immer die Portfreigabe: beide Stellen aus Schritt 3 prüfen
  (Oracle Security List **und** iptables auf der VM).
* **ARM vs. x86** – das Dockerfile baut auf beiden Architekturen; die verwendeten Node- und
  Debian-Images sind Multi-Arch.

## Kosten

LibreDWG, Docker, das Frontend und der Server sind kostenlos/quelloffen. Die Oracle-„Always
Free"-VM ist dauerhaft gratis. Es entstehen keine laufenden Kosten.

## Lizenz / Herkunft
Eigenentwicklung (MIT) + LibreDWG (GPL, als externes Tool aufgerufen), Three.js (MIT).
