# 🚀 Deployment Guide - FY WhatsApp Airtime Bot

This guide helps you deploy your WhatsApp bot to production. **Important:** This bot cannot run on Vercel or other serverless platforms because it requires persistent connections.

## ⚠️ Why Not Vercel?

Vercel is designed for serverless functions that:
- Run on-demand (start and stop for each request)
- Have execution time limits (10-300 seconds)
- Cannot maintain persistent connections

This WhatsApp bot requires:
- ✅ A persistent browser session (Puppeteer/Chromium)
- ✅ 24/7 WebSocket connections to WhatsApp servers
- ✅ File system access for session storage
- ✅ Long-running Node.js process

## ✅ Recommended Platforms

### 1. Railway.app (Recommended)

**Pros:** Free tier available, easy deployment, automatic HTTPS, great for beginners

**Steps:**
1. Create account at [railway.app](https://railway.app)
2. Click "New Project" → "Deploy from GitHub repo"
3. Connect your GitHub repository
4. Railway will auto-detect the `railway.json` config
5. Add environment variables:
   - `PORT` = `5000`
   - `ADMIN_WHATSAPP` = Your admin number (254XXXXXXXXX)
   - `ADMIN_UI_TOKEN` = Strong random token
6. Deploy! Your bot will be live at: `https://your-project.railway.app`

**Free Tier:** $5 free credits/month, 500 hours runtime

---

### 2. Render.com

**Pros:** Simple deployment, free tier, automatic SSL

**Steps:**
1. Create account at [render.com](https://render.com)
2. Click "New" → "Web Service"
3. Connect your GitHub repository
4. Render will auto-detect the `render.yaml` config
5. Set environment variables in the dashboard:
   - `ADMIN_WHATSAPP` = Your admin number
   - `ADMIN_UI_TOKEN` = Strong random token
6. Click "Create Web Service"

**Free Tier:** 750 hours/month, spins down after 15 min inactivity

---

### 3. Heroku

**Pros:** Battle-tested, reliable, many addons

**Steps:**
1. Install Heroku CLI: `npm install -g heroku`
2. Login: `heroku login`
3. Create app: `heroku create fy-airtime-bot`
4. Add Puppeteer buildpack:
   ```bash
   heroku buildpacks:add jontewks/puppeteer
   heroku buildpacks:add heroku/nodejs
   ```
5. Set environment variables:
   ```bash
   heroku config:set ADMIN_WHATSAPP=254XXXXXXXXX
   heroku config:set ADMIN_UI_TOKEN=your-strong-token
   heroku config:set PORT=5000
   ```
6. Deploy:
   ```bash
   git push heroku main
   ```

**Pricing:** Eco dynos ($5/month per dyno)

---

### 4. DigitalOcean App Platform

**Pros:** Full control, $5/month droplets, scalable

**Steps:**
1. Create account at [digitalocean.com](https://digitalocean.com)
2. Create new App
3. Connect GitHub repository
4. Configure build command: `npm install`
5. Configure run command: `node server.js`
6. Add environment variables
7. Deploy

**Pricing:** Starting at $5/month

---

### 5. Replit (Current Platform)

**Pros:** Easy to use, instant deployment, built-in IDE

**Steps:**
1. You're already here! Just set environment variables:
   - Click "Secrets" tab (lock icon)
   - Add `ADMIN_WHATSAPP`
   - Add `ADMIN_UI_TOKEN`
2. Click "Run" to start the bot
3. Your bot runs at: `https://your-repl-name.your-username.repl.co`

**Pricing:** Free tier available, Always-On requires paid plan

---

## 🔐 Required Environment Variables

All platforms need these environment variables:

| Variable | Description | Example |
|----------|-------------|---------|
| `PORT` | Server port | `5000` |
| `ADMIN_WHATSAPP` | Admin phone number (Kenyan format) | `254712345678` |
| `ADMIN_UI_TOKEN` | Admin dashboard password | `MyStrongToken123!` |

## 📱 After Deployment

1. **Open your deployment URL** (e.g., `https://your-app.railway.app`)
2. **Scan the QR code** with WhatsApp (Settings → Linked Devices)
3. **Access admin dashboard:**
   - Click "Admin Dashboard" button
   - Enter your `ADMIN_UI_TOKEN`
4. **Configure settings:**
   - Add your Shadow Pay API credentials
   - Add your Statum API credentials
   - Set min/max amounts and discount
5. **Test the bot:**
   - Send "menu" to your WhatsApp bot
   - Try purchasing airtime

## 🛠️ Troubleshooting

### Bot not responding to WhatsApp messages
- Check if bot is connected (dashboard shows green checkmark)
- Verify admin number is in correct format (254XXXXXXXXX)
- Check server logs for errors

### QR code not showing
- Wait 30-60 seconds after deployment
- Refresh the dashboard page
- Check server logs for Puppeteer errors

### Orders not processing
- Verify Shadow Pay credentials in admin settings
- Verify Statum credentials in admin settings
- Check that APIs are active and have credit

### WhatsApp session keeps disconnecting
- Ensure the server is always running (not on free tier that sleeps)
- Don't scan the same QR on multiple devices
- Check if WhatsApp Web is working (web.whatsapp.com)

## 💰 Cost Comparison

| Platform | Free Tier | Paid Plan | Best For |
|----------|-----------|-----------|----------|
| **Railway** | $5 credits/month | Pay-as-you-go | Most users |
| **Render** | 750 hrs/month | $7/month | Light usage |
| **Heroku** | None | $5/month | Reliability |
| **DigitalOcean** | $200 credit (60 days) | $5/month | Control |
| **Replit** | Limited | $20/month | Development |

## 🎯 Recommendations

- **For beginners:** Start with Railway or Render
- **For production:** Heroku or DigitalOcean
- **For development:** Replit
- **Don't use:** Vercel, Netlify, AWS Lambda, or any serverless platform

## 📞 Support

Having deployment issues? Check:
1. Server logs for error messages
2. Environment variables are set correctly
3. All required credentials are configured in admin panel
4. Your hosting plan supports long-running processes

---

**Happy Deploying! 🚀**
