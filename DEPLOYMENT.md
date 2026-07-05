# Self-hosting Kane's backend (e.g. on a home GPU workstation)

This is a plan for running Kane's backend on your own hardware — written with a
Dell T7810 in mind (Xeon E5-2678 v3, RTX 3060 12GB for compute, FirePro for
display), but the steps are the same for any always-on Linux box with an
NVIDIA GPU. Goal: GPU-accelerated local inference (fixes the CPU-only latency
documented in the project's own notes — 1-8s observed) plus safe public
reachability for real users, without port-forwarding your home router.

## 1. Base OS + GPU driver

Ubuntu Server 22.04/24.04 LTS is the path of least resistance for NVIDIA driver
support.

```bash
sudo ubuntu-drivers autoinstall   # picks the right NVIDIA driver automatically
sudo reboot
nvidia-smi                        # should list the RTX 3060
```

The FirePro doesn't need anything special — the kernel's open-source `amdgpu`
driver handles display output on its own, leaving the 3060 entirely free for
compute (no display compositing competing for VRAM/cycles).

## 2. Ollama with GPU acceleration

```bash
curl -fsSL https://ollama.com/install.sh | sh
ollama pull gemma2:2b
ollama pull qwen2.5:0.5b   # the background fact-extraction model
```

Ollama auto-detects an available NVIDIA GPU via CUDA — no config needed. Verify
it's actually using the GPU (not silently falling back to CPU):

```bash
ollama run gemma2:2b "hello"   # while this runs, in another shell:
nvidia-smi                     # should show a python/ollama process using VRAM
```

**Worth reconsidering now that GPU headroom exists**: the project picked
`gemma2:2b` specifically because it was one of the few small *CPU-friendly*
models that passed the reliability benchmarks (`backend/benchmark.mjs`). With
12GB VRAM, a larger model (`qwen2.5:7b`, `llama3.1:8b`) becomes viable and
would likely improve the LLM highlight-marker protocol's ~75% hit rate. Re-run
`benchmark.mjs` against a candidate before switching — don't assume bigger is
automatically better for this specific narrow task without checking.

## 3. Kane's backend as a systemd service

```bash
git clone https://github.com/808cadger/kane-avatar.git /opt/kane-avatar
cd /opt/kane-avatar/backend && npm install
```

`/opt/kane-avatar/backend/.env`:
```
KANE_PROVIDER=ollama
OLLAMA_BASE_URL=http://127.0.0.1:11434
KANE_MODEL=gemma2:2b
PORT=8787
# Restrict to GlowAI's real origin(s) — do NOT leave this unset in production,
# the backend defaults to allowing any origin otherwise.
KANE_ALLOWED_ORIGINS=https://glowai.app,https://www.glowai.app
```

`/etc/systemd/system/kane-backend.service`:
```ini
[Unit]
Description=Kane backend
After=network.target

[Service]
WorkingDirectory=/opt/kane-avatar/backend
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=3
User=kane

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now kane-backend
sudo systemctl status kane-backend
curl http://127.0.0.1:8787/health
```

## 4. Frontend: build the real static bundle, don't serve the dev server

```bash
cd /opt/kane-avatar && npm install
npm run build:embed   # produces dist/kane.js — a single-file IIFE bundle
```

Serve `dist/kane.js` + the avatar model file (`public/kane-avatar-female.vrm`)
as static assets from wherever GlowAI's own static assets already live —
simplest is directly off this same box via the same reverse-proxy/tunnel setup
below, at a separate path (e.g. `/kane/kane.js`, `/kane/kane-avatar-female.vrm`).

## 5. Public reachability: Cloudflare Tunnel (recommended over port-forwarding)

Traditional port-forwarding means your home router exposes an inbound port
directly to the internet — real attack surface, plus most residential IPs are
dynamic. A tunnel avoids both: `cloudflared` makes an **outbound** connection
to Cloudflare's edge, so nothing needs to listen on a public port at all, and
TLS is handled automatically. Requires a domain added to Cloudflare (free).

```bash
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared
chmod +x /usr/local/bin/cloudflared
cloudflared tunnel login
cloudflared tunnel create kane
```

`~/.cloudflared/config.yml`:
```yaml
tunnel: kane
credentials-file: /root/.cloudflared/<tunnel-id>.json
ingress:
  - hostname: kane-api.yourdomain.com
    service: http://localhost:8787
  - hostname: kane-static.yourdomain.com
    service: http://localhost:8080   # wherever you serve dist/kane.js + the model
  - service: http_status:404
```

```bash
cloudflared tunnel route dns kane kane-api.yourdomain.com
cloudflared tunnel route dns kane kane-static.yourdomain.com
sudo cloudflared service install
sudo systemctl enable --now cloudflared
```

Then in GlowAI's real `index.html` (not the sandbox copy):
```html
<script src="https://kane-static.yourdomain.com/kane.js"
        data-backend="https://kane-api.yourdomain.com"
        data-mode="corner" data-position="bottom-left"
        data-model="https://kane-static.yourdomain.com/kane-avatar-female.vrm"></script>
```
And extend GlowAI's CSP `connect-src` to include `https://kane-api.yourdomain.com`
(same fix already applied in the `glowai-kane-sandbox` proof — see that repo's
`index.html` for the pattern).

**Alternative**: Tailscale Funnel is simpler to set up (no custom domain
required, uses a `*.ts.net` subdomain) but has tighter bandwidth/reliability
limits — reasonable for testing with a handful of users, not recommended
once this needs to handle real traffic.

## 6. Security hardening

- With Cloudflare Tunnel, **no inbound ports need to be open at all** — leave
  the router/firewall closed by default.
- SSH access to the box itself: prefer Tailscale (a private mesh VPN) over
  exposing SSH to the internet directly.
- `sudo apt install unattended-upgrades` for automatic security patches.
- Enable UFW and default-deny inbound: `sudo ufw default deny incoming`.

## 7. Reliability

- All three services (`ollama`, `kane-backend`, `cloudflared`) should be
  systemd units with `Restart=always` (Ollama's own installer already sets
  this up; the unit file above does it for `kane-backend`).
- A free uptime monitor (UptimeRobot, Better Uptime) hitting
  `https://kane-api.yourdomain.com/health` every few minutes gives you an
  alert if the box, the tunnel, or the backend goes down — cheap insurance
  for a home-hosted service with no redundancy.
- A UPS is worth it if home power reliability is a concern — an unplanned
  reboot mid-request is a worse failure mode than a clean restart.

## What this doesn't solve

This is a legitimate, cost-effective way to serve early/beta traffic — not a
replacement for real infrastructure at scale (no redundancy, bounded by home
upload bandwidth, single point of failure). Revisit if/when concurrent usage
outgrows what one box and one home internet connection can serve.
