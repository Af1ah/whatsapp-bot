#!/bin/bash

# WhatsApp Bot Process Manager for Termux
# This script helps manage the bot as a persistent service

BOT_DIR="$HOME/whatsapp-bot"
BOT_SCRIPT="whatsapp-bot.js"
PID_FILE="$BOT_DIR/.bot.pid"
LOG_FILE="$BOT_DIR/bot.log"

cd "$BOT_DIR" || exit 1

case "$1" in
    start)
        if [ -f "$PID_FILE" ]; then
            PID=$(cat "$PID_FILE")
            if kill -0 "$PID" 2>/dev/null; then
                echo "Bot is already running (PID: $PID)"
                exit 1
            else
                echo "Removing stale PID file"
                rm "$PID_FILE"
            fi
        fi
        
        echo "Starting WhatsApp bot..."
        nohup node "$BOT_SCRIPT" >> "$LOG_FILE" 2>&1 &
        PID=$!
        echo $PID > "$PID_FILE"
        echo "Bot started with PID: $PID"
        echo "Log file: $LOG_FILE"
        ;;
        
    stop)
        if [ -f "$PID_FILE" ]; then
            PID=$(cat "$PID_FILE")
            echo "Stopping bot (PID: $PID)..."
            kill "$PID" 2>/dev/null
            sleep 2
            if kill -0 "$PID" 2>/dev/null; then
                echo "Force killing bot..."
                kill -9 "$PID" 2>/dev/null
            fi
            rm "$PID_FILE"
            echo "Bot stopped"
        else
            echo "Bot is not running"
        fi
        ;;
        
    restart)
        $0 stop
        sleep 3
        $0 start
        ;;
        
    status)
        if [ -f "$PID_FILE" ]; then
            PID=$(cat "$PID_FILE")
            if kill -0 "$PID" 2>/dev/null; then
                echo "Bot is running (PID: $PID)"
                echo "Started: $(ps -o lstart= -p "$PID" 2>/dev/null)"
                echo "Memory usage: $(ps -o rss= -p "$PID" 2>/dev/null | awk '{print $1/1024 " MB"}')"
            else
                echo "Bot is not running (stale PID file)"
                rm "$PID_FILE"
            fi
        else
            echo "Bot is not running"
        fi
        ;;
        
    logs)
        if [ -f "$LOG_FILE" ]; then
            tail -f "$LOG_FILE"
        else
            echo "No log file found"
        fi
        ;;
        
    health)
        if command -v curl >/dev/null 2>&1; then
            curl -s http://localhost:3002/health | python3 -m json.tool 2>/dev/null || echo "Bot health check failed"
        else
            echo "curl not available, install with: pkg install curl"
        fi
        ;;
        
    *)
        echo "Usage: $0 {start|stop|restart|status|logs|health}"
        echo ""
        echo "Commands:"
        echo "  start   - Start the bot in background"
        echo "  stop    - Stop the bot"
        echo "  restart - Restart the bot"
        echo "  status  - Show bot status"
        echo "  logs    - Show bot logs (live tail)"
        echo "  health  - Check bot health via HTTP"
        exit 1
        ;;
esac