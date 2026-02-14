#!/bin/bash

# MySchool Chatbot Deployment Script
# Run this on the server: bash deploy.sh

set -e  # Exit on error

echo "=========================================="
echo "MySchool Chatbot Deployment"
echo "=========================================="
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Get current directory
APP_DIR=$(pwd)
echo "📁 Application directory: $APP_DIR"
echo ""

# Step 1: Backup current state
echo "📦 Creating backup..."
BACKUP_DIR="${APP_DIR}.backup-$(date +%Y%m%d-%H%M%S)"
if [ -d "$APP_DIR" ]; then
    cp -r "$APP_DIR" "$BACKUP_DIR"
    echo -e "${GREEN}✓ Backup created: $BACKUP_DIR${NC}"
else
    echo -e "${YELLOW}⚠ No existing directory to backup${NC}"
fi
echo ""

# Step 2: Pull latest changes
echo "🔄 Pulling latest changes from GitHub..."
if git pull origin main; then
    echo -e "${GREEN}✓ Git pull successful${NC}"
else
    echo -e "${RED}✗ Git pull failed${NC}"
    exit 1
fi
echo ""

# Step 3: Install dependencies
echo "📦 Installing dependencies..."
if npm install; then
    echo -e "${GREEN}✓ Dependencies installed${NC}"
else
    echo -e "${RED}✗ npm install failed${NC}"
    exit 1
fi
echo ""

# Step 4: Build application
echo "🔨 Building application..."
if npm run build; then
    echo -e "${GREEN}✓ Build successful${NC}"
else
    echo -e "${RED}✗ Build failed${NC}"
    exit 1
fi
echo ""

# Step 5: Restart PM2
echo "🔄 Restarting PM2 processes..."
if pm2 restart all; then
    echo -e "${GREEN}✓ PM2 restarted${NC}"
else
    echo -e "${YELLOW}⚠ PM2 restart had issues, trying to start fresh...${NC}"
    pm2 delete all 2>/dev/null || true
    pm2 start npm --name "myschool-chatbot" -- start
fi
echo ""

# Step 6: Save PM2 configuration
echo "💾 Saving PM2 configuration..."
pm2 save
echo -e "${GREEN}✓ PM2 configuration saved${NC}"
echo ""

# Step 7: Show status
echo "📊 Current PM2 Status:"
pm2 list
echo ""

# Step 8: Show recent logs
echo "📝 Recent logs (last 20 lines):"
pm2 logs --nostream --lines 20
echo ""

# Step 9: Test endpoints
echo "🧪 Testing endpoints..."
echo ""

echo "Testing myschoolchatbot.in..."
if curl -s -o /dev/null -w "%{http_code}" http://localhost:3000 | grep -q "200"; then
    echo -e "${GREEN}✓ Main application responding${NC}"
else
    echo -e "${RED}✗ Main application not responding${NC}"
fi
echo ""

# Summary
echo "=========================================="
echo "Deployment Summary"
echo "=========================================="
echo -e "${GREEN}✓ Deployment completed successfully!${NC}"
echo ""
echo "Backup location: $BACKUP_DIR"
echo ""
echo "Next steps:"
echo "1. Visit https://myschoolchatbot.in to verify"
echo "2. Visit https://demo.myschoolchatbot.in to verify"
echo "3. Test translation with Telugu/Hindi/Gujarati text"
echo "4. Check logs: pm2 logs"
echo ""
echo "To rollback if needed:"
echo "  pm2 delete all"
echo "  rm -rf $APP_DIR"
echo "  mv $BACKUP_DIR $APP_DIR"
echo "  cd $APP_DIR && npm run build && pm2 start npm --name myschool-chatbot -- start"
echo ""
echo "=========================================="
