# Deployment Guide

Complete guide for deploying the Crop Risk Prediction Platform to production.

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Deployment Options](#deployment-options)
- [Docker Deployment](#docker-deployment)
- [Cloud Deployment](#cloud-deployment)
- [Environment Configuration](#environment-configuration)
- [Database Setup](#database-setup)
- [External Services](#external-services)
- [Monitoring](#monitoring)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

### Hardware Requirements

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| CPU | 2 cores | 4+ cores |
| RAM | 4 GB | 8+ GB |
| Storage | 20 GB | 50+ GB (for satellite data) |
| Network | 10 Mbps | 100+ Mbps |

### Software Requirements

- Docker 20.10+ and Docker Compose 2.0+
- OR Python 3.11+, PostgreSQL 14+, Redis 7+
- SSL certificate (for HTTPS)
- Domain name (optional but recommended)

---

## Deployment Options

### Option 1: Docker Compose (Recommended)

Best for: Single server, VPS, small to medium scale

### Option 2: Kubernetes

Best for: Large scale, auto-scaling, high availability

### Option 3: Cloud Platform

Best for: Managed services, minimal DevOps

| Platform | Services Used |
|----------|---------------|
| AWS | ECS/EKS, RDS, ElastiCache, S3 |
| Google Cloud | Cloud Run, Cloud SQL, Memorystore |
| Azure | Container Apps, PostgreSQL, Redis Cache |
| DigitalOcean | App Platform, Managed Database |

---

## Docker Deployment

### Step 1: Prepare Server

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Install Docker Compose
sudo apt install docker-compose-plugin

# Add user to docker group
sudo usermod -aG docker $USER
```

### Step 2: Clone Repository

```bash
git clone https://github.com/your-org/crop-risk-backend.git
cd crop-risk-backend
```

### Step 3: Configure Environment

```bash
# Copy example env
cp .env.example .env

# Edit with production values
nano .env
```

**Critical settings for production:**

```bash
# Security
DEBUG=False
SECRET_KEY=<generate-strong-random-key>

# Database
DATABASE_URL=postgresql://user:strongpassword@db:5432/crop_risk_db

# Redis
REDIS_HOST=redis
CELERY_BROKER_URL=redis://redis:6379/0
```

Generate a secure secret key:
```bash
openssl rand -hex 32
```

### Step 4: Configure Docker Compose for Production

Create `docker-compose.prod.yml`:

```yaml
version: '3.8'

services:
  db:
    image: postgis/postgis:14-3.4-alpine
    container_name: crop-risk-db
    restart: always
    environment:
      POSTGRES_USER: ${DATABASE_USER:-postgres}
      POSTGRES_PASSWORD: ${DATABASE_PASSWORD}
      POSTGRES_DB: ${DATABASE_NAME:-crop_risk_db}
    volumes:
      - db_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    container_name: crop-risk-redis
    restart: always
    command: redis-server --appendonly yes
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
    container_name: crop-risk-backend
    restart: always
    ports:
      - "8000:8000"
    environment:
      - DATABASE_URL=postgresql://${DATABASE_USER}:${DATABASE_PASSWORD}@db:5432/${DATABASE_NAME}
      - REDIS_HOST=redis
      - CELERY_BROKER_URL=redis://redis:6379/0
      - SECRET_KEY=${SECRET_KEY}
      - DEBUG=False
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy
    volumes:
      - ./data:/app/data
      - ./logs:/app/logs
    command: uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 4

  worker:
    build:
      context: ./backend
      dockerfile: Dockerfile
    container_name: crop-risk-worker
    restart: always
    environment:
      - DATABASE_URL=postgresql://${DATABASE_USER}:${DATABASE_PASSWORD}@db:5432/${DATABASE_NAME}
      - REDIS_HOST=redis
      - CELERY_BROKER_URL=redis://redis:6379/0
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy
    volumes:
      - ./data:/app/data
      - ./logs:/app/logs
    command: celery -A app.tasks.celery_app worker --loglevel=info --concurrency=4

  beat:
    build:
      context: ./backend
      dockerfile: Dockerfile
    container_name: crop-risk-beat
    restart: always
    environment:
      - DATABASE_URL=postgresql://${DATABASE_USER}:${DATABASE_PASSWORD}@db:5432/${DATABASE_NAME}
      - REDIS_HOST=redis
      - CELERY_BROKER_URL=redis://redis:6379/0
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy
    command: celery -A app.tasks.celery_app beat --loglevel=info

volumes:
  db_data:
  redis_data:
```

### Step 5: Deploy

```bash
# Build and start
docker-compose -f docker-compose.prod.yml up -d --build

# Run migrations
docker-compose -f docker-compose.prod.yml exec backend alembic upgrade head

# Initialize disease models
docker-compose -f docker-compose.prod.yml exec backend python -m scripts.generate_disease_predictions init

# Check logs
docker-compose -f docker-compose.prod.yml logs -f
```

### Step 6: Set Up Nginx Reverse Proxy

Install nginx:
```bash
sudo apt install nginx
```

Create configuration `/etc/nginx/sites-available/crop-risk`:

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300s;
        proxy_connect_timeout 75s;
    }
}
```

Enable and start:
```bash
sudo ln -s /etc/nginx/sites-available/crop-risk /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### Step 7: Set Up SSL (Let's Encrypt)

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

---

## Cloud Deployment

### AWS (ECS + RDS)

1. **Create RDS PostgreSQL instance** with PostGIS extension
2. **Create ElastiCache Redis cluster**
3. **Create ECR repository** and push Docker image
4. **Create ECS cluster** with Fargate
5. **Create task definitions** for backend, worker, beat
6. **Set up Application Load Balancer**
7. **Configure environment variables** in task definitions

### Google Cloud (Cloud Run)

```bash
# Build and push image
gcloud builds submit --tag gcr.io/PROJECT_ID/crop-risk-backend

# Deploy
gcloud run deploy crop-risk-backend \
  --image gcr.io/PROJECT_ID/crop-risk-backend \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars "DATABASE_URL=postgresql://..." \
  --memory 2Gi \
  --cpu 2
```

### DigitalOcean App Platform

1. Connect GitHub repository
2. Configure build settings
3. Add managed PostgreSQL database
4. Add managed Redis
5. Set environment variables
6. Deploy

---

## Environment Configuration

### Production Environment Variables

```bash
# =============================================================================
# REQUIRED SETTINGS
# =============================================================================

# Database (PostgreSQL with PostGIS)
DATABASE_URL=postgresql://user:password@host:5432/crop_risk_db

# Redis
REDIS_HOST=redis-host
REDIS_PORT=6379
CELERY_BROKER_URL=redis://redis-host:6379/0
CELERY_RESULT_BACKEND=redis://redis-host:6379/0

# Security (CRITICAL - generate strong values!)
SECRET_KEY=<64-character-random-string>
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=30

# Application
DEBUG=False
PROJECT_NAME=Crop Risk Prediction Platform
API_V1_STR=/api/v1

# =============================================================================
# SATELLITE DATA (Choose one)
# =============================================================================

# Option A: Google Earth Engine (Recommended)
GEE_SERVICE_ACCOUNT_EMAIL=your-account@project.iam.gserviceaccount.com
GEE_PRIVATE_KEY_PATH=/app/data/earthengine/private-key.json

# Option B: Microsoft Planetary Computer
USE_PLANETARY_COMPUTER=true

# =============================================================================
# WEATHER APIS (Optional - system has fallbacks)
# =============================================================================

# ERA5 (Copernicus Climate Data Store)
ERA5_API_KEY=your-cds-api-key

# NOAA Climate Data Online
NOAA_API_KEY=your-noaa-token

# IBM Environmental Intelligence Suite (Commercial)
IBM_EIS_API_KEY=your-ibm-key

# =============================================================================
# NOTIFICATIONS (Optional)
# =============================================================================

# Email
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=alerts@yourdomain.com
SMTP_PASSWORD=your-app-password

# SMS (Africa's Talking)
SMS_PROVIDER=africas_talking
SMS_API_KEY=your-at-api-key
SMS_USERNAME=your-at-username

# =============================================================================
# STORAGE (Optional)
# =============================================================================

# AWS S3 for satellite data storage
AWS_ACCESS_KEY_ID=your-aws-key
AWS_SECRET_ACCESS_KEY=your-aws-secret
S3_BUCKET_NAME=crop-risk-data
```

---

## Database Setup

### Initialize Database

```bash
# Connect to PostgreSQL
psql -U postgres -h localhost

# Create database
CREATE DATABASE crop_risk_db;

# Connect to database
\c crop_risk_db

# Enable PostGIS
CREATE EXTENSION postgis;

# Exit
\q
```

### Run Migrations

```bash
# With Docker
docker-compose exec backend alembic upgrade head

# Without Docker
cd backend
alembic upgrade head
```

### Initialize Data

```bash
# Initialize disease models
python -m scripts.generate_disease_predictions init

# Fetch initial weather data (optional)
python -m scripts.fetch_enhanced_weather all --days 7
```

### Backup Strategy

```bash
# Daily backup script
#!/bin/bash
DATE=$(date +%Y%m%d)
pg_dump -U postgres -h localhost crop_risk_db | gzip > /backups/crop_risk_$DATE.sql.gz

# Keep last 30 days
find /backups -name "*.sql.gz" -mtime +30 -delete
```

Add to crontab:
```bash
0 2 * * * /path/to/backup.sh
```

---

## External Services

### Google Earth Engine Setup

1. Create Google Cloud project
2. Enable Earth Engine API
3. Create service account
4. Download JSON key file
5. Register for Earth Engine (commercial or research)

```bash
# Test GEE connection
python -c "import ee; ee.Initialize(); print('GEE connected!')"
```

### Weather API Setup

**Open-Meteo (Free, no setup required)**
- Works out of the box
- Best for most use cases

**ERA5 (Free, requires registration)**
1. Register at https://cds.climate.copernicus.eu/
2. Accept terms of service
3. Copy API key from profile page

**NOAA (Free, requires token)**
1. Request token at https://www.ncdc.noaa.gov/cdo-web/token
2. Token sent to email immediately

---

## Monitoring

### Health Check Endpoint

```bash
curl https://your-domain.com/health
```

Expected response:
```json
{
  "status": "healthy",
  "database": "connected",
  "redis": "connected",
  "version": "2.1.0"
}
```

### Log Aggregation

```bash
# View all logs
docker-compose logs -f

# View specific service
docker-compose logs -f backend

# Tail last 100 lines
docker-compose logs --tail=100 backend
```

### Metrics (Prometheus)

Add to backend for metrics export:
```python
from prometheus_client import Counter, Histogram, generate_latest

# Metrics available at /metrics endpoint
```

### Recommended Monitoring Stack

- **Prometheus** - Metrics collection
- **Grafana** - Dashboards and visualization
- **Loki** - Log aggregation
- **AlertManager** - Alert routing

---

## Troubleshooting

### Common Issues

**Database connection failed:**
```bash
# Check PostgreSQL is running
docker-compose ps db

# Check connection
docker-compose exec backend python -c "from app.db.database import engine; engine.connect(); print('OK')"
```

**Celery tasks not running:**
```bash
# Check worker status
docker-compose logs worker

# Check Redis connection
docker-compose exec redis redis-cli ping
```

**Satellite data not fetching:**
```bash
# Check GEE credentials
docker-compose exec backend python -c "import ee; ee.Initialize()"

# Check task is scheduled
docker-compose exec beat celery -A app.tasks.celery_app inspect scheduled
```

**Out of memory:**
```bash
# Increase Docker memory limit
# In docker-compose.yml:
deploy:
  resources:
    limits:
      memory: 4G
```

### Performance Tuning

**Increase API workers:**
```bash
# In docker-compose.prod.yml
command: uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 8
```

**Increase Celery concurrency:**
```bash
command: celery -A app.tasks.celery_app worker --loglevel=info --concurrency=8
```

**Database connection pooling:**
```python
# In config.py
SQLALCHEMY_POOL_SIZE = 20
SQLALCHEMY_MAX_OVERFLOW = 40
```

---

## Security Checklist

- [ ] Set `DEBUG=False`
- [ ] Use strong `SECRET_KEY` (64+ characters)
- [ ] Enable HTTPS (SSL certificate)
- [ ] Set up firewall (allow only 80, 443)
- [ ] Use non-root database user
- [ ] Enable database SSL
- [ ] Rotate credentials regularly
- [ ] Set up automated backups
- [ ] Enable rate limiting at reverse proxy
- [ ] Configure CORS for specific domains

---

## Scaling

### Horizontal Scaling

```bash
# Scale workers
docker-compose up -d --scale worker=4

# Scale API (behind load balancer)
docker-compose up -d --scale backend=3
```

### Vertical Scaling

Increase resources per container in docker-compose.yml:
```yaml
deploy:
  resources:
    limits:
      cpus: '2'
      memory: 4G
```

---

**Version**: 2.1.0
**Last Updated**: February 2026
