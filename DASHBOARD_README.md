# WhatsApp Bot with React Dashboard

A WhatsApp bot with a React-based web dashboard for QR scanning, status monitoring, and bot management.

## Features

### Backend (Node.js + Baileys)
- ✅ WhatsApp bot using Baileys library
- ✅ QR code generation for authentication
- ✅ Auto-reconnection with retry logic
- ✅ Message batching and persistence
- ✅ Express.js API for monitoring
- ✅ CORS enabled for frontend access

### Frontend (React + TypeScript)
- ✅ Real-time bot status monitoring
- ✅ QR code display for WhatsApp authentication
- ✅ Connection management (reconnect, restart)
- ✅ Memory usage and performance metrics
- ✅ Responsive dashboard design
- ✅ Pending message management

## Local Development

### Prerequisites
- Node.js 16+ 
- npm or yarn

### Quick Start

1. **Clone and setup:**
   ```bash
   cd whatsapp-bot
   npm install
   cd frontend
   npm install
   cd ..
   ```

2. **Start development environment:**
   ```bash
   ./start-dev.sh
   ```

3. **Access the application:**
   - 🖥️ **Dashboard**: http://localhost:3000
   - 📡 **Backend API**: http://localhost:3002
   - 📊 **Stats**: http://localhost:3002/stats
   - 🏥 **Health**: http://localhost:3002/health

### Manual Setup

**Start Backend:**
```bash
node whatsapp-bot.js
```

**Start Frontend (in another terminal):**
```bash
cd frontend
npm start
```

## Railway Deployment

### Backend Deployment

1. **Create a new Railway project:**
   ```bash
   npm install -g @railway/cli
   railway login
   railway init
   ```

2. **Deploy backend:**
   ```bash
   railway up
   ```

3. **Set environment variables in Railway dashboard:**
   ```
   PORT=3002
   AI_API_URL=your-ai-api-url
   NODE_ENV=production
   ```

4. **Note your Railway backend URL** (e.g., `https://your-app.railway.app`)

### Frontend Deployment

1. **Update environment for production:**
   Edit `frontend/.env.production`:
   ```
   REACT_APP_API_BASE_URL=https://your-railway-backend-url.railway.app
   ```

2. **Build and deploy frontend:**
   ```bash
   cd frontend
   npm run build
   
   # Deploy to Railway, Vercel, or Netlify
   # For Railway:
   railway init
   railway up
   ```

### Alternative: Deploy as Single App

You can also serve the frontend from the backend:

1. **Build frontend:**
   ```bash
   cd frontend
   npm run build
   cp -r build/* ../public/
   ```

2. **Add static serving to backend:**
   ```javascript
   // Add to whatsapp-bot.js
   app.use(express.static('public'));
   
   app.get('*', (req, res) => {
     res.sendFile(path.join(__dirname, 'public', 'index.html'));
   });
   ```

3. **Deploy single app to Railway**

## Dashboard Features

### 🔌 Connection Status
- Real-time connection monitoring
- Bot user information
- Uptime and memory usage
- Reconnect attempts tracking

### 📱 QR Scanner
- Display QR codes for authentication
- Auto-refresh when disconnected
- Step-by-step scanning instructions

### 🔧 Connection Manager
- Manual reconnection triggers
- Pending message management
- Bot restart functionality
- Connection health indicators

### 📊 Performance Dashboard
- Memory usage visualization
- Message processing statistics
- System health metrics
- Performance scoring

## Troubleshooting

### Common Issues

1. **QR Code not appearing:**
   - Check backend logs
   - Ensure bot is not already connected
   - Try reconnecting from dashboard

2. **Frontend can't connect to backend:**
   - Verify CORS settings
   - Check API_BASE_URL in .env
   - Ensure backend is running

3. **Bot disconnects frequently:**
   - Check internet connection
   - Verify WhatsApp account status
   - Review reconnection logic

## License

MIT License - feel free to customize for your needs!
