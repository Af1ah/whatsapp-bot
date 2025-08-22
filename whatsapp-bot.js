const { 
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  downloadContentFromMessage
} = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const express = require('express');
const axios = require('axios');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3002;

// Configuration
const AI_API_URL = process.env.AI_API_URL || "admin-dash.webvantic.studio/api/whatsapp";
const TYPING_DELAY = 2000; // 2 seconds typing indicator
const MESSAGE_BATCH_DELAY = 5000; // 15 seconds delay for batched messages
const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_DELAY = 5000;

console.log("🔧 Configuration:");
console.log("- AI API URL:", AI_API_URL);
console.log("- Typing delay:", TYPING_DELAY + "ms");
console.log("- Message batch delay:", MESSAGE_BATCH_DELAY + "ms");
console.log("- Port:", PORT);

// Create necessary directories
const AUTH_DIR = './auth_info_baileys';
const DATA_DIR = './bot_data';
const PENDING_MESSAGES_FILE = path.join(DATA_DIR, 'pending_messages.json');
const USER_TIMERS_FILE = path.join(DATA_DIR, 'user_timers.json');

[AUTH_DIR, DATA_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Logger configuration
const logger = pino({
  level: 'warn'
});

let sock;
let qrGenerated = false;
let reconnectAttempts = 0;
let isConnected = false;

// Persistent data structures
let pendingMessages = new Map();
let userMessageTimers = new Map();
let processedMessages = new Set();
let processingLock = new Set();

// Load persistent data on startup
function loadPersistentData() {
  try {
    // Load pending messages
    if (fs.existsSync(PENDING_MESSAGES_FILE)) {
      const data = JSON.parse(fs.readFileSync(PENDING_MESSAGES_FILE, 'utf8'));
      pendingMessages = new Map(data);
      console.log(`📂 Loaded ${pendingMessages.size} pending messages`);
    }

    // Load user timers
    if (fs.existsSync(USER_TIMERS_FILE)) {
      const data = JSON.parse(fs.readFileSync(USER_TIMERS_FILE, 'utf8'));
      userMessageTimers = new Map(Object.entries(data));
      console.log(`⏰ Loaded ${userMessageTimers.size} user timers`);
    }
  } catch (error) {
    console.error('❌ Error loading persistent data:', error.message);
  }
}

// Save persistent data
function savePersistentData() {
  try {
    // Save pending messages
    const pendingData = Array.from(pendingMessages.entries());
    fs.writeFileSync(PENDING_MESSAGES_FILE, JSON.stringify(pendingData, null, 2));

    // Save user timers (convert Map values to serializable format)
    const timerData = {};
    userMessageTimers.forEach((value, key) => {
      if (value && typeof value === 'object') {
        timerData[key] = {
          timeout: null, // Don't save timeout objects
          messages: value.messages || [],
          lastMessageTime: value.lastMessageTime || Date.now()
        };
      }
    });
    fs.writeFileSync(USER_TIMERS_FILE, JSON.stringify(timerData, null, 2));
  } catch (error) {
    console.error('❌ Error saving persistent data:', error.message);
  }
}

// Auto-save every 30 seconds
setInterval(savePersistentData, 30000);

// Save on exit
process.on('SIGINT', () => {
  console.log('\n🛑 Bot shutting down...');
  savePersistentData();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Bot shutting down...');
  savePersistentData();
  process.exit(0);
});

// Utility functions
function generateChatId(phoneNumber) {
  return `whatsapp_${phoneNumber}_${Date.now()}`;
}

function cleanPhoneNumber(phoneNumber) {
  return phoneNumber.replace(/[@s.whatsapp.net]/g, '').replace(/\D/g, '');
}

async function showTyping(jid, duration = TYPING_DELAY) {
  try {
    if (!isConnected || !sock) return;
    await sock.sendPresenceUpdate('composing', jid);
    
    return new Promise(resolve => {
      setTimeout(async () => {
        try {
          if (isConnected && sock) {
            await sock.sendPresenceUpdate('paused', jid);
          }
          resolve();
        } catch (error) {
          console.error("❌ Error clearing typing state:", error.message);
          resolve();
        }
      }, duration);
    });
  } catch (error) {
    console.error("❌ Error showing typing indicator:", error.message);
  }
}

// Enhanced AI API call with batched messages
async function getAIResponse(messages, phoneNumber) {
  const chatId = generateChatId(phoneNumber);
  
  // Combine multiple messages into one context
  let combinedMessage = '';
  if (Array.isArray(messages) && messages.length > 1) {
    combinedMessage = messages.map((msg, index) => 
      `Message ${index + 1}: ${msg}`
    ).join('\n\n');
    combinedMessage = `User sent ${messages.length} messages in sequence:\n\n${combinedMessage}\n\nPlease provide one comprehensive response addressing all the messages above.`;
  } else {
    combinedMessage = Array.isArray(messages) ? messages[0] : messages;
  }
  
  const payload = {
    id: chatId,
    phoneNumber: cleanPhoneNumber(phoneNumber),
    messages: [
      {
        role: "user",
        content: combinedMessage
      }
    ]
  };

  console.log("🚀 Calling AI API with payload:", JSON.stringify(payload, null, 2));

  try {
    const response = await axios.post(`https://${AI_API_URL}`, payload, {
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "WhatsApp-Bot/1.0"
      },
      timeout: 30000,
      responseType: 'text'
    });

    console.log("✅ AI API response status:", response.status);

    // Parse streaming response
    let fullResponse = '';
    const lines = response.data.split('\n');
    
    for (const line of lines) {
      const trimmedLine = line.trim();
      
      const textMatch = trimmedLine.match(/^\d+:"(.*)"/);
      if (textMatch && textMatch[1]) {
        let text = textMatch[1];
        
        text = text
          .replace(/\\"/g, '"')
          .replace(/\\n/g, '\n')
          .replace(/\\\\/g, '\\')
          .replace(/\\'/g, "'");
        
        fullResponse += text;
      }
    }

    fullResponse = fullResponse
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/\n\s*\n/g, '\n');

    if (fullResponse && fullResponse.length > 0) {
      console.log("✅ Final extracted response:", fullResponse.substring(0, 100) + "...");
      return fullResponse;
    }

    return "I'm here to help! Please ask me anything.";

  } catch (error) {
    console.error("❌ AI API Error:", error.message);
    throw error;
  }
}

// Message batching system
function addMessageToBatch(jid, messageContent) {
  const now = Date.now();
  
  if (!userMessageTimers.has(jid)) {
    userMessageTimers.set(jid, {
      timeout: null,
      messages: [],
      lastMessageTime: now
    });
  }
  
  const timerData = userMessageTimers.get(jid);
  
  // Clear existing timeout
  if (timerData.timeout) {
    clearTimeout(timerData.timeout);
  }
  
  // Add message to batch
  timerData.messages.push(messageContent);
  timerData.lastMessageTime = now;
  
  console.log(`📝 Added message to batch for ${cleanPhoneNumber(jid)}. Total: ${timerData.messages.length}`);
  
  // Set new timeout
  timerData.timeout = setTimeout(async () => {
    await processBatchedMessages(jid);
  }, MESSAGE_BATCH_DELAY);
  
  userMessageTimers.set(jid, timerData);
}

async function processBatchedMessages(jid) {
  try {
    const timerData = userMessageTimers.get(jid);
    if (!timerData || timerData.messages.length === 0) {
      return;
    }
    
    const messages = [...timerData.messages];
    const cleanPhone = cleanPhoneNumber(jid);
    
    console.log(`🔄 Processing ${messages.length} batched messages from ${cleanPhone}`);
    
    // Clear the batch
    timerData.messages = [];
    timerData.timeout = null;
    userMessageTimers.set(jid, timerData);
    
    // Show typing indicator
    await showTyping(jid);
    
    try {
      // Get AI response for all messages
      const aiResponse = await getAIResponse(messages, jid);
      
      // Send response if connected
      if (isConnected && sock) {
        await sock.sendMessage(jid, { text: aiResponse });
        console.log("✅ Batched response sent successfully");
      } else {
        // Store as pending if not connected
        addToPendingMessages(jid, aiResponse);
      }
      
    } catch (aiError) {
      console.error("❌ AI Error for batched messages:", aiError.message);
      
      let errorMessage = "Sorry, I'm having trouble processing your messages right now. Please try again in a moment.";
      
      if (isConnected && sock) {
        await sock.sendMessage(jid, { text: errorMessage });
      } else {
        addToPendingMessages(jid, errorMessage);
      }
    }
    
  } catch (error) {
    console.error("❌ Error processing batched messages:", error);
  }
}

// Pending messages system for offline resilience
function addToPendingMessages(jid, message) {
  if (!pendingMessages.has(jid)) {
    pendingMessages.set(jid, []);
  }
  pendingMessages.get(jid).push({
    message: message,
    timestamp: Date.now()
  });
  console.log(`📤 Added pending message for ${cleanPhoneNumber(jid)}`);
  savePersistentData();
}

async function sendPendingMessages() {
  if (pendingMessages.size === 0) return;
  
  console.log(`📬 Sending ${pendingMessages.size} pending messages...`);
  
  for (const [jid, messages] of pendingMessages.entries()) {
    try {
      for (const msgData of messages) {
        if (isConnected && sock) {
          await sock.sendMessage(jid, { text: msgData.message });
          await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay between messages
        }
      }
      console.log(`✅ Sent ${messages.length} pending messages to ${cleanPhoneNumber(jid)}`);
    } catch (error) {
      console.error(`❌ Failed to send pending messages to ${cleanPhoneNumber(jid)}:`, error.message);
      continue; // Continue with next user
    }
  }
  
  // Clear pending messages after sending
  pendingMessages.clear();
  savePersistentData();
}

// Handle incoming messages with batching
async function handleIncomingMessage(msg) {
  try {
    const messageId = `${msg.key.remoteJid}_${msg.messageTimestamp}_${msg.key.id}`;
    
    if (processedMessages.has(messageId)) {
      return;
    }
    
    if (processingLock.has(messageId)) {
      return;
    }
    
    const messageContent = msg.message?.conversation || 
                          msg.message?.extendedTextMessage?.text ||
                          msg.message?.imageMessage?.caption ||
                          '';
    
    // Skip if message is from bot itself, empty, or from group
    if (msg.key.fromMe || !messageContent || messageContent.trim() === '' || msg.key.remoteJid.endsWith('@g.us')) {
      return;
    }
    
    const phoneNumber = msg.key.remoteJid;
    const userMessage = messageContent.trim();
    const cleanPhone = cleanPhoneNumber(phoneNumber);
    
    console.log(`📱 Received message from ${cleanPhone}: "${userMessage}"`);
    
    // Add to message batch instead of processing immediately
    addMessageToBatch(phoneNumber, userMessage);
    
    // Mark as processed
    processedMessages.add(messageId);
    
    // Clean up old processed messages
    if (processedMessages.size > 200) {
      const entries = Array.from(processedMessages);
      entries.slice(0, 100).forEach(entry => processedMessages.delete(entry));
    }
    
  } catch (error) {
    console.error("❌ Message handling error:", error);
  }
}

// Enhanced connection management
async function connectToWhatsApp() {
  try {
    console.log(`🔄 Connection attempt ${reconnectAttempts + 1}/${MAX_RECONNECT_ATTEMPTS}`);
    
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    
    sock = makeWASocket({
      logger,
      printQRInTerminal: false,
      auth: state,
      defaultQueryTimeoutMs: 60 * 1000,
      generateHighQualityLinkPreview: true,
      syncFullHistory: false,
      markOnlineOnConnect: true,
      browser: ["WhatsApp Bot", "Chrome", "1.0.0"],
      keepAliveIntervalMs: 30000, // Send keep-alive every 30 seconds
      connectTimeoutMs: 60000, // 60 seconds connection timeout
      emitOwnEvents: false, // Don't emit events for own messages
    });

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;
      
      if (qr && !qrGenerated) {
        console.log("📱 Scan this QR code to log in:");
        qrcode.generate(qr, { small: true });
        qrGenerated = true;
        console.log("⏳ Waiting for QR scan...");
      }
      
      if (connection === 'close') {
        isConnected = false;
        qrGenerated = false;
        
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        
        console.log('🔌 Connection closed:', {
          reason: lastDisconnect?.error?.output?.payload?.message || 'Unknown',
          statusCode: statusCode,
          willReconnect: shouldReconnect
        });
        
        if (shouldReconnect && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
          reconnectAttempts++;
          console.log(`🔄 Reconnecting in ${RECONNECT_DELAY/1000} seconds... (Attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
          setTimeout(connectToWhatsApp, RECONNECT_DELAY);
        } else if (statusCode === DisconnectReason.loggedOut) {
          console.log('❌ Logged out, please restart the bot and scan QR again');
          process.exit(1);
        } else {
          console.log('❌ Max reconnection attempts reached');
          process.exit(1);
        }
      } else if (connection === 'open') {
        isConnected = true;
        reconnectAttempts = 0;
        qrGenerated = false;
        
        console.log('✅ WhatsApp bot is ready!');
        console.log('🤖 Bot info:', sock.user);
        
        // Send pending messages after connection
        setTimeout(sendPendingMessages, 2000);
      } else if (connection === 'connecting') {
        console.log('🔄 Connecting to WhatsApp...');
      }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;
      
      for (const message of messages) {
        await handleIncomingMessage(message);
      }
    });

    // Handle connection errors
    sock.ev.on('error', (error) => {
      console.error('🚨 Socket error:', error);
    });

  } catch (error) {
    console.error('❌ Failed to create WhatsApp connection:', error);
    
    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      reconnectAttempts++;
      setTimeout(connectToWhatsApp, RECONNECT_DELAY);
    } else {
      console.log('❌ Max connection attempts reached');
      process.exit(1);
    }
  }
}

// Express server for monitoring and control
app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    status: "✅ WhatsApp bot server running",
    aiApiUrl: AI_API_URL,
    timestamp: new Date().toISOString(),
    port: PORT,
    platform: "Termux/Baileys",
    connected: isConnected,
    pendingMessages: pendingMessages.size,
    activeTimers: userMessageTimers.size,
    reconnectAttempts: reconnectAttempts
  });
});

app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    whatsappReady: isConnected,
    botUser: sock?.user || null,
    timestamp: new Date().toISOString()
  });
});

app.get("/stats", (req, res) => {
  res.json({
    connected: isConnected,
    pendingMessages: pendingMessages.size,
    activeMessageTimers: userMessageTimers.size,
    processedMessages: processedMessages.size,
    reconnectAttempts: reconnectAttempts,
    uptime: process.uptime(),
    memoryUsage: process.memoryUsage()
  });
});

// Manual trigger endpoints
app.post("/send-pending", async (req, res) => {
  if (!isConnected) {
    return res.status(503).json({ error: "Bot not connected" });
  }
  
  await sendPendingMessages();
  res.json({ message: "Pending messages sent" });
});

app.post("/reconnect", (req, res) => {
  if (!isConnected) {
    connectToWhatsApp();
    res.json({ message: "Reconnection initiated" });
  } else {
    res.json({ message: "Already connected" });
  }
});

// Error handling
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  savePersistentData();
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  savePersistentData();
});

// Load persistent data on startup
loadPersistentData();

// Start the server
app.listen(PORT, () => {
  console.log(`🚀 WhatsApp bot server listening on port ${PORT}`);
  console.log(`🔗 Health check: http://localhost:${PORT}/health`);
  console.log(`📊 Stats: http://localhost:${PORT}/stats`);
});

// Start WhatsApp connection
console.log("🚀 Starting WhatsApp client for Termux...");
connectToWhatsApp().catch(err => {
  console.error('❌ Failed to connect to WhatsApp:', err);
});