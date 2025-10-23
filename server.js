/**
 * server.js - FY Bot Multi-Client System
 * Supports multiple WhatsApp instances with access code verification
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const qrcode = require('qrcode');
const qrcodeTerminal = require('qrcode-terminal');
const axios = require('axios');
const bodyParser = require('body-parser');
const cors = require('cors');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const { v4: uuidv4 } = require('uuid');

const PORT = process.env.PORT || 5000;
const BASE_URL = process.env.BASE_URL || (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : `http://localhost:${PORT}`);
const ADMIN_UI_TOKEN = process.env.ADMIN_UI_TOKEN || 'changeme-strong-token';
const SESSION_DIR = process.env.SESSION_DIR || './session';
const POLL_SECONDS = parseInt(process.env.POLL_SECONDS || '20', 10);
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL || '5', 10);

// endpoints used
const SHADOW_STK_URL = 'https://shadow-pay.top/api/v2/stkpush.php';
const SHADOW_STATUS_URL = 'https://shadow-pay.top/api/v2/status.php';
const STATUM_AIRTIME_URL = 'https://api.statum.co.ke/api/v2/airtime';

// file-backed storage
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const CLIENTS_FILE = path.join(DATA_DIR, 'clients.json');
const ENV_FILE = path.join(__dirname, '.env');

function readJson(file, fallback){ try{ if(!fs.existsSync(file)){ fs.writeFileSync(file, JSON.stringify(fallback, null, 2)); return fallback; } const raw = fs.readFileSync(file,'utf8'); return JSON.parse(raw || 'null') ?? fallback; } catch(e){ console.error('readJson', e); return fallback; } }
function writeJson(file, obj){ fs.writeFileSync(file, JSON.stringify(obj, null, 2)); }

let ORDERS = readJson(ORDERS_FILE, []);
let SETTINGS = readJson(SETTINGS_FILE, {
  app_name: 'FY Bot',
  bot_name: 'FY Bot',
  admin_whatsapp: process.env.ADMIN_WHATSAPP || '',
  access_code: '4262',
  statum_consumer_key: '',
  statum_consumer_secret: '',
  shadow_api_key: '',
  shadow_api_secret: '',
  shadow_account_id: '10',
  min_amount: '10',
  max_amount: '1500',
  discount_percent: '0',
  payment_poll_seconds: String(POLL_SECONDS)
});

let CLIENTS_DATA = readJson(CLIENTS_FILE, {});

function saveOrders(){ writeJson(ORDERS_FILE, ORDERS); }
function saveSettings(){ writeJson(SETTINGS_FILE, SETTINGS); }
function saveClients(){ writeJson(CLIENTS_FILE, CLIENTS_DATA); }

function now(){ return new Date().toISOString().replace('T',' ').replace('Z',''); }
function genOrderNo(){ return 'FYS-' + Math.floor(Math.random() * 1e8).toString().padStart(8,'0'); }
function normalizePhone(p){ if(!p) return ''; let s = String(p).replace(/\D/g,''); if(/^254[0-9]{9}$/.test(s)) return s; if(/^0[0-9]{9}$/.test(s)) return '254'+s.substring(1); if(/^[0-9]{9}$/.test(s)) return '254'+s; return s; }
function toJid(phone){ if(!phone) return null; return phone.replace(/\D/g,'') + '@c.us'; }

function prettyOrder(o){
  const lines = [];
  lines.push(`📦 *Order:* ${o.order_no}`);
  lines.push(`👤 *Payer:* ${o.payer_number}`);
  lines.push(`📲 *Recipient:* ${o.recipient_number}`);
  lines.push(`💸 *Amount:* KES ${parseFloat(o.amount).toFixed(2)}`);
  lines.push(`💰 *Payable:* KES ${parseFloat(o.amount_payable).toFixed(2)}`);
  lines.push(`🔖 *Discount:* ${o.discount_percent}%`);
  lines.push(`🔁 *Status:* ${o.status}`);
  lines.push(`🏷️ *MPesa Code:* ${o.transaction_code || 'N/A'}`);
  lines.push(`📶 *Airtime status:* ${o.airtime_status || 'N/A'}`);
  lines.push(`⏱️ *Created:* ${o.created_at}`);
  lines.push(`⏲️ *Updated:* ${o.updated_at}`);
  return lines.join('\n');
}

// Shadow & Statum wrappers
async function shadowInitiate(apiKey, apiSecret, accountId, phone, amount, reference, description){
  try {
    const payload = { payment_account_id: parseInt(accountId||'0',10), phone, amount: parseFloat(amount), reference, description };
    const r = await axios.post(SHADOW_STK_URL, payload, { headers:{ 'X-API-Key': apiKey||'', 'X-API-Secret': apiSecret||'', 'Content-Type':'application/json' }, timeout:30000 });
    return r.data;
  } catch(e) {
    return { success:false, message: e.response && e.response.data ? JSON.stringify(e.response.data) : e.message };
  }
}

async function shadowStatus(apiKey, apiSecret, checkout_request_id){
  try {
    const payload = { checkout_request_id };
    const r = await axios.post(SHADOW_STATUS_URL, payload, { headers:{ 'X-API-Key': apiKey||'', 'X-API-Secret': apiSecret||'', 'Content-Type':'application/json' }, timeout:20000 });
    return r.data;
  } catch(e) {
    return { success:false, message: e.response && e.response.data ? JSON.stringify(e.response.data) : e.message };
  }
}

async function statumSend(consumerKey, consumerSecret, phone, amount){
  try {
    const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
    const payload = { phone_number: phone, amount: String(amount) };
    const r = await axios.post(STATUM_AIRTIME_URL, payload, { headers:{ Authorization:`Basic ${auth}`, 'Content-Type':'application/json' }, timeout:30000 });
    return r.data;
  } catch(e) {
    return { success:false, message: e.response && e.response.data ? JSON.stringify(e.response.data) : e.message };
  }
}

// Order management
function createOrder(payer, recipient, amount, discount, clientId){
  const order = {
    id: uuidv4(),
    order_no: genOrderNo(),
    payer_number: payer,
    recipient_number: recipient,
    amount: parseFloat(amount),
    amount_payable: parseFloat((amount - (amount * (parseFloat(discount||'0')/100))).toFixed(2)),
    discount_percent: parseFloat(discount||'0'),
    status: 'pending_payment',
    client_id: clientId,
    checkout_request_id: null,
    merchant_request_id: null,
    transaction_code: null,
    airtime_status: null,
    airtime_response: null,
    created_at: now(),
    updated_at: now()
  };
  ORDERS.unshift(order);
  saveOrders();
  return order;
}

function updateOrderByCheckout(checkout, data){
  let changed=false;
  for(const o of ORDERS){ if(o.checkout_request_id && o.checkout_request_id===checkout){ Object.assign(o, data); o.updated_at=now(); changed=true; break; } }
  if(changed) saveOrders();
}

function updateOrderByNo(order_no, data){
  for(const o of ORDERS){ if(o.order_no===order_no){ Object.assign(o, data); o.updated_at=now(); saveOrders(); return o; } }
  return null;
}

function findOrder(order_no){ return ORDERS.find(x=>x.order_no===order_no) || null; }

// Poll payment and deliver
async function pollPayment(checkout_request_id, orderNo, pollSecondsOverride, clientId){
  const clientData = CLIENTS.get(clientId) || CLIENTS_DATA[clientId];
  const apiKey = clientData?.shadowApiKey || SETTINGS.shadow_api_key; 
  const apiSecret = clientData?.shadowApiSecret || SETTINGS.shadow_api_secret;
  const timeout = parseInt(pollSecondsOverride ?? SETTINGS.payment_poll_seconds ?? POLL_SECONDS, 10);
  const attempts = Math.ceil(timeout / POLL_INTERVAL);
  let paid=false; let tx=null;
  for(let i=0;i<attempts;i++){
    await new Promise(r=>setTimeout(r, POLL_INTERVAL*1000));
    try{
      const sres = await shadowStatus(apiKey, apiSecret, checkout_request_id);
      const pstatus = (sres.status || sres.result || '').toString().toLowerCase();
      const tcode = sres.transaction_code || sres.transaction || sres.tx || null;
      if(tcode) tx = tcode;
      if(pstatus==='completed' || pstatus==='success' || tx){
        updateOrderByCheckout(checkout_request_id, { status: 'paid', transaction_code: tx || null });
        paid=true; break;
      }
      if(pstatus==='failed' || (sres.message && sres.message.toString().toLowerCase()==='failed')){
        updateOrderByCheckout(checkout_request_id, { status: 'payment_failed' });
        break;
      }
    } catch(e){ console.warn('pollPayment error', e.message); }
  }
  return { paid, tx };
}

async function deliverAirtime(orderNo, clientId){
  const ord = findOrder(orderNo);
  if(!ord) return { success:false, message:'Order not found' };
  
  const clientData = CLIENTS.get(clientId || ord.client_id) || CLIENTS_DATA[clientId || ord.client_id];
  const consumerKey = clientData?.statumConsumerKey || SETTINGS.statum_consumer_key;
  const consumerSecret = clientData?.statumConsumerSecret || SETTINGS.statum_consumer_secret;
  
  try{
    const sres = await statumSend(consumerKey, consumerSecret, ord.recipient_number, ord.amount);
    if((sres.status_code && parseInt(sres.status_code)===200) || sres.success===true){
      updateOrderByNo(orderNo, { airtime_status:'delivered', airtime_response: JSON.stringify(sres) });
      return { success:true, statum:sres };
    } else {
      updateOrderByNo(orderNo, { airtime_status:'delivery_failed', airtime_response: JSON.stringify(sres) });
      return { success:false, statum:sres };
    }
  } catch(e){
    updateOrderByNo(orderNo, { airtime_status:'delivery_failed', airtime_response: e.message });
    return { success:false, message: e.message };
  }
}

// ----- Multi-Client WhatsApp Management -----
const CLIENTS = new Map();

function createWhatsAppClient(clientId) {
  if (CLIENTS.has(clientId)) {
    return CLIENTS.get(clientId);
  }

  const execSync = require('child_process').execSync;
  let chromiumPath;
  try {
    chromiumPath = execSync('which chromium').toString().trim();
  } catch(e) {
    chromiumPath = undefined;
  }

  const puppeteerConfig = {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu',
      '--single-process',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-breakpad',
      '--disable-component-extensions-with-background-pages',
      '--disable-features=TranslateUI,BlinkGenPropertyTrees',
      '--disable-ipc-flooding-protection',
      '--disable-renderer-backgrounding',
      '--enable-features=NetworkService,NetworkServiceInProcess',
      '--force-color-profile=srgb',
      '--hide-scrollbars',
      '--metrics-recording-only',
      '--mute-audio',
      '--no-default-browser-check',
      '--no-pings'
    ]
  };
  if (chromiumPath) {
    puppeteerConfig.executablePath = chromiumPath;
  }

  const client = new Client({
    authStrategy: new LocalAuth({ clientId, dataPath: SESSION_DIR }),
    puppeteer: puppeteerConfig
  });

  const clientData = {
    client,
    id: clientId,
    status: 'initializing',
    lastQr: null,
    connectedNumber: null,
    sessions: new Map(),
    createdAt: now(),
    botName: CLIENTS_DATA[clientId]?.botName || SETTINGS.bot_name || 'FY Bot',
    adminNumber: CLIENTS_DATA[clientId]?.adminNumber || '',
    shadowAccountId: CLIENTS_DATA[clientId]?.shadowAccountId || SETTINGS.shadow_account_id || '10',
    shadowApiKey: CLIENTS_DATA[clientId]?.shadowApiKey || SETTINGS.shadow_api_key || '',
    shadowApiSecret: CLIENTS_DATA[clientId]?.shadowApiSecret || SETTINGS.shadow_api_secret || '',
    statumConsumerKey: CLIENTS_DATA[clientId]?.statumConsumerKey || SETTINGS.statum_consumer_key || '',
    statumConsumerSecret: CLIENTS_DATA[clientId]?.statumConsumerSecret || SETTINGS.statum_consumer_secret || '',
    bannedUsers: CLIENTS_DATA[clientId]?.bannedUsers || {},
    isPaused: CLIENTS_DATA[clientId]?.isPaused || false,
    initRetryCount: CLIENTS_DATA[clientId]?.initRetryCount || 0
  };

  // Store client data
  if (!CLIENTS_DATA[clientId]) {
    CLIENTS_DATA[clientId] = {
      id: clientId,
      botName: clientData.botName,
      adminNumber: clientData.adminNumber,
      shadowAccountId: clientData.shadowAccountId,
      shadowApiKey: clientData.shadowApiKey,
      shadowApiSecret: clientData.shadowApiSecret,
      statumConsumerKey: clientData.statumConsumerKey,
      statumConsumerSecret: clientData.statumConsumerSecret,
      createdAt: clientData.createdAt,
      status: 'active',
      bannedUsers: {},
      isPaused: false,
      initRetryCount: 0
    };
    saveClients();
  }

  // Helper to send alert to client-specific admin
  async function alertAdmin(text) {
    const adminNum = (clientData.adminNumber || '').replace(/\D/g, '');
    if (!adminNum) return;
    try {
      const to = toJid(adminNum);
      await client.sendMessage(to, text);
    } catch(e) {
      console.error('alertAdmin error for', clientId, e.message);
    }
  }

  client.on('qr', async qr => {
    try {
      clientData.lastQr = qr;
      clientData.status = 'qr_ready';
      qrcodeTerminal.generate(qr, { small: true });
      console.log(`[${clientId}] QR code generated - Scan in WhatsApp`);
      
      const dataUrl = await qrcode.toDataURL(qr);
      io.to(clientId).emit('qr', { url: dataUrl, clientId });
    } catch(e) {
      console.error(`[${clientId}] QR handling error`, e);
    }
  });

  client.on('ready', async () => {
    console.log(`[${clientId}] WhatsApp client ready!`);
    clientData.status = 'connected';
    if (client.info && client.info.wid) {
      clientData.connectedNumber = client.info.wid.user;
    }
    io.to(clientId).emit('status', { connected: true, clientId });
    await alertAdmin(`✅ *${clientData.botName}* is online.`);
  });

  client.on('authenticated', () => console.log(`[${clientId}] Authenticated`));
  client.on('auth_failure', msg => {
    console.error(`[${clientId}] Auth failure:`, msg);
    clientData.status = 'auth_failed';
    io.to(clientId).emit('status', { connected: false, error: 'auth_failure', clientId });
    
    console.log(`[${clientId}] Clearing corrupted session and retrying in 10 seconds...`);
    setTimeout(async () => {
      if (CLIENTS.has(clientId) && clientData.status === 'auth_failed') {
        console.log(`[${clientId}] Destroying failed client and clearing session directory...`);
        try {
          await clientData.client.destroy();
          CLIENTS.delete(clientId);
          
          const sessionPath = path.join(SESSION_DIR, `session-${clientId}`);
          if (fs.existsSync(sessionPath)) {
            console.log(`[${clientId}] Removing corrupted session at ${sessionPath}`);
            fs.rmSync(sessionPath, { recursive: true, force: true });
          }
          
          console.log(`[${clientId}] Creating fresh client (QR scan will be required)...`);
          const newClient = createWhatsAppClient(clientId);
        } catch (e) {
          console.error(`[${clientId}] Error during auth failure recovery:`, e.message);
        }
      }
    }, 10000);
  });

  client.on('disconnected', reason => {
    console.log(`[${clientId}] Disconnected:`, reason);
    clientData.status = 'disconnected';
    io.to(clientId).emit('status', { connected: false, clientId });
    
    console.log(`[${clientId}] Auto-reconnecting in 5 seconds...`);
    setTimeout(() => {
      if (CLIENTS.has(clientId) && clientData.status === 'disconnected') {
        console.log(`[${clientId}] Attempting to reconnect...`);
        try {
          clientData.client.initialize().catch(e => {
            console.error(`[${clientId}] Reconnect failed:`, e.message);
          });
        } catch (e) {
          console.error(`[${clientId}] Error during reconnect attempt:`, e.message);
        }
      }
    }, 5000);
  });

  // Message handler for this client
  client.on('message', async msg => {
    try {
      if (!msg || !msg.from || !msg.body) return;
      
      const from = msg.from;
      const fromPhone = (from || '').replace('@c.us', '').replace('@g.us', '');
      const body = (msg.body || '').trim();
      
      if (!body || from.endsWith('@g.us')) return;

      // Get client-specific admin number
      const currentAdminNumber = (clientData.adminNumber || '').replace(/\D/g, '');
      
      // Check if bot is paused
      if (clientData.isPaused && fromPhone !== currentAdminNumber) {
        const pausedMsg = `⏸️ *Bot Temporarily Paused*\n\n⚠️ This bot is currently paused by the admin.\n\nPlease try again later or contact support${currentAdminNumber ? ':\n📱 +' + currentAdminNumber : '.'}`;
        await client.sendMessage(from, pausedMsg);
        return;
      }
      
      // Check if user is banned
      if (clientData.bannedUsers && clientData.bannedUsers[fromPhone] && fromPhone !== currentAdminNumber) {
        const banInfo = clientData.bannedUsers[fromPhone];
        const banMsg = `
🚫 *ACCESS DENIED*

⚠️ You have been banned from using this bot.

${banInfo.reason ? `📝 *Reason:* ${banInfo.reason}\n` : ''}${banInfo.bannedAt ? `📅 *Banned on:* ${banInfo.bannedAt}\n` : ''}
━━━━━━━━━━━━━━━━━━━━━━━━━━━
📞 *Contact Bot Owner:*
${currentAdminNumber ? '📱 WhatsApp: +' + currentAdminNumber : '📧 Please contact the bot administrator'}

_If you believe this is a mistake, please reach out to the owner._
        `.trim();
        await client.sendMessage(from, banMsg);
        return;
      }
      
      // Admin commands
      if (currentAdminNumber && fromPhone === currentAdminNumber) {
        if (/^admin$/i.test(body) || /^\/admin$/i.test(body)) {
          const adminMenu = `
╔══════════════════════╗
║   👑 *ADMIN PANEL*   ║
╚══════════════════════╝

*📊 ORDERS MANAGEMENT*
1️⃣ View All Orders
2️⃣ View Paid Orders  
3️⃣ View Pending Orders
4️⃣ View Failed Orders
5️⃣ Check Specific Order

*⚙️ SETTINGS*
6️⃣ View All Settings
7️⃣ Update Setting
8️⃣ Get Setting Value

*🔧 SYSTEM*
9️⃣ View QR Code
🔟 Restart Session
1️⃣1️⃣ Send Test Alert

*Type number to select*
Type *0* to exit admin menu
          `.trim();
          client.sendMessage(from, adminMenu);
          if (!clientData.sessions.has(fromPhone)) clientData.sessions.set(fromPhone, { step: 'ADMIN_MENU', temp: {} });
          else { const s = clientData.sessions.get(fromPhone); s.step = 'ADMIN_MENU'; s.temp = {}; }
          return;
        }

        // Handle admin menu selections (simplified)
        const adminSession = clientData.sessions.get(fromPhone);
        if (adminSession && adminSession.step === 'ADMIN_MENU') {
          if (body === '0') {
            client.sendMessage(from, '👋 Exited admin menu');
            adminSession.step = 'MENU';
            return;
          }
          if (body === '1') {
            let arr = ORDERS.filter(o => o.client_id === clientId).slice(0, 20);
            if (!arr.length) { client.sendMessage(from, '📭 No orders found'); adminSession.step = 'ADMIN_MENU'; return; }
            let out = `📋 *ALL ORDERS* (${arr.length} shown)\n\n`;
            arr.forEach((o, i) => out += `${i + 1}. ${o.order_no}\n   💰 KES ${o.amount} • ${o.status}\n\n`);
            client.sendMessage(from, out);
            adminSession.step = 'ADMIN_MENU';
            return;
          }
        }
      }

      // Regular user flow
      if (!clientData.sessions.has(fromPhone)) clientData.sessions.set(fromPhone, { step: 'MENU', temp: {} });
      const s = clientData.sessions.get(fromPhone);

      if (/^menu$/i.test(body) || body === '0') { s.step = 'MENU'; s.temp = {}; }

      switch (s.step) {
        case 'MENU':
          const botName = (clientData.botName || 'FY Bot').toUpperCase();
          const welcomeMsg = `
╔═══════════════════════════╗
║  🎯 *${botName}*  ║
╚═══════════════════════════╝

*✨ Welcome! What would you like to do?*

1️⃣ 💸 *Buy Airtime* - Quick & Easy
2️⃣ 📦 *Check Order* - Track Status
3️⃣ ❓ *Help* - Get Support
${currentAdminNumber && fromPhone === currentAdminNumber ? '9️⃣ 👑 *Admin Panel* - Manage Bot\n' : ''}
━━━━━━━━━━━━━━━━━━━━━━━━━━━
💡 *Tip:* Type the number to continue
🔄 Type *0* or *menu* anytime to return
          `.trim();
          await client.sendMessage(from, welcomeMsg);
          s.step = 'AWAITING_MENU';
          break;

        case 'AWAITING_MENU':
          if (body === '1') {
            s.step = 'BUY_AMOUNT'; s.temp = {};
            const min = SETTINGS.min_amount || '1';
            const max = SETTINGS.max_amount || '1500';
            await client.sendMessage(from, `💰 *AIRTIME PURCHASE*\n\n💵 Enter the amount in KES\n📊 Min: ${min} | Max: ${max}\n\n✍️ Example: *100*\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n💡 Type *0* or *menu* to cancel`);
            return;
          }
          if (body === '2') {
            s.step = 'CHECK_ORDER'; s.temp = {};
            await client.sendMessage(from, '📦 *ORDER TRACKING*\n\n🔍 Enter your order number\n\n✍️ Example: *FYS-12345678*\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n💡 Type *0* or *menu* to cancel');
            return;
          }
          if (body === '3') {
            const helpMsg = `
╔═══════════════════════════╗
║   ❓ *HELP & SUPPORT*     ║
╚═══════════════════════════╝

📞 *Need Assistance?*
${currentAdminNumber ? '📱 WhatsApp: +' + currentAdminNumber : '📧 Contact admin for support'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━
💡 *How to Buy Airtime*
━━━━━━━━━━━━━━━━━━━━━━━━━━━

1️⃣ Select "Buy Airtime"
2️⃣ Enter amount (KES)
3️⃣ Provide M-Pesa number
4️⃣ Confirm your purchase
5️⃣ Complete the STK push
6️⃣ Get instant airtime! ⚡

✨ Type *0* or *menu* to return
            `.trim();
            await client.sendMessage(from, helpMsg);
            s.step = 'MENU';
            return;
          }
          await client.sendMessage(from, '❌ Invalid option\n\nPlease select 1, 2, or 3');
          return;

        case 'BUY_AMOUNT':
          {
            const amt = parseFloat(body.replace(/[^0-9.]/g, ''));
            const min = parseFloat(SETTINGS.min_amount || '1');
            const max = parseFloat(SETTINGS.max_amount || '1500');
            if (!amt || amt <= 0) {
              await client.sendMessage(from, '❌ Invalid amount\n\n💵 Enter a valid number\nExample: *100*');
              return;
            }
            if (amt < min || amt > max) {
              await client.sendMessage(from, `❌ Amount out of range\n\n📊 Valid range:\nMin: KES ${min}\nMax: KES ${max}`);
              return;
            }
            s.temp.amount = amt;
            s.step = 'BUY_FOR';
            await client.sendMessage(from, `💰 *Amount: KES ${amt.toFixed(2)}*\n\n📱 *Who is this for?*\n\n1️⃣ 👤 For Myself\n2️⃣ 👥 For Someone Else\n\n*Select 1 or 2*`);
            return;
          }

        case 'BUY_FOR':
          if (body === '1') {
            s.temp.buy_for = 'self';
            s.step = 'BUY_PAYER';
            await client.sendMessage(from, '📱 *YOUR M-PESA NUMBER*\n\nEnter your M-Pesa number for payment:\n\n*Format:*\n• 07XXXXXXXX or\n• 2547XXXXXXXX');
            return;
          }
          if (body === '2') {
            s.temp.buy_for = 'other';
            s.step = 'BUY_PAYER';
            await client.sendMessage(from, '💳 *PAYER NUMBER*\n\nEnter M-Pesa number for payment:\n\n*Format:*\n• 07XXXXXXXX or\n• 2547XXXXXXXX');
            return;
          }
          await client.sendMessage(from, '❌ Invalid choice\n\nPlease select *1* or *2*');
          return;

        case 'BUY_PAYER':
          {
            let payer = body;
            if (/^default$/i.test(body) && fromPhone) payer = fromPhone;
            payer = normalizePhone(payer);
            if (!/^254[0-9]{9}$/.test(payer)) {
              await client.sendMessage(from, '❌ *Invalid Phone Number*\n\n📱 Use correct format:\n• 0712345678 or\n• 254712345678');
              return;
            }
            s.temp.payer = payer;
            if (s.temp.buy_for === 'other') {
              s.step = 'BUY_RECIPIENT';
              await client.sendMessage(from, '📱 *RECIPIENT NUMBER*\n\nEnter phone number to receive airtime:\n\n*Format:*\n• 07XXXXXXXX or\n• 2547XXXXXXXX');
              return;
            }
            s.temp.recipient = s.temp.payer;
            s.step = 'BUY_CONFIRM';
            const discount = parseFloat(SETTINGS.discount_percent || '0');
            const payable = s.temp.amount - (s.temp.amount * (discount / 100));
            const confirmMsg = `
╔══════════════════════╗
║  ✅ *CONFIRM ORDER*  ║
╚══════════════════════╝

💳 *Payer:* +${s.temp.payer}
📱 *Recipient:* +${s.temp.recipient}
💰 *Amount:* KES ${parseFloat(s.temp.amount).toFixed(2)}
💸 *To Pay:* KES ${payable.toFixed(2)}
${discount > 0 ? `🎉 *Discount:* ${discount}%\n` : ''}*━━━━━━━━━━━━━━━━━━━━*

*Confirm this order?*

1️⃣ ✅ Yes, proceed
2️⃣ ❌ No, cancel
            `.trim();
            await client.sendMessage(from, confirmMsg);
            return;
          }

        case 'BUY_RECIPIENT':
          {
            const rec = normalizePhone(body);
            if (!/^254[0-9]{9}$/.test(rec)) {
              await client.sendMessage(from, '❌ *Invalid Phone Number*\n\n📱 Use correct format:\n• 0712345678 or\n• 254712345678');
              return;
            }
            s.temp.recipient = rec;
            s.step = 'BUY_CONFIRM';
            const discount = parseFloat(SETTINGS.discount_percent || '0');
            const payable = s.temp.amount - (s.temp.amount * (discount / 100));
            const confirmMsg = `
╔══════════════════════╗
║  ✅ *CONFIRM ORDER*  ║
╚══════════════════════╝

💳 *Payer:* +${s.temp.payer}
📱 *Recipient:* +${s.temp.recipient}
💰 *Amount:* KES ${parseFloat(s.temp.amount).toFixed(2)}
💸 *To Pay:* KES ${payable.toFixed(2)}
${discount > 0 ? `🎉 *Discount:* ${discount}%\n` : ''}*━━━━━━━━━━━━━━━━━━━━*

*Confirm this order?*

1️⃣ ✅ Yes, proceed
2️⃣ ❌ No, cancel
            `.trim();
            await client.sendMessage(from, confirmMsg);
            return;
          }

        case 'BUY_CONFIRM':
          if (body === '1') {
            try {
              const amount = parseFloat(s.temp.amount || 0);
              const min = parseFloat(SETTINGS.min_amount || '1');
              const max = parseFloat(SETTINGS.max_amount || '1500');

              if (!amount || amount < min || amount > max) {
                await client.sendMessage(from, `❌ *Invalid Amount*\n\nAmount must be between KES ${min} and KES ${max}\n\nType *menu* to try again`);
                s.step = 'MENU'; s.temp = {}; return;
              }

              const payer = normalizePhone(s.temp.payer);
              const recipient = normalizePhone(s.temp.recipient);

              if (!/^254[0-9]{9}$/.test(payer) || !/^254[0-9]{9}$/.test(recipient)) {
                await client.sendMessage(from, '❌ *Invalid Phone Numbers*\n\nPlease try again.\n\nType *menu* to return');
                s.step = 'MENU'; s.temp = {}; return;
              }

              const order = createOrder(payer, recipient, amount, SETTINGS.discount_percent || '0', clientId);

              const sres = await shadowInitiate(clientData.shadowApiKey || SETTINGS.shadow_api_key, clientData.shadowApiSecret || SETTINGS.shadow_api_secret, clientData.shadowAccountId, payer, order.amount_payable, order.order_no, `Airtime payment ${order.order_no}`);

              if (!sres || !sres.success) {
                updateOrderByNo(order.order_no, { status: 'failed_payment_init' });
                await client.sendMessage(from, `❌ *ORDER FAILED*\n\n${sres && sres.message ? sres.message : 'Unknown error'}\n\nType *menu* to try again`);
                s.step = 'MENU'; s.temp = {}; return;
              }

              const checkout_request_id = sres.checkout_request_id || null;
              const merchant_request_id = sres.merchant_request_id || null;
              updateOrderByNo(order.order_no, { checkout_request_id, merchant_request_id });

              (async () => {
                const pollTimeout = parseInt(SETTINGS.payment_poll_seconds || POLL_SECONDS, 10);
                const { paid, tx } = await pollPayment(checkout_request_id, order.order_no, pollTimeout, clientId);
                if (paid) {
                  await alertAdmin(`🔔 Payment confirmed for ${order.order_no}. Delivering airtime...`);
                  const dres = await deliverAirtime(order.order_no, clientId);
                  if (dres.success) await alertAdmin(`✅ Airtime delivered for ${order.order_no}`);
                  else await alertAdmin(`⚠️ Airtime delivery failed for ${order.order_no}`);
                } else {
                  const ord = findOrder(order.order_no);
                  if (ord && ord.status !== 'paid') { updateOrderByNo(order.order_no, { status: 'payment_timeout' }); await alertAdmin(`⏰ Payment timeout for ${order.order_no}`); }
                }
              })();

              const successMsg = `
✅ *ORDER CREATED!*

📦 *Order Number:*
${order.order_no}

📲 *STK Push Sent!*
Check your phone for M-Pesa prompt

💰 *Amount to Pay:*
KES ${parseFloat(order.amount_payable).toFixed(2)}

⏳ *Please complete payment...*

_You'll receive confirmation once payment is successful_
              `.trim();
              await client.sendMessage(from, successMsg);
              await alertAdmin(`🔔 *New Order*\n\n📦 ${order.order_no}\n💰 KES ${s.temp.amount}\n📱 From WhatsApp: +${s.temp.payer}`);
              s.step = 'MENU'; s.temp = {}; return;

            } catch (e) {
              console.error('BUY_CONFIRM error:', e);
              await client.sendMessage(from, '❌ *Error Processing Order*\n\nPlease try again later.\n\nType *menu* to return');
              s.step = 'MENU'; s.temp = {}; return;
            }
          } else if (body === '2') {
            await client.sendMessage(from, '❌ *Order Cancelled*\n\nType *menu* to start over');
            s.step = 'MENU'; s.temp = {}; return;
          } else {
            await client.sendMessage(from, '❌ Invalid choice\n\nPlease select:\n1️⃣ to confirm\n2️⃣ to cancel');
            return;
          }

        case 'CHECK_ORDER':
          {
            const orderNo = body.trim();
            if (!orderNo) {
              await client.sendMessage(from, '❌ Please enter order number\n\nExample: *FYS-12345678*');
              return;
            }
            try {
              const ord = findOrder(orderNo);
              if (ord && ord.client_id === clientId) {
                await client.sendMessage(from, prettyOrder(ord));
              } else {
                await client.sendMessage(from, `❌ *Order Not Found*\n\n🔍 Order: ${orderNo}\n\nPlease check the number and try again`);
              }
            } catch (e) {
              console.error('CHECK_ORDER error:', e);
              await client.sendMessage(from, '❌ *Error retrieving order*\n\nPlease try again later.');
            }
            s.step = 'MENU'; s.temp = {}; return;
          }

        default:
          s.step = 'MENU'; s.temp = {};
          await client.sendMessage(from, '❓ Unknown command\n\nType *menu* or *0* for main menu');
          return;
      }

    } catch (e) {
      console.error(`[${clientId}] Message handler error`, e);
    }
  });

  client.on('loading_screen', (percent, message) => {
    console.log(`[${clientId}] Loading: ${percent}% - ${message}`);
  });

  client.on('remote_session_saved', () => {
    console.log(`[${clientId}] Session saved successfully`);
  });

  const MAX_INIT_RETRIES = 3;

  async function handleInitFailure(error) {
    console.error(`[${clientId}] Client init error (attempt ${clientData.initRetryCount + 1}):`, error.message);
    clientData.status = 'init_failed';
    clientData.initRetryCount++;
    
    if (CLIENTS_DATA[clientId]) {
      CLIENTS_DATA[clientId].initRetryCount = clientData.initRetryCount;
      saveClients();
    }
    
    if (error.message && error.message.includes('profile appears to be in use')) {
      console.log(`[${clientId}] Profile lock detected. Clearing entire session directory...`);
      try {
        await clientData.client.destroy().catch(() => {});
        CLIENTS.delete(clientId);
        
        const sessionPath = path.join(SESSION_DIR, `session-${clientId}`);
        if (fs.existsSync(sessionPath)) {
          console.log(`[${clientId}] Removing locked session directory: ${sessionPath}`);
          fs.rmSync(sessionPath, { recursive: true, force: true });
        }
      } catch (cleanupErr) {
        console.error(`[${clientId}] Error during session cleanup:`, cleanupErr.message);
      }
    }
    
    if (clientData.initRetryCount < MAX_INIT_RETRIES) {
      const retryDelay = 10000 + (clientData.initRetryCount * 5000);
      console.log(`[${clientId}] Retry ${clientData.initRetryCount}/${MAX_INIT_RETRIES} in ${retryDelay/1000}s...`);
      setTimeout(async () => {
        if (clientData.status === 'init_failed') {
          if (!CLIENTS.has(clientId)) {
            console.log(`[${clientId}] Recreating client after session cleanup...`);
            createWhatsAppClient(clientId);
          } else {
            try {
              await clientData.client.initialize();
            } catch (err) {
              await handleInitFailure(err);
            }
          }
        }
      }, retryDelay);
    } else {
      console.error(`[${clientId}] Max retries (${MAX_INIT_RETRIES}) exceeded. Manual intervention required.`);
      
      if (CLIENTS_DATA[clientId]) {
        CLIENTS_DATA[clientId].initRetryCount = 0;
        saveClients();
      }
      
      await alertAdmin(`⚠️ *${clientData.botName}* failed to initialize after ${MAX_INIT_RETRIES} attempts. Please reconnect via web interface.`).catch(() => {});
    }
  }

  client.on('ready', () => {
    if (CLIENTS_DATA[clientId] && clientData.initRetryCount > 0) {
      console.log(`[${clientId}] Successfully connected after ${clientData.initRetryCount} retry(ies). Resetting counter.`);
      clientData.initRetryCount = 0;
      CLIENTS_DATA[clientId].initRetryCount = 0;
      saveClients();
    }
  });

  client.initialize().catch(handleInitFailure);

  CLIENTS.set(clientId, clientData);
  return clientData;
}

function disconnectClient(clientId) {
  const clientData = CLIENTS.get(clientId);
  if (!clientData) return false;
  
  try {
    clientData.client.destroy();
    CLIENTS.delete(clientId);
    if (CLIENTS_DATA[clientId]) {
      CLIENTS_DATA[clientId].status = 'disconnected';
      saveClients();
    }
    return true;
  } catch (e) {
    console.error('Error disconnecting client:', e);
    return false;
  }
}

function stopClient(clientId) {
  const clientData = CLIENTS.get(clientId);
  if (!clientData) return false;
  
  try {
    clientData.isPaused = true;
    if (CLIENTS_DATA[clientId]) {
      CLIENTS_DATA[clientId].isPaused = true;
      saveClients();
    }
    return true;
  } catch (e) {
    console.error('Error stopping client:', e);
    return false;
  }
}

function resumeClient(clientId) {
  const clientData = CLIENTS.get(clientId);
  if (!clientData) return false;
  
  try {
    clientData.isPaused = false;
    if (CLIENTS_DATA[clientId]) {
      CLIENTS_DATA[clientId].isPaused = false;
      saveClients();
    }
    return true;
  } catch (e) {
    console.error('Error resuming client:', e);
    return false;
  }
}

// ----- Express + Socket.IO -----
const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// Socket.IO with client rooms
io.on('connection', socket => {
  const clientId = socket.handshake.query.clientId;
  
  if (clientId) {
    socket.join(clientId);
    console.log(`Socket connected for client: ${clientId}`);
    
    const clientData = CLIENTS.get(clientId);
    if (clientData) {
      // Only send status if client is ready/authenticated
      if (clientData.client.info && clientData.client.info.wid) {
        socket.emit('status', { connected: true, clientId });
      }
      // Send QR code if available
      if (clientData.lastQr && clientData.status === 'qr_ready') {
        qrcode.toDataURL(clientData.lastQr).then(dataUrl => {
          socket.emit('qr', { url: dataUrl, clientId });
        }).catch(e => {
          console.error(`[${clientId}] Error sending QR via socket:`, e);
        });
      }
    }
  }
});

// ----- API routes -----
app.post('/api/verify-access-code', (req, res) => {
  const { accessCode } = req.body;
  const correctCode = SETTINGS.access_code || '4262';
  
  if (accessCode !== correctCode) {
    return res.json({ success: false, message: 'Invalid access code' });
  }
  
  const clientId = 'client_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  createWhatsAppClient(clientId);
  
  res.json({ success: true, clientId });
});

app.post('/api/initiate', async (req, res) => {
  try {
    const clientId = req.body.client_id;
    const amount = parseFloat(req.body.amount || 0);
    const min = parseFloat(SETTINGS.min_amount || '1');
    const max = parseFloat(SETTINGS.max_amount || '1500');
    if (!amount || amount < min || amount > max) return res.json({ success: false, message: `Amount must be between KES ${min} and KES ${max}` });

    const payer_raw = req.body.mpesa_number || req.body.payer_number || '';
    const recipient_raw = req.body.recipient_number || payer_raw;
    const payer = normalizePhone(payer_raw);
    const recipient = normalizePhone(recipient_raw);
    if (!/^254[0-9]{9}$/.test(payer) || !/^254[0-9]{9}$/.test(recipient)) return res.json({ success: false, message: 'Invalid Kenyan phone numbers.' });

    const order = createOrder(payer, recipient, amount, SETTINGS.discount_percent || '0', clientId || 'api');

    const clientData = CLIENTS.get(clientId) || CLIENTS_DATA[clientId];
    const shadowAccountId = clientData?.shadowAccountId || SETTINGS.shadow_account_id;
    const shadowApiKey = clientData?.shadowApiKey || SETTINGS.shadow_api_key;
    const shadowApiSecret = clientData?.shadowApiSecret || SETTINGS.shadow_api_secret;

    const sres = await shadowInitiate(shadowApiKey, shadowApiSecret, shadowAccountId, payer, order.amount_payable, order.order_no, `Airtime payment ${order.order_no}`);
    if (!sres || !sres.success) {
      updateOrderByNo(order.order_no, { status: 'failed_payment_init' });
      return res.json({ success: false, message: `Failed to send STK: ${sres && sres.message ? sres.message : 'Unknown'}`, raw: sres });
    }

    const checkout_request_id = sres.checkout_request_id || null;
    const merchant_request_id = sres.merchant_request_id || null;
    updateOrderByNo(order.order_no, { checkout_request_id, merchant_request_id });

    (async () => {
      const pollTimeout = parseInt(SETTINGS.payment_poll_seconds || POLL_SECONDS, 10);
      const { paid, tx } = await pollPayment(checkout_request_id, order.order_no, pollTimeout, clientId);
      if (paid) {
        const dres = await deliverAirtime(order.order_no, clientId);
      }
    })();

    return res.json({ success: true, message: 'STK push sent', order_no: order.order_no, checkout_request_id, amount_payable: order.amount_payable });
  } catch (e) {
    console.error('initiate error', e);
    return res.json({ success: false, message: e.message });
  }
});

app.post('/api/get_order', (req, res) => {
  try {
    const order_no = req.body.order_no || req.query.order_no;
    if (!order_no) return res.json({ success: false, message: 'Missing order_no' });
    const ord = findOrder(order_no);
    if (!ord) return res.json({ success: false, message: 'Order not found' });
    return res.json({ success: true, order: ord });
  } catch (e) {
    return res.json({ success: false, message: e.message });
  }
});

app.post('/api/check_status', async (req, res) => {
  try {
    const checkout = req.body.checkout_request_id || req.body.checkout;
    if (!checkout) return res.json({ success: false, message: 'Missing checkout_request_id' });
    const sres = await shadowStatus(SETTINGS.shadow_api_key, SETTINGS.shadow_api_secret, checkout);
    const pstatus = (sres.status || sres.result || '').toString().toLowerCase();
    const tx = sres.transaction_code || sres.transaction || null;
    if (pstatus === 'completed' || pstatus === 'success' || tx) { updateOrderByCheckout(checkout, { status: 'paid', transaction_code: tx || null }); return res.json({ success: true, status: 'paid', transaction_code: tx, raw: sres }); }
    if (pstatus === 'failed' || (sres.message && sres.message.toString().toLowerCase() === 'failed')) { updateOrderByCheckout(checkout, { status: 'payment_failed' }); return res.json({ success: true, status: 'payment_failed', raw: sres }); }
    return res.json({ success: true, status: 'pending', raw: sres });
  } catch (e) {
    return res.json({ success: false, message: e.message });
  }
});

app.post('/api/deliver', async (req, res) => {
  try {
    const order_no = req.body.order_no;
    if (!order_no) return res.json({ success: false, message: 'Missing order_no' });
    const ord = findOrder(order_no);
    if (!ord) return res.json({ success: false, message: 'Order not found' });
    if (ord.status !== 'paid') updateOrderByNo(order_no, { status: 'paid' });
    const dres = await deliverAirtime(order_no);
    if (dres.success) return res.json({ success: true, message: 'Airtime delivered', statum: dres.statum });
    return res.json({ success: false, message: 'Delivery failed', statum: dres.statum || dres });
  } catch (e) {
    return res.json({ success: false, message: e.message });
  }
});

// ----- Admin endpoints -----
function adminAuth(req, res, next) {
  const token = req.headers['x-admin-token'] || req.query.token || req.body.token;
  if (token === ADMIN_UI_TOKEN) return next();
  res.status(401).json({ success: false, message: 'Unauthorized' });
}

app.get('/admin/clients', adminAuth, (req, res) => {
  const clientsList = [];
  for (const [id, data] of CLIENTS.entries()) {
    clientsList.push({
      id,
      status: data.status,
      botName: data.botName,
      adminNumber: data.adminNumber,
      connectedNumber: data.connectedNumber,
      createdAt: data.createdAt,
      isPaused: data.isPaused || false,
      bannedUsersCount: Object.keys(data.bannedUsers || {}).length
    });
  }
  res.json({ success: true, clients: clientsList });
});

app.post('/admin/disconnect-client', adminAuth, (req, res) => {
  const { clientId } = req.body;
  if (!clientId) return res.json({ success: false, message: 'Missing clientId' });
  
  const success = disconnectClient(clientId);
  if (success) {
    return res.json({ success: true, message: 'Client disconnected successfully' });
  }
  return res.json({ success: false, message: 'Failed to disconnect client' });
});

app.post('/admin/update-client', adminAuth, (req, res) => {
  const { clientId, botName, adminNumber, shadowAccountId, shadowApiKey, shadowApiSecret, statumConsumerKey, statumConsumerSecret } = req.body;
  if (!clientId) return res.json({ success: false, message: 'Missing clientId' });
  
  const clientData = CLIENTS.get(clientId);
  if (!clientData) return res.json({ success: false, message: 'Client not found' });
  
  if (botName !== undefined) clientData.botName = botName;
  if (adminNumber !== undefined) clientData.adminNumber = adminNumber.replace(/\D/g, '');
  if (shadowAccountId !== undefined) clientData.shadowAccountId = shadowAccountId;
  if (shadowApiKey !== undefined) clientData.shadowApiKey = shadowApiKey;
  if (shadowApiSecret !== undefined) clientData.shadowApiSecret = shadowApiSecret;
  if (statumConsumerKey !== undefined) clientData.statumConsumerKey = statumConsumerKey;
  if (statumConsumerSecret !== undefined) clientData.statumConsumerSecret = statumConsumerSecret;
  
  CLIENTS_DATA[clientId] = {
    ...CLIENTS_DATA[clientId],
    botName: clientData.botName,
    adminNumber: clientData.adminNumber,
    shadowAccountId: clientData.shadowAccountId,
    shadowApiKey: clientData.shadowApiKey,
    shadowApiSecret: clientData.shadowApiSecret,
    statumConsumerKey: clientData.statumConsumerKey,
    statumConsumerSecret: clientData.statumConsumerSecret
  };
  saveClients();
  
  res.json({ success: true, message: 'Client updated successfully' });
});

app.post('/admin/stop-client', adminAuth, (req, res) => {
  const { clientId } = req.body;
  if (!clientId) return res.json({ success: false, message: 'Missing clientId' });
  
  const success = stopClient(clientId);
  if (success) {
    return res.json({ success: true, message: 'Client stopped successfully' });
  }
  return res.json({ success: false, message: 'Failed to stop client' });
});

app.post('/admin/resume-client', adminAuth, (req, res) => {
  const { clientId } = req.body;
  if (!clientId) return res.json({ success: false, message: 'Missing clientId' });
  
  const success = resumeClient(clientId);
  if (success) {
    return res.json({ success: true, message: 'Client resumed successfully' });
  }
  return res.json({ success: false, message: 'Failed to resume client' });
});

app.post('/admin/ban-user', adminAuth, (req, res) => {
  const { clientId, phoneNumber, reason } = req.body;
  if (!clientId || !phoneNumber) return res.json({ success: false, message: 'Missing clientId or phoneNumber' });
  
  const clientData = CLIENTS.get(clientId);
  if (!clientData) return res.json({ success: false, message: 'Client not found' });
  
  const normalizedPhone = phoneNumber.replace(/\D/g, '');
  if (!normalizedPhone) return res.json({ success: false, message: 'Invalid phone number' });
  
  clientData.bannedUsers[normalizedPhone] = {
    reason: reason || 'No reason provided',
    bannedAt: now(),
    bannedBy: 'admin'
  };
  
  if (CLIENTS_DATA[clientId]) {
    CLIENTS_DATA[clientId].bannedUsers = clientData.bannedUsers;
    saveClients();
  }
  
  res.json({ success: true, message: 'User banned successfully' });
});

app.post('/admin/unban-user', adminAuth, (req, res) => {
  const { clientId, phoneNumber } = req.body;
  if (!clientId || !phoneNumber) return res.json({ success: false, message: 'Missing clientId or phoneNumber' });
  
  const clientData = CLIENTS.get(clientId);
  if (!clientData) return res.json({ success: false, message: 'Client not found' });
  
  const normalizedPhone = phoneNumber.replace(/\D/g, '');
  if (!normalizedPhone) return res.json({ success: false, message: 'Invalid phone number' });
  
  delete clientData.bannedUsers[normalizedPhone];
  
  if (CLIENTS_DATA[clientId]) {
    CLIENTS_DATA[clientId].bannedUsers = clientData.bannedUsers;
    saveClients();
  }
  
  res.json({ success: true, message: 'User unbanned successfully' });
});

app.get('/admin/client/:clientId', adminAuth, (req, res) => {
  const clientId = req.params.clientId;
  const clientData = CLIENTS.get(clientId);
  
  if (!clientData) {
    return res.json({ success: false, message: 'Client not found' });
  }
  
  const bannedUsersList = Object.keys(clientData.bannedUsers || {}).map(phone => ({
    phone: '+' + phone,
    ...clientData.bannedUsers[phone]
  }));
  
  res.json({
    success: true,
    client: {
      id: clientData.id,
      botName: clientData.botName,
      adminNumber: clientData.adminNumber,
      shadowAccountId: clientData.shadowAccountId,
      shadowApiKey: clientData.shadowApiKey,
      shadowApiSecret: clientData.shadowApiSecret,
      statumConsumerKey: clientData.statumConsumerKey,
      statumConsumerSecret: clientData.statumConsumerSecret,
      status: clientData.status,
      isPaused: clientData.isPaused,
      connectedNumber: clientData.connectedNumber,
      createdAt: clientData.createdAt,
      bannedUsers: bannedUsersList
    }
  });
});

app.get('/admin/orders', adminAuth, (req, res) => {
  try {
    const filter = req.query.filter || 'all';
    const q = (req.query.q || '').toLowerCase();
    let list = ORDERS.slice();
    if (filter === 'paid') list = list.filter(x => x.status === 'paid');
    else if (filter === 'pending') list = list.filter(x => x.status && x.status.indexOf('pending') !== -1);
    else if (filter === 'cancelled') list = list.filter(x => ['payment_failed', 'delivery_failed', 'failed_payment_init', 'payment_timeout'].includes(x.status));
    if (q) list = list.filter(o => (o.order_no || '').toLowerCase().includes(q) || (o.transaction_code || '').toLowerCase().includes(q) || (o.payer_number || '').toLowerCase().includes(q));
    res.json({ success: true, orders: list.slice(0, 1000) });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

app.get('/admin/order/:order_no', adminAuth, (req, res) => {
  const ord = findOrder(req.params.order_no);
  if (!ord) return res.json({ success: false, message: 'Not found' });
  res.json({ success: true, order: ord });
});

app.get('/admin/settings', adminAuth, (req, res) => {
  res.json({ success: true, settings: SETTINGS });
});

app.get('/api/app-info', (req, res) => {
  res.json({ success: true, appName: SETTINGS.app_name || 'FY Bot' });
});

app.post('/admin/settings', adminAuth, (req, res) => {
  try {
    Object.keys(req.body || {}).forEach(k => {
      SETTINGS[k] = String(req.body[k] ?? '');
    });
    saveSettings();
    res.json({ success: true, message: 'Settings saved successfully!' });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

app.get('/admin/system-info', adminAuth, (req, res) => {
  try {
    const info = {
      platform: process.platform,
      nodeVersion: process.version,
      totalOrders: ORDERS.length,
      totalClients: CLIENTS.size,
      uptime: process.uptime(),
      memory: process.memoryUsage()
    };
    res.json({ success: true, info });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

app.get('/admin', (req, res) => {
  if (req.query.token !== ADMIN_UI_TOKEN) return res.status(401).send('Unauthorized. Provide ?token=ADMIN_UI_TOKEN');
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/health', (req, res) => {
  const clientsInfo = Array.from(CLIENTS.values()).map(c => ({
    id: c.id,
    status: c.status
  }));
  
  res.json({ 
    ok: true,
    uptime: Math.floor(process.uptime()),
    memory: process.memoryUsage(),
    clients: CLIENTS.size,
    connected: clientsInfo.filter(c => c.status === 'connected').length,
    disconnected: clientsInfo.filter(c => c.status === 'disconnected').length,
    timestamp: new Date().toISOString()
  });
});

// Clean up stale Chromium lock files
function cleanupStaleLocks() {
  console.log('Cleaning up stale Chromium lock files...');
  try {
    if (!fs.existsSync(SESSION_DIR)) {
      return;
    }
    
    const sessionDirs = fs.readdirSync(SESSION_DIR);
    let cleaned = 0;
    
    sessionDirs.forEach(dir => {
      const sessionPath = path.join(SESSION_DIR, dir);
      if (fs.statSync(sessionPath).isDirectory()) {
        const singletonLock = path.join(sessionPath, 'Default', 'SingletonLock');
        if (fs.existsSync(singletonLock)) {
          try {
            fs.unlinkSync(singletonLock);
            cleaned++;
            console.log(`Removed lock file: ${singletonLock}`);
          } catch (e) {
            console.error(`Failed to remove lock: ${singletonLock}`, e.message);
          }
        }
      }
    });
    
    console.log(`Cleaned ${cleaned} stale lock file(s)`);
  } catch (e) {
    console.error('Error cleaning up locks:', e.message);
  }
}

// Auto-initialize saved clients on startup with staggered delays
function initializeSavedClients() {
  console.log('Checking for saved clients to auto-initialize...');
  const savedClients = Object.keys(CLIENTS_DATA);
  
  if (savedClients.length === 0) {
    console.log('No saved clients found.');
    return;
  }
  
  console.log(`Found ${savedClients.length} saved client(s). Initializing with staggered delays to prevent resource contention...`);
  
  savedClients.forEach((clientId, index) => {
    const staggerDelay = index * 3000;
    setTimeout(() => {
      try {
        console.log(`[${clientId}] Auto-initializing from saved data (${index + 1}/${savedClients.length})...`);
        createWhatsAppClient(clientId);
      } catch (e) {
        console.error(`[${clientId}] Error auto-initializing:`, e.message);
      }
    }, staggerDelay);
  });
  
  console.log(`All ${savedClients.length} client(s) scheduled for staggered initialization (3s apart)`);
}

// Keep-alive mechanism to prevent dyno sleeping
function setupKeepAlive() {
  const KEEP_ALIVE_INTERVAL = 5 * 60 * 1000;
  const SELF_PING_INTERVAL = 25 * 60 * 1000;
  
  setInterval(() => {
    const clientCount = CLIENTS.size;
    const connectedCount = Array.from(CLIENTS.values()).filter(c => c.status === 'connected').length;
    console.log(`[KeepAlive] Clients: ${clientCount} | Connected: ${connectedCount} | Uptime: ${Math.floor(process.uptime())}s`);
    
    CLIENTS.forEach((clientData, clientId) => {
      if (clientData.status === 'disconnected') {
        console.log(`[${clientId}] Detected disconnected client, attempting reconnect...`);
        try {
          clientData.client.initialize().catch(e => {
            console.error(`[${clientId}] KeepAlive reconnect failed:`, e.message);
          });
        } catch (e) {
          console.error(`[${clientId}] KeepAlive error:`, e.message);
        }
      }
    });
  }, KEEP_ALIVE_INTERVAL);
  
  setInterval(() => {
    if (BASE_URL && BASE_URL.startsWith('http')) {
      axios.get(`${BASE_URL}/health`)
        .then(response => {
          console.log(`[SelfPing] Success - Uptime: ${response.data.uptime}s, Clients: ${response.data.clients}`);
        })
        .catch(error => {
          console.error('[SelfPing] Failed:', error.message);
        });
    }
  }, SELF_PING_INTERVAL);
  
  console.log('Keep-alive mechanism enabled (5-minute client check + 25-minute self-ping)');
  console.log('⚠️  NOTE: For Heroku free/hobby dynos, add external uptime monitoring (UptimeRobot, etc.) to prevent sleeping.');
}

// Graceful shutdown handler
function gracefulShutdown() {
  console.log('\nReceived shutdown signal, cleaning up...');
  
  const shutdownPromises = [];
  CLIENTS.forEach((clientData, clientId) => {
    console.log(`[${clientId}] Saving state...`);
    if (CLIENTS_DATA[clientId]) {
      CLIENTS_DATA[clientId].status = clientData.status;
      CLIENTS_DATA[clientId].lastShutdown = now();
    }
  });
  
  saveClients();
  console.log('All client states saved.');
  
  setTimeout(() => {
    console.log('Shutdown complete.');
    process.exit(0);
  }, 2000);
}

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  console.error('Stack:', error.stack);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// start server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running at ${BASE_URL}\nVisit ${BASE_URL}/ for multi-client dashboard\nAdmin UI at ${BASE_URL}/admin?token=${ADMIN_UI_TOKEN}`);
  
  cleanupStaleLocks();
  
  setTimeout(() => {
    initializeSavedClients();
    setupKeepAlive();
    console.log('\n✅ WhatsApp Bot fully initialized and ready for 24/7 operation!');
  }, 2000);
});
