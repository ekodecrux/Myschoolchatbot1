# MySchool Chatbot Deployment Guide

## Recent Fixes Applied
1. ✅ **UI Fix**: Added Tailwind CSS v4 Vite plugin to restore all UI styling
2. ✅ **Translation Fix**: Implemented automatic translation for Telugu, Hindi, Gujarati queries

## Server Details
- **IP**: 88.222.244.84
- **Domains**: 
  - myschoolchatbot.in
  - demo.myschoolchatbot.in
- **SSH**: `ssh root@88.222.244.84`

## Deployment Methods

### Method 1: Quick Git Pull (Recommended)

```bash
# SSH into server
ssh root@88.222.244.84

# Navigate to application directory (adjust path as needed)
cd /var/www/myschool-chatbot4  # or wherever the app is installed

# Pull latest changes
git pull origin main

# Install dependencies (if package.json changed)
npm install

# Rebuild application
npm run build

# Restart PM2 services
pm2 restart all

# Check status
pm2 list
pm2 logs --nostream
```

### Method 2: Manual File Deployment

If you need to deploy specific files:

```bash
# On your local machine, copy files to server
scp -r server/ root@88.222.244.84:/var/www/myschool-chatbot4/
scp vite.config.ts root@88.222.244.84:/var/www/myschool-chatbot4/

# SSH into server
ssh root@88.222.244.84

# Rebuild and restart
cd /var/www/myschool-chatbot4
npm run build
pm2 restart all
```

### Method 3: Complete Redeployment

If you need a fresh deployment:

```bash
# SSH into server
ssh root@88.222.244.84

# Backup current version
cd /var/www
mv myschool-chatbot4 myschool-chatbot4.backup-$(date +%Y%m%d)

# Clone fresh copy
git clone https://github.com/ekodecrux/myschool-chatbot4.git
cd myschool-chatbot4

# Install dependencies
npm install

# Configure environment variables
nano .env
# Add:
# GROQ_API_KEY=your_key_here
# NODE_ENV=production
# (copy from backup if needed)

# Build application
npm run build

# Start with PM2
pm2 delete all  # Stop old processes
pm2 start npm --name "myschool-chatbot-prod" -- start
pm2 start npm --name "myschool-chatbot-demo" -- start  # if separate instance

# Save PM2 configuration
pm2 save
pm2 startup
```

## Key Files Changed

1. **vite.config.ts** - Added Tailwind CSS v4 plugin
2. **server/routers.ts** - Integrated translation functionality
3. **server/translation_util.ts** - Enhanced translation with Indian languages

## Verification Steps

After deployment, verify both domains:

```bash
# Test myschoolchatbot.in
curl https://myschoolchatbot.in
curl https://myschoolchatbot.in/api/trpc/chatbot.chat

# Test demo.myschoolchatbot.in
curl https://demo.myschoolchatbot.in
curl https://demo.myschoolchatbot.in/api/trpc/chatbot.chat

# Check PM2 logs
pm2 logs --nostream
```

## Testing Translation Feature

1. Open chatbot on either domain
2. Type in Telugu: "జంతువుల చిత్రాలు"
   - Expected: Translates to "animal images" and shows results
3. Type in Hindi: "कक्षा 5 गणित"
   - Expected: Translates to "class 5 maths" and shows Class 5 Maths
4. Type in Gujarati: "વિજ્ઞાન પરીક્ષા"
   - Expected: Translates to "science exam" and shows science exam resources

## Nginx Configuration

Ensure both domains point to the application:

```nginx
# /etc/nginx/sites-available/myschoolchatbot.in
server {
    listen 80;
    server_name myschoolchatbot.in www.myschoolchatbot.in;
    
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}

# /etc/nginx/sites-available/demo.myschoolchatbot.in
server {
    listen 80;
    server_name demo.myschoolchatbot.in;
    
    location / {
        proxy_pass http://localhost:3001;  # Different port if separate instance
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Reload Nginx:
```bash
nginx -t
systemctl reload nginx
```

## Environment Variables Required

Ensure `.env` file contains:

```env
GROQ_API_KEY=your_groq_api_key_here
NODE_ENV=production
PORT=3000
DATABASE_URL=your_database_url
```

## Troubleshooting

### Issue: UI not showing styles
**Solution**: Ensure `vite.config.ts` has `@tailwindcss/vite` plugin

### Issue: Translation not working
**Check**:
1. GROQ_API_KEY is set in `.env`
2. Server logs show translation attempts: `pm2 logs`
3. Look for "[Translation]" log entries

### Issue: Application not starting
**Check**:
```bash
pm2 logs --err
npm run build  # Rebuild if needed
```

### Issue: Both domains showing same content
**Check**:
- Nginx configuration for each domain
- Port numbers in PM2 config
- DNS settings

## Rollback Procedure

If deployment fails:

```bash
# Stop current version
pm2 delete all

# Restore backup
cd /var/www
rm -rf myschool-chatbot4
mv myschool-chatbot4.backup-YYYYMMDD myschool-chatbot4

# Restart old version
cd myschool-chatbot4
pm2 start npm --name "myschool-chatbot" -- start
```

## Support

For issues, check:
1. PM2 logs: `pm2 logs`
2. Nginx logs: `tail -f /var/log/nginx/error.log`
3. Application logs in the app directory

## Post-Deployment Checklist

- [ ] Git pull successful
- [ ] Dependencies installed
- [ ] Build completed without errors
- [ ] PM2 processes running
- [ ] myschoolchatbot.in accessible
- [ ] demo.myschoolchatbot.in accessible
- [ ] UI styles displaying correctly
- [ ] Translation feature working (test with Telugu/Hindi/Gujarati)
- [ ] Search functionality working
- [ ] No errors in PM2 logs
