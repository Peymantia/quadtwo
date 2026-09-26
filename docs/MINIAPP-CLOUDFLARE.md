# Mini App behind Cloudflare (port 443 busy on origin)

When the VPS already uses `:443` for something else, terminate TLS at Cloudflare and proxy HTTP to the origin.

1. Cloudflare DNS for your zone:
   - `A` / `CNAME` for the Mini App host → origin IP (Proxied / orange cloud)
2. SSL/TLS mode: **Flexible** (origin speaks plain HTTP on :80) or **Full** if you have an origin cert
3. Optional: [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/) tunnel if you do not expose :80 publicly

Example tunnel route:

```bash
cloudflared tunnel route dns <TUNNEL_ID> app.example.com
```

Tunnel config maps `app.example.com` → `http://127.0.0.1:3000` and `/api` → `http://127.0.0.1:4000`.

## `.env`

```env
PUBLIC_DOMAIN=app.example.com
DASH_DOMAIN=dash.example.com
NEXT_PUBLIC_API_URL=https://dash.example.com
NEXT_PUBLIC_APP_URL=https://dash.example.com
CORS_ORIGINS=https://dash.example.com,https://app.example.com
```

## Bot / BotFather

```text
/setminiapp https://app.example.com
```

BotFather Mini App URL = `https://app.example.com`
