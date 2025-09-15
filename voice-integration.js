/**
 * Complete WhatsApp Bot Integration with Voice Support
 * 
 * This adds voice message handling to your existing bot with:
 * - Voice message detection
 * - Voice-to-voice responses
 * - Read receipts
 * - Typing indicators
 * - Error handling
 */

const {
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  downloadContentFromMessage,
  downloadMediaMessage
} = require('@whiskeysockets/baileys');
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');

// Voice API Configuration
const VOICE_API_CONFIG = {
  BASE_URL: 'http://localhost:3000', // Update this to your Gemini server URL
  ENDPOINTS: {
    VOICE: '/api/whatsapp/voice',
    VOICE_TEST: '/api/whatsapp/voice/test'
  },
  TIMEOUT: 30000,
  MAX_RETRIES: 3,
  RETRY_DELAY: 1000
};

/**
 * Extract voice message information from Baileys message
 */
async function extractVoiceMessage(msg, sock) {
  try {
    // Check if message contains audio
    if (!msg.message?.audioMessage) {
      return null;
    }

    const audioMessage = msg.message.audioMessage;
    
    // Validate it's a voice message (PTT = Push To Talk)
    if (!audioMessage.ptt) {
      console.log("📄 Audio message detected but not a voice message (PTT=false)");
      return null;
    }

    console.log("🎤 Voice message detected:", {
      duration: audioMessage.seconds,
      mimetype: audioMessage.mimetype,
      fileLength: audioMessage.fileLength
    });
    
    // Download the audio buffer
    const audioBuffer = await downloadMediaMessage(
      msg,
      'buffer',
      {},
      { 
        logger: console,
        reuploadRequest: sock.updateMediaMessage
      }
    );

    if (!audioBuffer) {
      throw new Error("Failed to download voice message");
    }

    // Extract message info
    const messageInfo = {
      messageId: msg.key.id || `voice_${Date.now()}`,
      phoneNumber: msg.key.remoteJid?.replace('@s.whatsapp.net', '') || '',
      audioBuffer: audioBuffer,
      mimeType: audioMessage.mimetype || 'audio/ogg',
      timestamp: msg.messageTimestamp || Date.now(),
      duration: audioMessage.seconds || 0
    };

    console.log(`✅ Voice message extracted: ${messageInfo.phoneNumber}, ${audioBuffer.length} bytes, ${messageInfo.duration}s`);
    return messageInfo;

  } catch (error) {
    console.error("❌ Error extracting voice message:", error);
    return null;
  }
}

/**
 * Process voice message through the Gemini AI API
 */
async function processVoiceMessage(voiceInfo, options = {}) {
  const config = { ...VOICE_API_CONFIG, ...options };
  let attempt = 0;
  
  while (attempt < config.MAX_RETRIES) {
    try {
      console.log(`🔄 Processing voice message (attempt ${attempt + 1}/${config.MAX_RETRIES})`);
      
      // Prepare form data
      const formData = new FormData();
      formData.append('audio', voiceInfo.audioBuffer, {
        filename: `voice_${voiceInfo.messageId}.ogg`,
        contentType: voiceInfo.mimeType
      });
      formData.append('phoneNumber', voiceInfo.phoneNumber);
      formData.append('messageId', voiceInfo.messageId);
      formData.append('responseAsVoice', 'true'); // Request voice response

      // Send to voice processing API
      const response = await axios.post(
        `${config.BASE_URL}${config.ENDPOINTS.VOICE}`,
        formData,
        {
          headers: {
            ...formData.getHeaders(),
          },
          timeout: config.TIMEOUT,
          responseType: 'arraybuffer' // For voice responses
        }
      );

      console.log("✅ Voice API response received:", {
        status: response.status,
        contentType: response.headers['content-type'],
        transcription: response.headers['x-transcription'],
        responseType: response.headers['x-response-type']
      });

      // Check if response is voice or text
      const responseType = response.headers['x-response-type'];
      const transcription = response.headers['x-transcription'] 
        ? decodeURIComponent(response.headers['x-transcription']) 
        : undefined;

      if (responseType === 'voice') {
        // Voice response
        return {
          success: true,
          type: 'voice',
          transcription,
          audioBuffer: Buffer.from(response.data),
          messageId: voiceInfo.messageId
        };
      } else {
        // Text response (fallback)
        let responseText = response.data.toString();
        
        // Parse streaming response if needed
        if (responseText.includes('data:')) {
          let fullResponse = '';
          const lines = responseText.split('\n');
          
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.substring(6));
                if (data.type === 'text') {
                  fullResponse += data.value;
                }
              } catch (e) {
                // Ignore parse errors for streaming data
              }
            }
          }
          responseText = fullResponse || responseText;
        }

        return {
          success: true,
          type: 'text',
          transcription,
          response: responseText || 'Voice message processed successfully',
          messageId: voiceInfo.messageId
        };
      }

    } catch (error) {
      attempt++;
      console.error(`❌ Voice processing attempt ${attempt} failed:`, error.message);
      
      if (attempt >= config.MAX_RETRIES) {
        return {
          success: false,
          error: error.response?.data?.message || error.message || 'Voice processing failed',
          messageId: voiceInfo.messageId
        };
      }
      
      // Wait before retry
      await new Promise(resolve => setTimeout(resolve, config.RETRY_DELAY));
    }
  }

  return {
    success: false,
    error: 'Maximum retry attempts reached',
    messageId: voiceInfo.messageId
  };
}

/**
 * Enhanced voice message handler with read receipts and typing indicators
 */
async function handleVoiceMessage(msg, sock) {
  const jid = msg.key.remoteJid;
  
  try {
    console.log("🎤 Handling voice message from:", jid);
    
    // Step 1: Send read receipt immediately
    try {
      await sock.readMessages([msg.key]);
      console.log("✓ Read receipt sent");
    } catch (readError) {
      console.error("❌ Failed to send read receipt:", readError.message);
    }

    // Step 2: Wait 2 seconds before showing typing
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Step 3: Extract voice message info
    const voiceInfo = await extractVoiceMessage(msg, sock);
    if (!voiceInfo) {
      console.log("❌ Could not extract voice message info");
      return;
    }

    // Step 4: Show typing indicator
    try {
      await sock.sendPresenceUpdate('composing', jid);
      console.log("✓ Typing indicator shown");
    } catch (typingError) {
      console.error("❌ Failed to show typing:", typingError.message);
    }
    
    // Step 5: Process the voice message
    const result = await processVoiceMessage(voiceInfo);
    
    // Step 6: Send response based on result type
    if (result.success) {
      if (result.type === 'voice' && result.audioBuffer) {
        // Send voice response
        try {
          // Save voice buffer to temp file
          const tempDir = './temp_voice_responses';
          if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
          }
          
          const voiceFileName = `response_${Date.now()}.ogg`;
          const voiceFilePath = path.join(tempDir, voiceFileName);
          fs.writeFileSync(voiceFilePath, result.audioBuffer);
          
          // Send voice message
          await sock.sendMessage(jid, { 
            audio: { url: voiceFilePath },
            mimetype: 'audio/ogg; codecs=opus',
            ptt: true // Mark as voice message
          });
          
          console.log(`✅ Voice response sent to ${voiceInfo.phoneNumber}`);
          
          // Clean up temp file after sending
          setTimeout(() => {
            try {
              fs.unlinkSync(voiceFilePath);
              console.log(`🗑️ Cleaned up temp voice file: ${voiceFileName}`);
            } catch (cleanupError) {
              console.error("❌ Error cleaning up voice file:", cleanupError.message);
            }
          }, 5000);
          
        } catch (voiceError) {
          console.error("❌ Failed to send voice response:", voiceError.message);
          // Fallback to text
          await sock.sendMessage(jid, { text: "I processed your voice message but couldn't send a voice response. Please try again." });
        }
        
      } else if (result.response) {
        // Send text response
        await sock.sendMessage(jid, { text: result.response });
        console.log(`✅ Text response sent to ${voiceInfo.phoneNumber}`);
      }
      
      // Optionally send transcription in a separate message
      if (result.transcription && result.transcription.trim()) {
        setTimeout(async () => {
          try {
            await sock.sendMessage(jid, { 
              text: `🎤 *Voice transcription:* ${result.transcription}` 
            });
          } catch (transcriptError) {
            console.error("❌ Failed to send transcription:", transcriptError.message);
          }
        }, 1000);
      }
      
    } else {
      // Send error message
      const errorMessage = result.error || "Sorry, I couldn't process your voice message. Please try again.";
      await sock.sendMessage(jid, { text: `❌ ${errorMessage}` });
      console.log(`❌ Voice message processing failed for ${voiceInfo.phoneNumber}: ${result.error}`);
    }

  } catch (error) {
    console.error("❌ Error in handleVoiceMessage:", error);
    
    // Send generic error message to user
    try {
      await sock.sendMessage(jid, { 
        text: "❌ Sorry, I encountered an error processing your voice message. Please try again later." 
      });
    } catch (sendError) {
      console.error("❌ Failed to send error message:", sendError);
    }
  } finally {
    // Stop typing indicator
    try {
      await sock.sendPresenceUpdate('paused', jid);
      console.log("✓ Typing indicator cleared");
    } catch (pauseError) {
      console.error("❌ Failed to clear typing:", pauseError.message);
    }
  }
}

/**
 * Test voice API connectivity
 */
async function testVoiceAPI() {
  try {
    console.log("🧪 Testing voice API connectivity...");
    
    const response = await axios.get(`${VOICE_API_CONFIG.BASE_URL}${VOICE_API_CONFIG.ENDPOINTS.VOICE}`, {
      timeout: 5000
    });
    
    if (response.status === 200) {
      console.log("✅ Voice API is healthy:", response.data);
      return true;
    }
    
    return false;
  } catch (error) {
    console.error("❌ Voice API test failed:", error.message);
    return false;
  }
}

// Export functions for integration
module.exports = {
  handleVoiceMessage,
  extractVoiceMessage,
  processVoiceMessage,
  testVoiceAPI,
  VOICE_API_CONFIG
};
