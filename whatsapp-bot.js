const { Client } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const express = require("express");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3002; // Changed to 3002 to avoid conflicts

// Configuration
const AI_API_URL = process.env.AI_API_URL || "admin-dash.webvantic.studio/api/whatsapp";
const TYPING_DELAY = 2000; // 2 seconds typing indicator

console.log("🔧 Configuration:");
console.log("- AI API URL:", AI_API_URL);
console.log("- Typing delay:", TYPING_DELAY + "ms");
console.log("- Port:", PORT);

// WhatsApp Client with session support
const client = new Client({
  authStrategy: new (require('whatsapp-web.js').LocalAuth)({
    clientId: "whatsapp-ai-bot"
  }),
  puppeteer: {
    headless: false, // Set to false for debugging
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu',
      '--disable-web-security',
      '--disable-features=VizDisplayCompositor'
    ]
  },
  webVersionCache: {
    type: 'remote',
    remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
  }
});

// Utility function to generate chat ID
function generateChatId(phoneNumber) {
  return `whatsapp_${phoneNumber}_${Date.now()}`;
}

// Utility function to clean phone number
function cleanPhoneNumber(phoneNumber) {
  return phoneNumber.replace(/[@c.us]/g, '').replace(/\D/g, '');
}

// Function to show typing indicator
async function showTyping(message, duration = TYPING_DELAY) {
  try {
    const chat = await message.getChat();
    await chat.sendStateTyping();
    
    return new Promise(resolve => {
      setTimeout(async () => {
        try {
          await chat.clearState();
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

// Function to call AI API with improved response filtering
async function getAIResponse(userMessage, phoneNumber) {
  const chatId = generateChatId(phoneNumber);
  
  const payload = {
    id: chatId,
    phoneNumber: cleanPhoneNumber(phoneNumber),
    messages: [
      {
        role: "user",
        content: userMessage
      }
    ]
  };

  console.log("🚀 Calling AI API with payload:", JSON.stringify(payload, null, 2));

  try {
    const response = await axios.post(AI_API_URL, payload, {
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "WhatsApp-Bot/1.0"
      },
      timeout: 30000,
      responseType: 'text'
    });

    console.log("✅ AI API response status:", response.status);
    console.log("📥 Raw response data:", response.data);

    // Parse streaming response - improved parsing for the specific format
    let fullResponse = '';
    const lines = response.data.split('\n');
    
    for (const line of lines) {
      const trimmedLine = line.trim();
      console.log("🔍 Processing line:", trimmedLine);
      
      // Parse format like: 0:"Hello world" or any number:"content"
      const textMatch = trimmedLine.match(/^\d+:"(.*)"/);
      if (textMatch && textMatch[1]) {
        let text = textMatch[1];
        
        // Unescape the text properly
        text = text
          .replace(/\\"/g, '"')     // Fix escaped quotes
          .replace(/\\n/g, '\n')   // Fix newlines
          .replace(/\\\\/g, '\\')  // Fix escaped backslashes
          .replace(/\\'/g, "'");   // Fix escaped single quotes
        
        console.log("✅ Extracted text:", text);
        fullResponse += text;
      }
      
      // Skip lines that start with 'e:' or 'd:' (metadata)
      if (trimmedLine.startsWith('e:') || trimmedLine.startsWith('d:')) {
        console.log("⏭️ Skipping metadata line");
        continue;
      }
    }

    // Clean up the final response
    fullResponse = fullResponse
      .trim()
      .replace(/\s+/g, ' ')  // Replace multiple spaces with single space
      .replace(/\n\s*\n/g, '\n'); // Remove empty lines

    if (fullResponse && fullResponse.length > 0) {
      console.log("✅ Final extracted response:", fullResponse);
      return fullResponse;
    }

    // Enhanced fallback: try to extract any content from numbered lines
    console.log("⚠️ Primary parsing failed, trying fallback...");
    const fallbackLines = response.data.split('\n');
    let fallbackResponse = '';
    
    for (const line of fallbackLines) {
      const trimmedLine = line.trim();
      // Look for any line that starts with a number and colon, then extract quoted content
      const fallbackMatch = trimmedLine.match(/^\d+:"([^"]+)"/);
      if (fallbackMatch && fallbackMatch[1]) {
        fallbackResponse += fallbackMatch[1] + ' ';
      }
    }
    
    fallbackResponse = fallbackResponse.trim();
    
    if (fallbackResponse && fallbackResponse.length > 3) {
      console.log("✅ Using fallback response:", fallbackResponse);
      return fallbackResponse;
    }

    // Final fallback
    console.log("⚠️ All parsing methods failed, using default response");
    return "I'm here to help! Please ask me anything.";

  } catch (error) {
    console.error("❌ AI API Error Details:");
    console.error("- Message:", error.message);
    console.error("- Code:", error.code);
    
    if (error.response) {
      console.error("- Status:", error.response.status);
      console.error("- Status Text:", error.response.statusText);
      console.error("- Response data:", error.response.data);
    }
    
    // Return a more specific error message based on the error type
    if (error.code === 'ECONNREFUSED') {
      throw new Error("AI service is not running or unreachable");
    } else if (error.code === 'ENOTFOUND') {
      throw new Error("Cannot resolve AI service hostname");
    } else if (error.response && error.response.status === 404) {
      throw new Error("AI service endpoint not found");
    } else if (error.response && error.response.status >= 500) {
      throw new Error("AI service internal error");
    }
    
    throw error;
  }
}

// WhatsApp Event Handlers with more detailed logging
client.on("qr", qr => {
  console.log("📱 Scan this QR code to log in:");
  qrcode.generate(qr, { small: true });
  console.log("⏳ Waiting for QR scan...");
});

client.on("ready", () => {
  console.log("✅ WhatsApp bot is ready!");
  console.log("🔗 AI API URL:", AI_API_URL);
  console.log("📱 Bot Info:", client.info);
});

client.on("authenticated", () => {
  console.log("🔐 WhatsApp client authenticated successfully");
});

client.on("auth_failure", msg => {
  console.error("❌ Authentication failed:", msg);
});

client.on("disconnected", (reason) => {
  console.log("🔌 WhatsApp client disconnected:", reason);
  console.log("🔄 Attempting to reconnect...");
});

client.on("loading_screen", (percent, message) => {
  console.log("⏳ Loading screen:", percent, message);
});

// Track processed messages to avoid duplicates
const processedMessages = new Set();
const processingLock = new Set(); // Add processing lock to prevent concurrent processing

// Handle incoming messages - extracted to separate function
async function handleIncomingMessage(message) {
  try {
    // Create more robust unique message ID
    const messageId = `${message.from}_${message.timestamp}_${message.id?.id || 'no-id'}_${message.body?.substring(0, 50)}`;
    
    // Check if already processed
    if (processedMessages.has(messageId)) {
      console.log("🔄 Duplicate message detected, skipping...");
      return;
    }
    
    // Check if currently being processed
    if (processingLock.has(messageId)) {
      console.log("⏳ Message already being processed, skipping...");
      return;
    }
    
    // Add to processing lock
    processingLock.add(messageId);
    
    console.log("🔍 Processing message:", {
      from: message.from,
      body: message.body,
      type: message.type,
      isStatus: message.isStatus,
      fromMe: message.fromMe,
      messageId: messageId,
      timestamp: message.timestamp
    });

    // Skip if message is from status broadcast or empty
    if (message.isStatus || !message.body || message.body.trim() === '') {
      console.log("⏭️ Skipping: status broadcast or empty message");
      processingLock.delete(messageId);
      return;
    }

    // Skip if message is from a group (optional)
    const chat = await message.getChat();
    if (chat.isGroup) {
      console.log("👥 Skipping group message");
      processingLock.delete(messageId);
      return;
    }

    const phoneNumber = message.from;
    const userMessage = message.body.trim();
    const cleanPhone = cleanPhoneNumber(phoneNumber);

    console.log(`📱 Processing message from ${cleanPhone}: "${userMessage}"`);

    // Show typing indicator
    console.log("⌨️ Showing typing indicator...");
    await showTyping(message);

    try {
      // Get AI response
      console.log("🤖 Getting AI response...");
      const aiResponse = await getAIResponse(userMessage, phoneNumber);
      
      console.log("💬 AI Response:", aiResponse.substring(0, 100) + "...");

      // Send response
      await message.reply(aiResponse);
      console.log("✅ Message sent successfully");

      // Mark as processed after successful send
      processedMessages.add(messageId);
      
      // Clean up old processed messages (keep last 100)
      if (processedMessages.size > 100) {
        const entries = Array.from(processedMessages);
        entries.slice(0, 50).forEach(entry => processedMessages.delete(entry));
      }

    } catch (aiError) {
      console.error("❌ AI Error:", aiError.message);
      
      let errorMessage = "Sorry, I'm having trouble processing your request right now. Please try again in a moment.";
      
      if (aiError.code === 'ECONNREFUSED') {
        errorMessage = "🔧 AI service is currently unavailable. Please try again later.";
      } else if (aiError.response && aiError.response.status === 401) {
        errorMessage = "🔐 Authentication issue with AI service.";
      } else if (aiError.code === 'ENOTFOUND') {
        errorMessage = "🌐 Cannot connect to AI service. Please check the connection.";
      }
      
      await message.reply(errorMessage);
      // Mark as processed even if error to prevent retry loops
      processedMessages.add(messageId);
    }

  } catch (error) {
    console.error("❌ Message handling error:", error);
    try {
      await message.reply("Sorry, an unexpected error occurred. Please try again.");
    } catch (replyError) {
      console.error("❌ Failed to send error message:", replyError);
    }
  } finally {
    // Always remove from processing lock
    const messageId = `${message.from}_${message.timestamp}_${message.id?.id || 'no-id'}_${message.body?.substring(0, 50)}`;
    processingLock.delete(messageId);
  }
}

// ONLY use message_create event to prevent duplicates
client.on("message_create", async message => {
  // Only process messages sent TO the bot (not from the bot)
  if (message.fromMe) {
    return; // Skip outgoing messages silently
  }
  
  console.log("📨 Message detected via message_create event");
  await handleIncomingMessage(message);
});

// Initialize WhatsApp client
console.log("🚀 Starting WhatsApp client...");
console.log("🔧 Debug mode: Browser window will be visible");
client.initialize();

// Express server for health checks
app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    status: "✅ WhatsApp bot server running",
    aiApiUrl: AI_API_URL,
    timestamp: new Date().toISOString(),
    port: PORT
  });
});

app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    whatsappReady: client.info !== null,
    timestamp: new Date().toISOString()
  });
});

// Error handling for uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

app.listen(PORT, () => {
  console.log(`🚀 WhatsApp bot server listening on port ${PORT}`);
  console.log(`🔗 Health check: http://localhost:${PORT}/health`);
});
