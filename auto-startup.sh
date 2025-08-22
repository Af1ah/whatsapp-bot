#!/bin/bash

# Auto-startup script for WhatsApp Bot
# Place this in ~/.bashrc to auto-start bot when Termux opens

BOT_MANAGER="$HOME/whatsapp-bot/bot-manager.sh"

# Function to check if bot should auto-start
check_and_start_bot() {
    if [ -f "$BOT_MANAGER" ]; then
        # Check if bot is already running
        if ! bash "$BOT_MANAGER" status | grep -q "Bot is running"; then
            echo "🤖 Auto-starting WhatsApp bot..."
            bash "$BOT_MANAGER" start
            
            # Show startup info
            echo ""
            echo "📱 WhatsApp Bot Status:"
            echo "========================"
            bash "$BOT_MANAGER" status
            echo ""
            echo "💡 Available commands:"
            echo "   bot status  - Check bot status"
            echo "   bot logs    - View live logs"
            echo "   bot stop    - Stop the bot"
            echo "   bot restart - Restart the bot"
            echo "   bot health  - Check API health"
            echo ""
        else
            echo "🤖 WhatsApp bot is already running"
        fi
    fi
}

# Create alias for easy bot management
alias bot="bash $BOT_MANAGER"

# Auto-start bot (uncomment the next line after setup)
# check_and_start_bot

# Display welcome message
echo "🚀 Termux WhatsApp Bot Environment Ready"
echo "Type 'bot status' to check bot status"