# Mini App on app.anthropics.ir (port 443 busy)

Your VPN inbound already uses **443** on the VPS. Do **not** bind Caddy/Nginx to 443 on the same IP without moving that inbound.

## Recommended setup (Cloudflare)

1. In Cloudflare DNS for `anthropics.ir`:
   - Type **A**, name `app`, value = VPS IP
   - Proxy status: **Proxied** (orange cloud)

2. On the VPS, run Mini App + API on high ports (example **8443** for HTTPS origin, or plain **3000/4000** behind Cloudflare Flexible — prefer Full/Strict):

### Option A — Cloudflare Tunnel (best when 443 is taken)

```bash
# install cloudflared, then:
cloudflared tunnel create quadtwo-app
cloudflared tunnel route dns <TUNNEL_ID> app.anthropics.ir
```

Tunnel config maps `app.anthropics.ir` → `http://127.0.0.1:3000` and `/api` → `http://127.0.0.1:4000`.

No need to open 443 for the Mini App.

### Option B — Origin on custom HTTPS port (e.g. 8443)

- Caddy/Nginx listen on **8443** only
- Cloudflare SSL/TLS → Full
- Cloudflare → origin port 8443 (Origin Rules / Cloudflare Spectrum not always needed; for HTTP use Tunnel or Workers)

Simplest path if Tunnel feels heavy: **Cloudflare Tunnel**.

3. Env on server:

```env
PUBLIC_DOMAIN=app.anthropics.ir
NEXT_PUBLIC_API_URL=https://app.anthropics.ir
XUI_INBOUND_IDS=1,2,3,4,5,6,7,8,9,10
```

4. Bot:

```text
/setminiapp https://app.anthropics.ir
/setinbounds 1-10
```

5. BotFather Mini App URL = `https://app.anthropics.ir`

Keep `piing.ir` hosting untouched.
