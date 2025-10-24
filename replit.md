# FY WhatsApp Airtime Bot - Replit Environment

## Overview
Multi-client WhatsApp airtime bot running on Replit with M-Pesa payments and automatic airtime delivery.

## Recent Changes (Latest Session)

### ✅ Enhanced Features Implemented

1. **Instant Payment Notifications**
   - Users now receive instant WhatsApp notifications when payment succeeds
   - Notifications include recipient number, MPesa code, and order details
   - Failure notifications with clear reasons (insufficient balance, wrong PIN, etc.)
   - Timeout notifications when payment confirmation takes too long

2. **Manual Client Restart Feature**
   - Admin panel now has "🔄 Restart" button for each client
   - Allows administrators to manually restart WhatsApp clients without server restart
   - Useful when clients get stuck or need fresh QR code

3. **Bulk Messaging System**
   - Admin can send messages to all connected users from a client
   - Supports text messages and images via URL
   - Image URLs are automatically downloaded and sent as WhatsApp media
   - Messages sent to all unique phone numbers from client's orders
   - Progress tracking shows success/failed message counts

4. **Session Persistence**
   - WhatsApp sessions persist across server restarts
   - Auto-initialization of saved clients on startup
   - Staggered initialization (3s apart) to prevent resource contention
   - Keep-alive mechanism runs every 5 minutes checking client status
   - Self-ping every 25 minutes to prevent dyno sleeping

5. **Unlimited Client Support**
   - Uses Map data structure for efficient client management
   - Each client stored in persistent JSON (data/clients.json)
   - Clients automatically reload and reconnect on server restart
   - No limit on number of concurrent WhatsApp bot instances

## Project Structure

```
.
├── server.js              # Main server with multi-client WhatsApp logic
├── public/
│   ├── index.html        # Client QR code generation dashboard
│   └── admin.html        # Admin panel (manage clients, orders, settings)
├── data/
│   ├── clients.json      # Persistent client data
│   ├── orders.json       # Order history
│   └── settings.json     # Bot configuration
├── session/              # WhatsApp session data (auto-created)
├── package.json          # Dependencies
└── replit.md            # This file
```

## Environment Setup (Replit-Specific)

### System Dependencies Installed
- chromium (Chromium browser for WhatsApp Web)
- glib, nss, nspr, atk, at-spi2-atk (Required libraries)
- cups, libdrm, mesa, gtk3, pango, cairo (Display libraries)
- expat, dbus, alsa-lib (Additional dependencies)

### Workflow Configuration
- **Name**: Server
- **Command**: `node server.js`
- **Port**: 5000 (exposed to web)
- **Type**: webview (displays website preview)

## How to Use in Replit

### For Users
1. Visit the app URL (shown in Webview)
2. Click "Generate QR Code"
3. Enter access code (default: 4262)
4. Scan QR with WhatsApp → Settings → Linked Devices
5. Wait for "WhatsApp Connected!" message
6. Bot is now active and ready to serve customers

### For Admins
1. Click "Admin Dashboard" on homepage
2. Enter admin token (set in secrets: ADMIN_UI_TOKEN)
3. Access all management features:
   - **Clients Tab**: View, restart, or manage WhatsApp clients
   - **Orders Tab**: View and search all orders
   - **Settings Tab**: Configure API keys, pricing, limits
   - **System Tab**: View server information

### Admin Features
- **Restart Client**: Click "🔄 Restart" to manually restart a WhatsApp client
- **Bulk Message**: Click "📢 Bulk Message" to send updates to all users
- **Manage Settings**: Edit bot name, admin number, API credentials per client
- **Ban/Unban Users**: Block abusive users from using specific clients

## Configuration

### Required Secrets (Add via Replit Secrets)
- `ADMIN_UI_TOKEN`: Password for admin dashboard access

### Optional Settings
- `ADMIN_WHATSAPP`: Default admin phone number (254XXXXXXXXX)
- `PORT`: Server port (default: 5000)

### API Credentials (Configure in Admin Panel → Settings)
- **Shadow Pay**: M-Pesa STK Push payment gateway
  - API Key
  - API Secret
  - Account ID
- **Statum**: Airtime delivery API
  - Consumer Key
  - Consumer Secret

## User Preferences

### Known Issues & Solutions
1. **Old Client Sessions**: If old clients fail to load after restart, create new ones via homepage
2. **Chromium Library Errors**: System dependencies are installed, new clients will work
3. **Session Corruption**: Use "🔄 Restart" button in admin panel to fix stuck clients

## Key Features

### Payment Flow with Notifications
1. User initiates payment via WhatsApp bot
2. STK Push sent to user's M-Pesa
3. **NEW**: User receives instant notification when payment succeeds
4. **NEW**: Notification shows recipient number and MPesa code
5. Airtime automatically delivered
6. **NEW**: User receives confirmation with delivery status
7. **NEW**: If payment fails, user gets instant notification with reason

### Multi-Client Architecture
- Unlimited WhatsApp connections supported
- Each client has independent settings and API credentials
- Clients persist across restarts and auto-reconnect
- Staggered initialization prevents resource overload

### Keep-Alive System
- Checks all clients every 5 minutes
- Auto-reconnects disconnected clients
- Self-ping every 25 minutes to prevent sleeping
- Graceful shutdown saves all client states

## Deployment Notes

### Replit Advantages
- ✅ System dependencies easily installed via Nix
- ✅ Persistent storage for sessions and data
- ✅ Auto-restart on code changes
- ✅ Built-in secrets management
- ✅ Easy HTTPS with custom domain support

### Production Recommendations
- Set strong ADMIN_UI_TOKEN in secrets
- Configure proper admin WhatsApp numbers
- Add Shadow Pay and Statum API credentials
- Monitor health endpoint: `/health`
- Keep at least one active client connected

## Architecture Decisions

### Why Map for Clients?
- O(1) lookups by client ID
- Dynamic client addition/removal
- Memory efficient for unlimited clients

### Why JSON File Storage?
- Simple persistence without database overhead
- Easy backup and migration
- Human-readable for debugging
- Sufficient for moderate order volumes

### Why Staggered Initialization?
- Prevents simultaneous Chromium browser launches
- Reduces CPU/memory spikes on startup
- Ensures stable auto-reconnection

## Developer Notes

### Recent Code Changes
- Added `notifyUser()` function for instant WhatsApp notifications
- Enhanced payment polling with user notifications
- Added `/admin/restart-client` endpoint
- Added `/admin/bulk-message` endpoint with image URL support
- Updated admin.html with restart and bulk message UI
- All instant notifications include recipient numbers and transaction codes

### Testing Checklist
- [x] Server starts successfully
- [x] Dependencies installed
- [x] Workflow configured on port 5000
- [x] Admin panel accessible
- [x] Client restart functionality added
- [x] Bulk messaging with image support added
- [x] Payment notifications implemented
- [ ] QR code generation (requires user to test)
- [ ] WhatsApp connection (requires scanning)
- [ ] Payment flow (requires API credentials)
- [ ] Bulk messaging (requires connected client)

## Support & Maintenance

### Common Tasks
- **Restart Stuck Client**: Admin Panel → Clients → Click "🔄 Restart"
- **Send Announcement**: Admin Panel → Clients → Click "📢 Bulk Message"
- **View Orders**: Admin Panel → Orders Tab
- **Change Settings**: Admin Panel → Settings Tab
- **Check System Health**: Visit `/health` endpoint

### Logs & Debugging
- Server logs available in Replit console
- Each client logs with `[clientId]` prefix
- Health endpoint shows uptime and client count
- Admin panel shows real-time client status

## Next Steps

1. **User Testing**: Have admin scan QR and create first client
2. **Configure APIs**: Add Shadow Pay and Statum credentials
3. **Test Payment Flow**: Make a test airtime purchase
4. **Test Bulk Messaging**: Send a test message to users
5. **Test Restart**: Use restart button to verify functionality
6. **Monitor**: Check `/health` regularly

---

**Last Updated**: October 24, 2025
**Replit Environment**: Ready for production use
**Status**: ✅ All enhancements implemented and running
