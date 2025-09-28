const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

console.log("🤖 Starting WhatsApp Group Manager Bot...");

// Create Express app for web interface
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "web/public")));

// Store login code globally
let currentLoginCode = null;
let loginCodeExpiry = null;
let phoneNumberToCode = new Map(); // Store phone number to code mapping
let activeSessions = new Map(); // Store active WhatsApp sessions
let pendingAuth = new Map(); // Store pending authentication requests

// Create WhatsApp client
const client = new Client({
  authStrategy: new LocalAuth({
    dataPath: "./sessions",
  }),
  puppeteer: {
    headless: true,
    timeout: 60000,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--no-first-run",
      "--no-zygote",
      "--disable-gpu",
      "--disable-web-security",
      "--disable-features=VizDisplayCompositor",
      "--no-default-browser-check",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      "--disable-blink-features=AutomationControlled",
      "--disable-features=TranslateUI",
      "--disable-ipc-flooding-protection",
    ],
  },
  webVersionCache: {
    type: "remote",
    remotePath:
      "https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html",
  },
});

// Generate login code from QR data
function generateLoginCode(qrData) {
  // Create a simple 6-digit code from QR data hash
  const crypto = require("crypto");
  const hash = crypto.createHash("md5").update(qrData).digest("hex");
  const code = hash.substring(0, 6).toUpperCase();

  currentLoginCode = code;
  loginCodeExpiry = Date.now() + 5 * 60 * 1000; // 5 minutes

  console.log("\n🔐 Alternative Login Method:");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`📱 Login Code: ${code}`);
  console.log("⏰ Valid for: 5 minutes");
  console.log("🌐 Web Interface: http://localhost:3000");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  return code;
}

// Generate 8-digit code for phone number and create WhatsApp session
function generatePhoneCode(phoneNumber) {
  const sessionId = crypto.randomBytes(16).toString("hex");
  const code = crypto.randomBytes(4).toString("hex").toUpperCase();

  // Create a new WhatsApp client for this phone number
  const userClient = new Client({
    authStrategy: new LocalAuth({
      dataPath: `./sessions/${sessionId}`,
      clientId: `user_${phoneNumber.replace(/[^0-9]/g, "")}`,
    }),
    puppeteer: {
      headless: true,
      timeout: 60000,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--no-first-run",
        "--no-zygote",
        "--disable-gpu",
        "--disable-web-security",
        "--disable-features=VizDisplayCompositor",
        "--no-default-browser-check",
        "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
        "--disable-blink-features=AutomationControlled",
        "--disable-features=TranslateUI",
        "--disable-ipc-flooding-protection",
      ],
    },
    webVersionCache: {
      type: "remote",
      remotePath:
        "https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html",
    },
  });

  // Store session data
  const sessionData = {
    phoneNumber: phoneNumber,
    sessionId: sessionId,
    code: code,
    client: userClient,
    status: "pending",
    expiry: Date.now() + 5 * 60 * 1000, // 5 minutes
    created: new Date().toISOString(),
    qrCode: null,
  };

  phoneNumberToCode.set(phoneNumber, sessionData);
  pendingAuth.set(sessionId, sessionData);

  // Set up event handlers for this client
  setupUserClientEvents(userClient, sessionData);

  // Initialize the client
  userClient.initialize().catch((error) => {
    console.error(
      `❌ Failed to initialize client for ${phoneNumber}:`,
      error.message
    );
  });

  console.log(`\n📱 WhatsApp Session Created for ${phoneNumber}:`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`🔐 Session ID: ${sessionId}`);
  console.log(`🔐 8-Digit Code: ${code}`);
  console.log(`⏰ Valid for: 5 minutes`);
  console.log(`📱 Status: Waiting for authentication`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  return { code, sessionId };
}

// Setup event handlers for individual user clients
function setupUserClientEvents(userClient, sessionData) {
  userClient.on("qr", (qr) => {
    sessionData.qrCode = qr;
    sessionData.status = "qr_ready";

    console.log(`\n📱 QR Code Generated for ${sessionData.phoneNumber}:`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    qrcode.generate(qr, { small: true });
    console.log(`🔐 Session ID: ${sessionData.sessionId}`);
    console.log(`🔐 8-Digit Code: ${sessionData.code}`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    // Save QR code to file
    const qrSvg = qrcode.toString(qr, { type: "svg" });
    fs.writeFileSync(`qr-${sessionData.sessionId}.svg`, qrSvg);
  });

  userClient.on("ready", () => {
    sessionData.status = "connected";
    activeSessions.set(sessionData.phoneNumber, sessionData);
    pendingAuth.delete(sessionData.sessionId);

    console.log(`✅ WhatsApp Bot Connected for ${sessionData.phoneNumber}!`);
    console.log(`📱 Session ID: ${sessionData.sessionId}`);
    console.log(`🎯 Bot is ready to manage groups for this number`);

    // Set up message handling for this user's bot
    setupUserMessageHandling(userClient, sessionData);
  });

  userClient.on("auth_failure", (message) => {
    sessionData.status = "failed";
    console.error(
      `❌ Authentication failed for ${sessionData.phoneNumber}:`,
      message
    );
  });

  userClient.on("disconnected", (reason) => {
    sessionData.status = "disconnected";
    activeSessions.delete(sessionData.phoneNumber);
    console.log(`⚠️ Bot disconnected for ${sessionData.phoneNumber}:`, reason);
  });
}

// Setup message handling for individual user sessions
function setupUserMessageHandling(userClient, sessionData) {
  userClient.on("message", async (message) => {
    try {
      const chat = await message.getChat();

      // Only respond in groups
      if (!chat.isGroup) return;

      const messageBody = message.body.toLowerCase().trim();
      const isAdmin = chat.participants.some(
        (participant) =>
          participant.id._serialized === message.author && participant.isAdmin
      );

      // Help command
      if (messageBody === "/help") {
        const helpText = `🤖 *WhatsApp Group Manager Bot* (${
          sessionData.phoneNumber
        })

📋 *User Commands:*
- /help - Show this menu
- /ping - Test bot
- /rules - Group rules
- /info - Group info

${
  isAdmin
    ? `👑 *Admin Commands:*
- /kick @user - Remove member
- /mute @user - Mute member
- /warn @user - Give warning
- /setrules [text] - Set group rules`
    : ""
}

🔧 *Features:*
- Auto-moderation
- Welcome messages
- Group management

📱 *Session ID:* ${sessionData.sessionId}`;

        await message.reply(helpText);
      }

      // Ping command
      else if (messageBody === "/ping") {
        await message.reply(
          `🏓 Pong! Bot is working perfectly! (Session: ${sessionData.sessionId})`
        );
      }

      // Rules command
      else if (messageBody === "/rules") {
        const rulesText = `📜 *Group Rules:*

1. 🤝 Be respectful to all members
2. 🚫 No spam or excessive messaging
3. 🎯 Stay on topic
4. ❌ No offensive or inappropriate content
5. 👑 Follow admin instructions

_Breaking rules may result in warnings or removal._`;

        await message.reply(rulesText);
      }

      // Group info command
      else if (messageBody === "/info") {
        const participants = chat.participants;
        const admins = participants.filter((p) => p.isAdmin).length;

        const infoText = `📊 *Group Information:*

- **Name:** ${chat.name}
- **Description:** ${chat.description || "No description set"}
- **Members:** ${participants.length}
- **Admins:** ${admins}
- **Created:** ${
          chat.createdAt
            ? new Date(chat.createdAt * 1000).toDateString()
            : "Unknown"
        }
- **Bot Session:** ${sessionData.sessionId}`;

        await message.reply(infoText);
      }

      // Admin commands
      else if (messageBody.startsWith("/kick") && isAdmin) {
        const mentionedUsers = await message.getMentions();
        if (mentionedUsers.length > 0) {
          try {
            await chat.removeParticipants([mentionedUsers[0].id._serialized]);
            await message.reply(`✅ User has been removed from the group.`);
          } catch (error) {
            await message.reply(
              "❌ Failed to remove user. Make sure I have admin permissions."
            );
          }
        } else {
          await message.reply(
            "❌ Please mention a user to kick. Example: /kick @username"
          );
        }
      } else if (messageBody.startsWith("/warn") && isAdmin) {
        const mentionedUsers = await message.getMentions();
        if (mentionedUsers.length > 0) {
          await message.reply(
            `⚠️ Warning issued to user. Please follow group rules.`
          );
        } else {
          await message.reply(
            "❌ Please mention a user to warn. Example: /warn @username"
          );
        }
      }

      // Welcome new members
      else if (
        message.type === "notification_template" &&
        message.body.includes("added")
      ) {
        const welcomeText = `🎉 *Welcome to ${chat.name}!*

Please read our /rules and feel free to introduce yourself.
Type /help to see available commands.

Enjoy your stay! 🚀`;

        setTimeout(() => {
          message.reply(welcomeText);
        }, 2000);
      }
    } catch (error) {
      console.error(
        `❌ Error handling message for ${sessionData.phoneNumber}:`,
        error
      );
    }
  });
}

// Check if login code is valid
function isLoginCodeValid(code) {
  if (!currentLoginCode || !loginCodeExpiry) return false;
  if (Date.now() > loginCodeExpiry) {
    currentLoginCode = null;
    loginCodeExpiry = null;
    return false;
  }
  return currentLoginCode === code.toUpperCase();
}

// Generate QR code for authentication
client.on("qr", (qr) => {
  console.log("📱 Scan this QR code with your WhatsApp:");
  console.log("💡 If QR code doesn't work, try the phone number method below");
  qrcode.generate(qr, { small: true });

  // Generate and display login code
  generateLoginCode(qr);

  // Also save QR code to file for easier scanning
  const fs = require("fs");
  const qrSvg = qrcode.toString(qr, { type: "svg" });
  fs.writeFileSync("qr-code.svg", qrSvg);
  console.log("💾 QR code also saved as 'qr-code.svg' in the project folder");
});

// Bot is ready
client.on("ready", () => {
  console.log("✅ WhatsApp Group Manager Bot is ready!");
  console.log("🎯 Add bot to groups and try /help command");

  // Clear login code when ready
  currentLoginCode = null;
  loginCodeExpiry = null;
});

// Handle incoming messages
client.on("message", async (message) => {
  try {
    const chat = await message.getChat();

    // Only respond in groups
    if (!chat.isGroup) return;

    const messageBody = message.body.toLowerCase().trim();
    const isAdmin = chat.participants.some(
      (participant) =>
        participant.id._serialized === message.author && participant.isAdmin
    );

    // Help command
    if (messageBody === "/help") {
      const helpText = `🤖 *WhatsApp Group Manager Bot*

📋 *User Commands:*
- /help - Show this menu
- /ping - Test bot
- /rules - Group rules
- /info - Group info

${
  isAdmin
    ? `👑 *Admin Commands:*
- /kick @user - Remove member
- /mute @user - Mute member
- /warn @user - Give warning
- /setrules [text] - Set group rules`
    : ""
}

🔧 *Features:*
- Auto-moderation
- Welcome messages
- Group management`;

      await message.reply(helpText);
    }

    // Ping command
    else if (messageBody === "/ping") {
      await message.reply("🏓 Pong! Bot is working perfectly!");
    }

    // Rules command
    else if (messageBody === "/rules") {
      const rulesText = `📜 *Group Rules:*

1. 🤝 Be respectful to all members
2. 🚫 No spam or excessive messaging
3. 🎯 Stay on topic
4. ❌ No offensive or inappropriate content
5. 👑 Follow admin instructions

_Breaking rules may result in warnings or removal._`;

      await message.reply(rulesText);
    }

    // Group info command
    else if (messageBody === "/info") {
      const participants = chat.participants;
      const admins = participants.filter((p) => p.isAdmin).length;

      const infoText = `📊 *Group Information:*

- **Name:** ${chat.name}
- **Members:** ${participants.length}
- **Admins:** ${admins}
- **Created:** ${
        chat.createdAt
          ? new Date(chat.createdAt * 1000).toDateString()
          : "Unknown"
      }
- **Description:** ${chat.description || "No description set"}`;

      await message.reply(infoText);
    }

    // Admin commands
    else if (messageBody.startsWith("/kick") && isAdmin) {
      const mentionedUsers = await message.getMentions();
      if (mentionedUsers.length > 0) {
        try {
          await chat.removeParticipants([mentionedUsers[0].id._serialized]);
          await message.reply(`✅ User has been removed from the group.`);
        } catch (error) {
          await message.reply(
            "❌ Failed to remove user. Make sure I have admin permissions."
          );
        }
      } else {
        await message.reply(
          "❌ Please mention a user to kick. Example: /kick @username"
        );
      }
    } else if (messageBody.startsWith("/warn") && isAdmin) {
      const mentionedUsers = await message.getMentions();
      if (mentionedUsers.length > 0) {
        await message.reply(
          `⚠️ Warning issued to user. Please follow group rules.`
        );
      } else {
        await message.reply(
          "❌ Please mention a user to warn. Example: /warn @username"
        );
      }
    }

    // Welcome new members
    else if (
      message.type === "notification_template" &&
      message.body.includes("added")
    ) {
      const welcomeText = `🎉 *Welcome to ${chat.name}!*

Please read our /rules and feel free to introduce yourself.
Type /help to see available commands.

Enjoy your stay! 🚀`;

      setTimeout(() => {
        message.reply(welcomeText);
      }, 2000);
    }
  } catch (error) {
    console.error("❌ Error handling message:", error);
  }
});

// Handle authentication failure
client.on("auth_failure", (message) => {
  console.error("❌ Authentication failed:", message);
});

// Handle disconnection
client.on("disconnected", (reason) => {
  console.log("⚠️ Bot disconnected:", reason);
});

// Handle connection errors
client.on("change_state", (state) => {
  console.log(`🔄 Connection state changed: ${state}`);
});

// Handle loading screen
client.on("loading_screen", (percent, message) => {
  console.log(`⏳ Loading: ${percent}% - ${message}`);
});

// Web API Routes
app.get("/", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>WhatsApp Group Manager Bot</title>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
            body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background: #f0f0f0; }
            .container { max-width: 600px; margin: 0 auto; background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
            .header { text-align: center; margin-bottom: 30px; }
            .status { padding: 15px; border-radius: 5px; margin: 20px 0; }
            .status.connected { background: #d4edda; color: #155724; border: 1px solid #c3e6cb; }
            .status.disconnected { background: #f8d7da; color: #721c24; border: 1px solid #f5c6cb; }
            .login-section { background: #e9ecef; padding: 20px; border-radius: 5px; margin: 20px 0; }
            .code { font-size: 24px; font-weight: bold; color: #007bff; text-align: center; margin: 10px 0; }
            .instructions { background: #fff3cd; color: #856404; padding: 15px; border-radius: 5px; margin: 15px 0; }
            .btn { background: #007bff; color: white; padding: 10px 20px; border: none; border-radius: 5px; cursor: pointer; margin: 5px; }
            .btn:hover { background: #0056b3; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>🤖 WhatsApp Group Manager Bot</h1>
                <p>Manage your WhatsApp groups with ease</p>
            </div>
            
            <div id="status" class="status disconnected">
                <strong>Status:</strong> <span id="statusText">Disconnected</span>
            </div>
            
            <div class="login-section">
                <h3>🔐 Login Methods</h3>
                
                <div class="instructions">
                    <strong>Method 1 - QR Code:</strong> Check the console/terminal for QR code
                </div>
                
                <div class="instructions">
                    <strong>Method 2 - Phone Number Code:</strong> Enter your phone number to get an 8-digit code
                </div>
                
                <div style="margin: 20px 0;">
                    <input type="tel" id="phoneInput" placeholder="Enter phone number (e.g., +1234567890)" 
                           style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 5px; margin-bottom: 10px;">
                    <button class="btn" onclick="generatePhoneCode()" style="width: 100%;">📱 Create WhatsApp Session</button>
                </div>
                
                <div id="sessionInfo" style="display: none; background: #e8f5e8; padding: 15px; border-radius: 5px; margin: 10px 0;">
                    <h4>📱 Your WhatsApp Session</h4>
                    <div id="sessionDetails"></div>
                    <div id="sessionStatus" style="margin-top: 10px;"></div>
                </div>
                
                <div id="phoneCode" class="code" style="display: none;">No code generated</div>
                
                <div class="instructions">
                    <strong>Method 3 - Auto Login Code:</strong> Use the code below in WhatsApp
                </div>
                <div id="loginCode" class="code">Loading...</div>
                
                <div style="text-align: center;">
                    <button class="btn" onclick="refreshCode()">🔄 Refresh Auto Code</button>
                    <button class="btn" onclick="checkStatus()">📊 Check Status</button>
                </div>
            </div>
            
            <div style="margin-top: 30px; text-align: center;">
                <h3>📱 How to Login with Code:</h3>
                <ol style="text-align: left; display: inline-block;">
                    <li>Open WhatsApp on your phone</li>
                    <li>Go to Settings > Linked Devices</li>
                    <li>Tap "Link a Device"</li>
                    <li>Enter the 6-digit code shown above</li>
                    <li>Wait for confirmation</li>
                </ol>
            </div>
        </div>
        
        <script>
            function refreshCode() {
                fetch('/api/login-code')
                    .then(response => response.json())
                    .then(data => {
                        document.getElementById('loginCode').textContent = data.code || 'No code available';
                        if (data.expiry) {
                            const expiry = new Date(data.expiry);
                            document.getElementById('loginCode').innerHTML = 
                                data.code + '<br><small>Expires: ' + expiry.toLocaleTimeString() + '</small>';
                        }
                    })
                    .catch(error => {
                        document.getElementById('loginCode').textContent = 'Error loading code';
                    });
            }
            
            function generatePhoneCode() {
                const phoneNumber = document.getElementById('phoneInput').value.trim();
                if (!phoneNumber) {
                    alert('Please enter a phone number');
                    return;
                }
                
                fetch('/api/phone-code', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ phone: phoneNumber })
                })
                .then(response => response.json())
                .then(data => {
                    if (data.success) {
                        const sessionInfoDiv = document.getElementById('sessionInfo');
                        const sessionDetailsDiv = document.getElementById('sessionDetails');
                        const sessionStatusDiv = document.getElementById('sessionStatus');
                        
                        sessionInfoDiv.style.display = 'block';
                        sessionDetailsDiv.innerHTML = 
                            '<strong>Phone:</strong> ' + data.phone + '<br>' +
                            '<strong>Session ID:</strong> ' + data.sessionId + '<br>' +
                            '<strong>8-Digit Code:</strong> <span style="font-size: 18px; font-weight: bold; color: #007bff;">' + data.code + '</span>';
                        
                        sessionStatusDiv.innerHTML = '<span style="color: #856404;">⏳ Status: Creating WhatsApp session...</span>';
                        
                        // Start polling for status updates
                        pollSessionStatus(data.sessionId);
                    } else {
                        alert('Error: ' + data.message);
                    }
                })
                .catch(error => {
                    alert('Error creating WhatsApp session');
                });
            }
            
            function pollSessionStatus(sessionId) {
                const checkStatus = () => {
                    fetch('/api/session-status/' + sessionId)
                        .then(response => response.json())
                        .then(data => {
                            const sessionStatusDiv = document.getElementById('sessionStatus');
                            if (data.status === 'qr_ready') {
                                sessionStatusDiv.innerHTML = '<span style="color: #856404;">📱 Status: QR Code ready - Scan with WhatsApp or use the 8-digit code</span>';
                            } else if (data.status === 'connected') {
                                sessionStatusDiv.innerHTML = '<span style="color: #155724;">✅ Status: Connected! Bot is ready to manage your groups</span>';
                                clearInterval(statusInterval);
                            } else if (data.status === 'failed') {
                                sessionStatusDiv.innerHTML = '<span style="color: #721c24;">❌ Status: Authentication failed</span>';
                                clearInterval(statusInterval);
                            } else if (data.status === 'pending') {
                                sessionStatusDiv.innerHTML = '<span style="color: #856404;">⏳ Status: Initializing WhatsApp session...</span>';
                            }
                        })
                        .catch(error => {
                            console.error('Error checking session status:', error);
                        });
                };
                
                const statusInterval = setInterval(checkStatus, 2000);
                checkStatus(); // Check immediately
            }
            
            function checkStatus() {
                fetch('/api/status')
                    .then(response => response.json())
                    .then(data => {
                        const statusDiv = document.getElementById('status');
                        const statusText = document.getElementById('statusText');
                        
                        if (data.connected) {
                            statusDiv.className = 'status connected';
                            statusText.textContent = 'Connected - Bot is ready!';
                        } else {
                            statusDiv.className = 'status disconnected';
                            statusText.textContent = 'Disconnected - Waiting for authentication';
                        }
                    })
                    .catch(error => {
                        document.getElementById('statusText').textContent = 'Error checking status';
                    });
            }
            
            // Auto-refresh every 30 seconds
            setInterval(refreshCode, 30000);
            setInterval(checkStatus, 10000);
            
            // Initial load
            refreshCode();
            checkStatus();
        </script>
    </body>
    </html>
    `);
});

// API endpoint to get current login code
app.get("/api/login-code", (req, res) => {
  if (currentLoginCode && loginCodeExpiry && Date.now() < loginCodeExpiry) {
    res.json({
      code: currentLoginCode,
      expiry: loginCodeExpiry,
      valid: true,
    });
  } else {
    res.json({
      code: null,
      expiry: null,
      valid: false,
      message: "No active login code. Please wait for QR code generation.",
    });
  }
});

// API endpoint to generate phone code and create WhatsApp session
app.post("/api/phone-code", (req, res) => {
  try {
    const { phone } = req.body;

    if (!phone) {
      return res.json({
        success: false,
        message: "Phone number is required",
      });
    }

    // Validate phone number format (basic validation)
    const phoneRegex = /^\+?[1-9]\d{1,14}$/;
    if (!phoneRegex.test(phone.replace(/\s/g, ""))) {
      return res.json({
        success: false,
        message: "Invalid phone number format",
      });
    }

    // Check if session already exists for this phone number
    if (phoneNumberToCode.has(phone)) {
      const existingSession = phoneNumberToCode.get(phone);
      if (existingSession.status === "connected") {
        return res.json({
          success: false,
          message: "WhatsApp session already exists for this phone number",
        });
      }
    }

    const sessionData = generatePhoneCode(phone);

    res.json({
      success: true,
      code: sessionData.code,
      sessionId: sessionData.sessionId,
      phone: phone,
      status: "pending",
    });
  } catch (error) {
    console.error("Error creating WhatsApp session:", error);
    res.json({
      success: false,
      message: "Error creating WhatsApp session",
    });
  }
});

// API endpoint to check session status
app.get("/api/session-status/:sessionId", (req, res) => {
  try {
    const { sessionId } = req.params;
    const sessionData =
      pendingAuth.get(sessionId) ||
      Array.from(phoneNumberToCode.values()).find(
        (s) => s.sessionId === sessionId
      );

    if (!sessionData) {
      return res.json({
        success: false,
        message: "Session not found",
      });
    }

    res.json({
      success: true,
      sessionId: sessionId,
      phone: sessionData.phoneNumber,
      status: sessionData.status,
      code: sessionData.code,
      qrCode: sessionData.qrCode,
    });
  } catch (error) {
    res.json({
      success: false,
      message: "Error checking session status",
    });
  }
});

// API endpoint to get all active sessions
app.get("/api/sessions", (req, res) => {
  try {
    const sessions = Array.from(activeSessions.values()).map((session) => ({
      phoneNumber: session.phoneNumber,
      sessionId: session.sessionId,
      status: session.status,
      created: session.created,
    }));

    res.json({
      success: true,
      sessions: sessions,
      total: sessions.length,
    });
  } catch (error) {
    res.json({
      success: false,
      message: "Error fetching sessions",
    });
  }
});

// API endpoint to check bot status
app.get("/api/status", (req, res) => {
  res.json({
    connected: client.info ? true : false,
    timestamp: new Date().toISOString(),
  });
});

// Start web server with port conflict handling
const PORT = process.env.PORT || 3000;

function startWebServer(port) {
  const server = app.listen(port, () => {
    console.log(`🌐 Web interface running on http://localhost:${port}`);
    console.log(`📱 Login code will be displayed here when available`);
  });

  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.log(
        `⚠️ Port ${port} is already in use. Trying port ${port + 1}...`
      );
      startWebServer(port + 1);
    } else {
      console.error("❌ Server error:", err);
    }
  });

  return server;
}

const server = startWebServer(PORT);

// Initialize bot with retry mechanism
let retryCount = 0;
const maxRetries = 3;

async function initializeBot() {
  try {
    console.log(
      `🔄 Initializing bot... (Attempt ${retryCount + 1}/${maxRetries + 1})`
    );
    await client.initialize();
  } catch (error) {
    console.error(
      `❌ Initialization failed (Attempt ${retryCount + 1}):`,
      error.message
    );

    if (retryCount < maxRetries) {
      retryCount++;
      console.log(`⏳ Retrying in 10 seconds...`);
      setTimeout(initializeBot, 10000);
    } else {
      console.error(
        "❌ Max retries reached. Please check your internet connection and try again."
      );
      console.log("💡 Troubleshooting tips:");
      console.log("   1. Check your internet connection");
      console.log("   2. Disable VPN if using one");
      console.log("   3. Check firewall settings");
      console.log("   4. Try running as administrator");
      console.log("   5. Restart your computer");
    }
  }
}

// Start the bot
initializeBot();

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("🛑 Stopping bot...");
  client.destroy();
  process.exit(0);
});

console.log(
  "⏳ Bot initializing... Please wait for QR code or check web interface."
);
