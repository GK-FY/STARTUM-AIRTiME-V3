# Heroku Deployment Guide for WhatsApp Bot

## Important Heroku Limitations & Solutions

### ⚠️ Session Persistence Issue
**Problem**: Heroku's filesystem is ephemeral - all files in the `./session` directory are wiped when the dyno restarts (at least once every 24 hours).

**Solution Options**:
1. **Accept Re-Authentication** (Current Setup): After each dyno restart, you'll need to scan the QR code again through the web interface.
2. **Use Persistent Storage** (Recommended for production): Implement session storage using:
   - AWS S3
   - Redis
   - PostgreSQL (store session data as base64 encoded blobs)
   - Heroku Postgres add-on

### ⚠️ Dyno Sleeping (Free/Hobby Plans)
**Problem**: Free and Hobby Heroku dynos sleep after 30 minutes of inactivity.

**Solutions**:
1. **Upgrade to Paid Dyno** (Recommended): Standard or higher dynos never sleep
2. **External Uptime Monitor** (Free option):
   - Use [UptimeRobot](https://uptimerobot.com/) (free)
   - Set it to ping your app's `/health` endpoint every 5-10 minutes
   - URL: `https://your-app-name.herokuapp.com/health`
3. **Heroku Scheduler** (Alternative):
   - Add the free Heroku Scheduler add-on
   - Schedule a job to run every 10 minutes: `curl https://your-app-name.herokuapp.com/health`

## Deployment Steps

### 1. Prerequisites
- Heroku account
- Heroku CLI installed
- Git installed

### 2. Initial Setup

```bash
# Login to Heroku
heroku login

# Create a new Heroku app (or use existing)
heroku create your-app-name

# Add buildpack for WhatsApp Web dependencies
heroku buildpacks:add jontewks/puppeteer
heroku buildpacks:add heroku/nodejs

# Set environment variables
heroku config:set ADMIN_UI_TOKEN=your-strong-admin-token
heroku config:set BASE_URL=https://your-app-name.herokuapp.com
```

### 3. Deploy

```bash
# Add files to git
git add .
git commit -m "Deploy WhatsApp bot to Heroku"

# Push to Heroku
git push heroku main
# OR if using master branch:
git push heroku master
```

### 4. Scale Up

```bash
# Ensure web dyno is running
heroku ps:scale web=1

# Check dyno status
heroku ps
```

### 5. View Logs

```bash
# Stream live logs
heroku logs --tail

# View recent logs
heroku logs --num=500
```

## Post-Deployment Configuration

### 1. Connect Your WhatsApp
1. Open your app: `https://your-app-name.herokuapp.com`
2. Enter the access code (default: `4262`)
3. Scan the QR code with WhatsApp
4. Wait for "WhatsApp client ready!" message

### 2. Setup Uptime Monitoring (For Free/Hobby Dynos)

**Using UptimeRobot**:
1. Go to [UptimeRobot.com](https://uptimerobot.com/)
2. Create free account
3. Add New Monitor:
   - Monitor Type: HTTP(s)
   - Friendly Name: WhatsApp Bot
   - URL: `https://your-app-name.herokuapp.com/health`
   - Monitoring Interval: 5 minutes
4. Save - your dyno will now stay awake 24/7!

### 3. Access Admin Panel
- URL: `https://your-app-name.herokuapp.com/admin?token=your-strong-admin-token`

## Environment Variables

Set these in Heroku dashboard or via CLI:

```bash
# Required
heroku config:set ADMIN_UI_TOKEN=your-secure-token
heroku config:set BASE_URL=https://your-app-name.herokuapp.com

# Optional (can be set via admin panel)
heroku config:set ADMIN_WHATSAPP=254XXXXXXXXX
heroku config:set SHADOW_API_KEY=your-key
heroku config:set SHADOW_API_SECRET=your-secret
heroku config:set SHADOW_ACCOUNT_ID=10
heroku config:set STATUM_CONSUMER_KEY=your-key
heroku config:set STATUM_CONSUMER_SECRET=your-secret
```

## Monitoring & Maintenance

### Check Health
```bash
curl https://your-app-name.herokuapp.com/health
```

Response includes:
- Uptime
- Memory usage
- Number of clients
- Connection status

### Check Logs
```bash
# Real-time logs
heroku logs --tail

# Filter for specific client
heroku logs --tail | grep "client_123"

# Search for errors
heroku logs --tail | grep "ERROR\|Error\|error"
```

### Restart Dyno
```bash
heroku restart
```
⚠️ **Note**: After restart, you'll need to scan QR code again!

## Troubleshooting

### Bot Keeps Disconnecting
1. Check if dyno is sleeping (free/hobby plan)
   - Solution: Set up UptimeRobot or upgrade dyno
2. Check memory usage
   - Run: `heroku ps`
   - If near limit, consider upgrading dyno type

### QR Code Not Showing
1. Check logs: `heroku logs --tail`
2. Ensure chromium buildpack is installed
3. Restart: `heroku restart`

### Out of Memory Errors
1. Upgrade to Standard-1X or higher dyno
2. Or reduce number of concurrent clients

### Session Lost After Restart
This is expected behavior with current setup. To prevent:
1. Implement persistent session storage (S3/Redis/DB)
2. Or manually reconnect after each restart

## Recommended Heroku Add-ons

### Essential (Free Tier Available)
- **Heroku Postgres**: For storing orders and client data persistently
- **Papertrail**: Better log management (10MB/month free)
- **New Relic APM**: Performance monitoring

### Optional
- **Heroku Redis**: For session caching (better than file-based)
- **Heroku Scheduler**: For automated tasks

## Cost Optimization

### Free Tier (~$0/month)
- 550-1000 dyno hours/month (sleeps after 30min inactivity)
- Requires external ping service
- QR re-scan after restarts

### Hobby Tier (~$7/month)
- Never sleeps
- Still has ephemeral filesystem
- Good for low-traffic bots

### Standard Tier (~$25/month)
- Better performance
- More memory
- Recommended for production

## Production Checklist

- [ ] Change default access code from `4262`
- [ ] Set strong ADMIN_UI_TOKEN
- [ ] Configure all API keys as environment variables
- [ ] Set up UptimeRobot or paid dyno
- [ ] Enable Papertrail for better logs
- [ ] Document your QR reconnection process
- [ ] Consider implementing persistent session storage
- [ ] Set up alerts for downtime
- [ ] Test full order flow end-to-end
- [ ] Document admin WhatsApp number

## Support

For issues specific to this bot, check logs:
```bash
heroku logs --tail
```

For Heroku platform issues, visit:
- [Heroku Dev Center](https://devcenter.heroku.com/)
- [Heroku Status](https://status.heroku.com/)
