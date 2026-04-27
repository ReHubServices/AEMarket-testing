# AE Empire Accounts VPS Deploy

## 1) Reconfigure before pull

1. Point your domain A record to the VPS IP.
2. Decide your production domain, for example `https://market.yourdomain.com`.
3. Generate new production secrets:
   - `AUTH_SECRET`
   - `ADMIN_USERNAME`
   - `ADMIN_PASSWORD`
   - `LZT_API_TOKEN`
   - `VENPAYR_API_KEY`
   - `VENPAYR_WEBHOOK_SECRET`
4. Prepare persistent storage:
   - Recommended: set `DATABASE_URL` to Postgres.
   - If not using Postgres, create a persistent folder and set `STORE_DIR`.
5. In VenPayr dashboard, set webhook URL to:
   - `https://market.yourdomain.com/api/webhooks/venpayr`
6. In VenPayr checkout settings, make sure return/cancel redirects go back to your domain.
7. Rotate any keys that were ever used in test/public screenshots.

## 2) Server packages

```bash
sudo apt update
sudo apt install -y nginx git curl
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm i -g pm2
```

## 3) Pull and install

```bash
cd /var/www
sudo mkdir -p ae-market
sudo chown -R $USER:$USER ae-market
cd ae-market
git clone <YOUR_GITHUB_REPO_URL> .
npm ci
cp .env.example .env
nano .env
```

## 4) Build and run

```bash
npm run build
PORT=3000 NODE_ENV=production pm2 start npm --name ae-market -- run start:standalone
pm2 save
pm2 startup
```

## 5) Nginx reverse proxy

Create `/etc/nginx/sites-available/ae-market`:

```nginx
server {
    server_name market.yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

Enable and reload:

```bash
sudo ln -s /etc/nginx/sites-available/ae-market /etc/nginx/sites-enabled/ae-market
sudo nginx -t
sudo systemctl reload nginx
```

## 6) TLS

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d market.yourdomain.com
```

## 7) Required `.env` values

Use these keys in `.env`:

- `AUTH_SECRET`
- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`
- `DATABASE_URL` or `STORE_DIR`
- `LZT_API_TOKEN`
- `LZT_API_BASE_URL`
- `LZT_TRANSLATE_RU_TO_EN`
- `FORTNITE_API_KEY`
- `FORTNITE_API_BASE_URL`
- `VENPAYR_API_KEY`
- `VENPAYR_BASE_URL`
- `VENPAYR_WEBHOOK_SECRET`
- `VENPAYR_CUSTOMER_COUNTRY`
- `NEXT_PUBLIC_DISCORD_CONTACT_URL` (optional)

## 8) Health checks after deploy

1. Register/login works.
2. Search returns listings.
3. Add funds redirects to VenPayr checkout.
4. VenPayr webhook reaches `/api/webhooks/venpayr` with 200.
5. Wallet balance updates after confirmed payment.
6. Purchase flow creates order and delivery appears in dashboard.
