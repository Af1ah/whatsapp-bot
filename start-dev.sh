#!/bin/bash

# WhatsApp Bot Development Starter Script

echo "🚀 Starting WhatsApp Bot Development Environment"
echo "=============================================="

# Check if we're in the right directory
if [ ! -f "whatsapp-bot.js" ]; then
    echo "❌ Error: whatsapp-bot.js not found. Please run this script from the bot directory."
    exit 1
fi

# Function to cleanup background processes
cleanup() {
    echo -e "\n🛑 Shutting down services..."
    if [ ! -z "$BACKEND_PID" ]; then
        kill $BACKEND_PID 2>/dev/null
        echo "✅ Backend stopped"
    fi
    if [ ! -z "$FRONTEND_PID" ]; then
        kill $FRONTEND_PID 2>/dev/null
        echo "✅ Frontend stopped"
    fi
    exit 0
}

# Setup signal handlers
trap cleanup SIGINT SIGTERM

# Start backend
echo "🔧 Starting WhatsApp Bot Backend..."
node whatsapp-bot.js &
BACKEND_PID=$!
echo "✅ Backend started (PID: $BACKEND_PID)"
echo "📡 Backend running on http://localhost:3002"

# Wait a moment for backend to initialize
sleep 3

# Start frontend
echo "🎨 Starting React Frontend..."
cd frontend
npm start &
FRONTEND_PID=$!
echo "✅ Frontend started (PID: $FRONTEND_PID)"
echo "🌐 Frontend running on http://localhost:3000"

cd ..

echo ""
echo "🎉 Development environment is ready!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📱 WhatsApp Bot Backend: http://localhost:3002"
echo "🖥️  React Dashboard:     http://localhost:3000"
echo "📊 Bot Stats:            http://localhost:3002/stats"
echo "🏥 Health Check:         http://localhost:3002/health"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "💡 Tips:"
echo "   • Open http://localhost:3000 to access the dashboard"
echo "   • Use the dashboard to scan QR codes and monitor bot status"
echo "   • Press Ctrl+C to stop both services"
echo ""

# Wait for both processes
wait $BACKEND_PID $FRONTEND_PID
