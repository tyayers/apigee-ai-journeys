# Apigee AI Demos

Browser-based `xrdp` workstation portal authenticated via **Google Cloud IAP** (or `?user=test@example.com` for direct testing), built on **Bun** and **IronRDP (WebAssembly)**.

## How User Provisioning Works

1. **Identity Resolution**:
   - **Behind GCP IAP**: Reads the authenticated user email from the `X-Goog-Authenticated-User-Email` header (e.g. `accounts.google.com:alice@google.com` -> Linux user `alice`).
   - **Direct / Non-IAP Testing**: Pass `?user=test@example.com` in the URL (`http://localhost:8080/?user=test@example.com` -> Linux user `test`).
2. **Automatic Linux User & Password Management (`./users.yaml`)**:
   - Checks `/etc/passwd` on the VM; if the Linux user does not exist yet, creates it automatically (`useradd -m -s /bin/bash`).
   - Generates a random password for the user, stores all usernames and generated passwords in **`./users.yaml`** (in the directory where the service is started, `chmod 600`), syncs the Linux password via `chpasswd`, and **automatically connects** the browser RDP session without any password prompt.
3. **Live Host VM Telemetry & Capacity Guard (`src/host-metrics.ts`)**:
   - Continuously samples host VM `/proc/stat` and `/proc/meminfo` (exposed on `GET /api/metrics` and displayed live in the header bar and sidebar).
   - If the host VM's **5-minute average CPU utilization is ≥ 70%** (configurable via `MAX_CONNECT_CPU_AVG_5M`), new connections are refused with a clear message instructing the user that no free resources are available and to contact the demo owner for assistance.

## Getting Started (Debian 13 VM)

### 1. Prepare `xrdp` on the GCP VM

Make sure `xrdp` can read its TLS key and **GCP OS Login is disabled** on the instance (OS Login intercepts NSS lookups without `/etc/passwd` entries, which blocks local `xrdp` PAM logins):

```bash
# Allow xrdp to read /etc/xrdp/key.pem for TLS
sudo adduser xrdp ssl-cert
sudo systemctl restart xrdp xrdp-sesman
```

*(If GCP OS Login is enabled on the VM, set metadata `enable-oslogin=FALSE` on the instance.)*

### 2. Optional `.env`

```bash
cp .env.example .env
```

```env
HOST=0.0.0.0
PORT=8080
SESSION_SECRET=replace-with-openssl-rand-hex-32
# Optional: allow WebSocket connections from multiple domains (comma-separated)
# ALLOWED_ORIGINS=https://iap-domain.example.com,https://direct-domain.example.com
# Optional: keep desktop sessions running on disconnect so users can reconnect/resume (default: true; set false for auto-logout)
# KEEP_SESSIONS_RUNNING=true
# Optional: Antigravity enterprise gateway (writes /etc/antigravity/admin_settings.json on startup)
# ANTIGRAVITY_URL=https://your-enterprise-gateway.example.com
# ANTIGRAVITY_KEY=your-gateway-api-key
# Optional: Claude Code gateway/model settings (writes /etc/claude-code/managed-settings.json on startup)
# ANTHROPIC_BASE_URL=https://your-anthropic-gateway.example.com
# ANTHROPIC_AUTH_TOKEN=
# ANTHROPIC_API_KEY=
# ANTHROPIC_DEFAULT_OPUS_MODEL=
# ANTHROPIC_DEFAULT_SONNET_MODEL=
# ANTHROPIC_DEFAULT_HAIKU_MODEL=
# Optional: Apigee Developer Portal per-user coding-agent-app provisioning
# PORTAL_HOST=https://your-apigee-portal-host.example.com
# PORTAL_ADMIN_CLIENT_ID=
# PORTAL_ADMIN_CLIENT_SECRET=
# Optional: sidebar links (in addition to Apigee AI Portal at $PORTAL_HOST/portal)
# PROXY_URL=
# ANALYTICS_URL=
# MONITORING_URL=
```

### 3. Start the Server

**Option A — Compile a standalone binary and run with `sudo` (Recommended):**

```bash
bun run build
sudo ./apigee-ai-demos
```

*(All HTML, CSS, JS, WASM, `wallpaper.jpg`, and `scripts/on-connect.sh` assets are embedded into `./apigee-ai-demos`. Generated user credentials are saved to `./users.yaml` in the current working directory.)*

**Option B — Run directly with Bun:**

```bash
sudo "$(which bun)" run start
```

Then access via your GCP IAP domain, or directly with `?user=test@example.com`:
`https://your-domain.com/?user=test@example.com`

### 4. Run as a `systemd` Service (Debian 13)

```bash
# Register and enable (auto-detects ./apigee-ai-demos or bun)
sudo ./scripts/systemd-service.sh register

# Start, stop, restart, status, logs
sudo systemctl start apigee-ai-demos
sudo systemctl stop apigee-ai-demos
sudo systemctl restart apigee-ai-demos
sudo systemctl status apigee-ai-demos
sudo journalctl -u apigee-ai-demos -f

# Deregister and remove
sudo ./scripts/systemd-service.sh deregister
```

## Antigravity Enterprise Gateway (`aft` Deployment)

`deployments/antigravity-deployment.yaml` defines an [`aft`](https://github.com/apigee/apigee-templater) deployment that deploys the `REST-AI-Antigravity.yaml` template from `apigee-template-repository` along with the `antigravity-product` API product and `antigravity-user@example.com` developer app (`antigravity-app`):

```bash
# Deploy to Apigee X
aft deployments/antigravity-deployment.yaml --project <your-gcp-project> --environment <env>

# Or deploy to an Apigee Emulator
aft deployments/antigravity-deployment.yaml -f emulator -o http://localhost:8083 -e default-dev
```

Because `antigravity-app` leaves `credentials: []` empty in `deployments/antigravity-deployment.yaml`, Apigee automatically generates a secure consumer key/secret on creation. After deploying:

1. In the **Apigee Console** (or via `gcloud` / Apigee API), open **Publish → Apps → `antigravity-app`** (`antigravity-user@example.com`) and copy the generated **Key**.
2. Set `ANTIGRAVITY_URL` (your deployed `/antigravity` endpoint) and `ANTIGRAVITY_KEY` (the generated key) in `.env`.
3. Restart the service (`sudo systemctl restart apigee-ai-demos`) so `/etc/antigravity/admin_settings.json` is written for all VM users.

Alternatively, to provision a **per-user** `coding-agent-app` key automatically on connect via the Apigee Developer Portal, set `PORTAL_HOST`, `PORTAL_ADMIN_CLIENT_ID`, and `PORTAL_ADMIN_CLIENT_SECRET` in `.env` (with `ANTIGRAVITY_URL` and `ANTHROPIC_BASE_URL` set, leaving `ANTIGRAVITY_KEY` and `ANTHROPIC_API_KEY` empty). On connect, the server ensures the user exists in the portal, retrieves or creates `coding-agent-app` (`coding-agent-product`), and writes the user's `clientId` into `~/.antigravity/settings.json` and `~/.claude/settings.json`.

## VM Tool Bootstrap & Session Lifecycle (`scripts/on-connect.sh`)

- **Installed once system-wide for everyone (`--system-only`)**: On startup as root, the server ensures **QTerminal**, **PCManFM-Qt**, **FeatherPad**, **LXQt Panel**, **VSCodium** (`codium`, with the **Google Antigravity** extension `Google.google-antigravity` staged from Open VSX and installed per user), **Google Chrome** (`google-chrome-stable`), **Claude Code** (`/usr/local/bin/claude`, with `/etc/claude-code/managed-settings.json` rendered from `config/anthropic_settings.json` disabling per-user background self-updates and applying any `ANTHROPIC_*` gateway/model variables from `.env`), **Claude Desktop with Cowork** (`claude-desktop` from Anthropic's official APT repository along with its QEMU/KVM/virtiofsd/bubblewrap sandbox dependencies and `kvm` group membership for VM users), and the **current latest releases** of the **Antigravity 2.0 desktop app** (`/opt/antigravity`), **Antigravity CLI** (`/usr/local/bin/agy`), and **Antigravity IDE** (`/opt/antigravity-ide`) are installed and kept updated at the OS level, configures `/etc/xrdp/sesman.ini` (`KillDisconnected=true`, `DisconnectedTimeLimit=60`), and—when `ANTIGRAVITY_URL` and `ANTIGRAVITY_KEY` are set in `.env`—renders `config/antigravity_settings.json` to `/etc/antigravity/admin_settings.json` for system-wide Antigravity enterprise gateway access.
- **Persistent vs. auto-logout sessions (`KEEP_SESSIONS_RUNNING`, default `true`)**:
  - When `KEEP_SESSIONS_RUNNING=true` (default), `/etc/xrdp/sesman.ini` is configured with `KillDisconnected=false` (`DisconnectedTimeLimit=0`) and browser disconnects leave the user's `xrdp` / `LXQt` session running so they can reconnect and resume where they left off. Users can explicitly stop their session using the **Stop session** button in the web UI (`POST /api/rdp/stop`) or **Sign Out** inside the desktop.
  - When `KEEP_SESSIONS_RUNNING=false`, `/etc/xrdp/sesman.ini` is configured with `KillDisconnected=true` (`DisconnectedTimeLimit=60`), `scripts/on-connect.sh <username> <homedir>` terminates any lingering session before connecting, and browser disconnects immediately run `scripts/on-connect.sh --signout <username>`.
- **Applied per user on connect (`./scripts/on-connect.sh <username> <homedir>`)**:
  1. Enforces the top **LXQt** panel (`panel1` in `~/.config/lxqt/panel.conf`, including explicit `menu_file=/etc/xdg/menus/lxqt-applications.menu` and a right-aligned **Sign Out** button) and a centered bottom **LXQt** dock (`panel2` with left/right expandable spacers), guarantees `lxqt-panel` is running, and marks `~/Desktop/*.desktop` shortcuts trusted.
  2. Copies `public/wallpaper.jpg` into `~/.local/share/backgrounds/wallpaper.jpg` with `WallpaperMode=zoom` and hides `Computer` / `Network` desktop icons (`DesktopShortcuts=Home, Trash`).
  3. Places shortcuts on `~/Desktop` (**Terminal**, **Google Chrome**, **VSCodium**, **Antigravity**, **Claude**) and pins launchers on the bottom `lxqt-panel` dock (**Google Chrome**, **Home**, **Text Editor**, **Antigravity**, **Claude**).
