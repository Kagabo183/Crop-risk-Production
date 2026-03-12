# Docker Deployment Guide - Crop Risk Platform

## 🐳 Quick Start

### Prerequisites
- Docker Desktop installed
- Docker Compose installed
- At least 4GB RAM available
- 10GB disk space

### 1. Clone and Setup
```bash
cd c:\Users\Riziki\crop-risk-backend
cp .env.example .env
```

### 2. Configure Environment
Edit `.env` file:
```bash
# Required: Database (already configured)
DATABASE_URL=postgresql://postgres:1234@db:5432/crop_risk_db

# Optional: Google Earth Engine (for satellite stress monitoring)
GEE_SERVICE_ACCOUNT_EMAIL=your-account@project.iam.gserviceaccount.com
GEE_PRIVATE_KEY_PATH=/app/data/earthengine/private-key.json

# Or use Microsoft Planetary Computer
USE_PLANETARY_COMPUTER=true
```

### 3. Start All Services
```bash
docker-compose up -d
```

### 4. Seed Initial Data (Learning Mode)
To populate the database with sample farms and users for learning:
```bash
docker-compose run --rm seed
```

### 5. Check Status
```bash
docker-compose ps
```

Expected output:
```
NAME                   STATUS              PORTS
crop-risk-backend      Up (healthy)        0.0.0.0:8000->8000/tcp
crop-risk-beat         Up                  
crop-risk-db           Up (healthy)        0.0.0.0:5434->5432/tcp
crop-risk-web-app      Up                  0.0.0.0:5174->5174/tcp
crop-risk-mobile-app   Up                  0.0.0.0:5175->5175/tcp
crop-risk-redis        Up (healthy)        0.0.0.0:6379->6379/tcp
crop-risk-worker       Up                  
```

### 6. Access Application
- **Web Dashboard:** http://localhost:5174
- **Mobile Preview:** http://localhost:5175
- **Backend API:** http://localhost:8000
- **API Docs:** http://localhost:8000/docs
- **Database:** localhost:5434 (user: postgres, password: 1234)

---

## 📦 Container Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Docker Network                        │
│                  (crop-risk-network)                     │
│                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │   Frontend   │  │   Backend    │  │   Database   │  │
│  │   (React)    │  │  (FastAPI)   │  │  (PostGIS)   │  │
│  │   Port 3000  │  │   Port 8000  │  │   Port 5432  │  │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  │
│         │                 │                 │           │
│         └─────────────────┼─────────────────┘           │
│                           │                             │
│  ┌──────────────┐  ┌──────┴───────┐  ┌──────────────┐  │
│  │    Redis     │  │    Worker    │  │     Beat     │  │
│  │   (Cache)    │  │   (Celery)   │  │  (Scheduler) │  │
│  │   Port 6379  │  │              │  │              │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
└─────────────────────────────────────────────────────────┘
```

---

## 🔧 Container Details

### 1. **crop-risk-db** (PostgreSQL + PostGIS)
- **Image:** `postgis/postgis:14-3.4`
- **Port:** 5434 → 5432
- **Volume:** `db_data` (persistent database storage)
- **Health Check:** `pg_isready -U postgres`
- **Purpose:** Main database with spatial extensions

### 2. **crop-risk-backend** (FastAPI)
- **Build:** `./backend/Dockerfile`
- **Port:** 8000
- **Volumes:**
  - `./backend` → `/app` (code)
  - `./data` → `/app/data` (satellite data, models)
  - `./logs` → `/app/logs` (application logs)
  - `./ml` → `/app/ml` (ML models)
  - `./data/earthengine` → `/root/.config/earthengine` (GEE credentials)
- **Health Check:** `curl http://localhost:8000/api/v1/health`
- **Purpose:** REST API server

### 3. **crop-risk-web-app** (React Dashboard)
- **Build:** `./web-app/Dockerfile`
- **Port:** 5174
- **Volume:** `./web-app` → `/app` (code, hot reload)
- **Health Check:** `wget http://localhost:5174`
- **Purpose:** Web Analytics Dashboard

### 4. **crop-risk-mobile-app** (React Mobile)
- **Build:** `./mobile-app/Dockerfile`
- **Port:** 5175
- **Volume:** `./mobile-app` → `/app` (code, hot reload)
- **Health Check:** `wget http://localhost:5175`
- **Purpose:** Mobile Interface Preview

### 5. **crop-risk-redis** (Redis)
- **Image:** `redis:7-alpine`
- **Port:** 6379
- **Health Check:** `redis-cli ping`
- **Purpose:** Message broker for Celery, caching

### 5. **crop-risk-worker** (Celery Worker)
- **Build:** `./backend/Dockerfile`
- **Command:** `celery worker --concurrency=6`
- **Volumes:** Same as backend
- **Purpose:** Background task processing (satellite downloads, NDVI calculation, stress detection)

### 6. **crop-risk-beat** (Celery Beat)
- **Build:** `./backend/Dockerfile`
- **Command:** `celery beat`
- **Volumes:** Same as backend
- **Purpose:** Task scheduler (automated satellite updates, daily reports)

---

## 🚀 Common Commands

### Start Services
```bash
# Start all services
docker-compose up -d

# Start specific service
docker-compose up -d backend

# Start with logs
docker-compose up
```

### Stop Services
```bash
# Stop all services
docker-compose down

# Stop and remove volumes (⚠️ deletes database!)
docker-compose down -v
```

### View Logs
```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f backend
docker-compose logs -f worker
docker-compose logs -f frontend

# Last 100 lines
docker-compose logs --tail=100 backend
```

### Restart Services
```bash
# Restart all
docker-compose restart

# Restart specific service
docker-compose restart backend
docker-compose restart worker
```

### Rebuild Containers
```bash
# Rebuild all
docker-compose build

# Rebuild specific service
docker-compose build backend

# Rebuild and restart
docker-compose up -d --build
```

### Execute Commands in Container
```bash
# Backend shell
docker-compose exec web bash

# Run migrations
docker-compose exec web alembic upgrade head

# Python shell
docker-compose exec web python

# Database shell
docker-compose exec db psql -U postgres -d crop_risk_db

# Redis CLI
docker-compose exec redis redis-cli
```

---

## 🔐 Google Earth Engine Setup (for Satellite Stress Monitoring)

### Option 1: Service Account (Recommended)

1. **Create GEE Service Account:**
   - Go to https://console.cloud.google.com/
   - Create a new project or select existing
   - Enable Earth Engine API
   - Create service account
   - Download private key JSON

2. **Place Credentials:**
   ```bash
   mkdir -p data/earthengine
   # Copy your private-key.json to data/earthengine/
   ```

3. **Update .env:**
   ```bash
   GEE_SERVICE_ACCOUNT_EMAIL=your-account@project.iam.gserviceaccount.com
   GEE_PRIVATE_KEY_PATH=/app/data/earthengine/private-key.json
   ```

4. **Restart Services:**
   ```bash
   docker-compose restart web worker
   ```

### Option 2: Microsoft Planetary Computer (No Setup Required)

1. **Update .env:**
   ```bash
   USE_PLANETARY_COMPUTER=true
   ```

2. **Restart:**
   ```bash
   docker-compose restart web worker
   ```

---

## 🗄️ Database Management

### Backup Database
```bash
docker-compose exec db pg_dump -U postgres crop_risk_db > backup.sql
```

### Restore Database
```bash
cat backup.sql | docker-compose exec -T db psql -U postgres crop_risk_db
```

### Reset Database
```bash
docker-compose down -v
docker-compose up -d db
docker-compose exec web alembic upgrade head
```

### Access Database
```bash
docker-compose exec db psql -U postgres crop_risk_db
```

---

## 📊 Monitoring

### Health Checks
```bash
# Backend health
curl http://localhost:8000/api/v1/health

# Frontend health
curl http://localhost:5174

# Database health
docker-compose exec db pg_isready -U postgres

# Redis health
docker-compose exec redis redis-cli ping
```

### Resource Usage
```bash
# All containers
docker stats

# Specific container
docker stats crop-risk-backend
```

### Container Status
```bash
docker-compose ps
```

---

## 🐛 Troubleshooting

### Backend won't start
```bash
# Check logs
docker-compose logs backend

# Common issues:
# 1. Database not ready → Wait for health check
# 2. Port 8000 in use → Change port in docker-compose.yml
# 3. Missing dependencies → Rebuild: docker-compose build backend
```

### Worker not processing tasks
```bash
# Check worker logs
docker-compose logs worker

# Restart worker
docker-compose restart worker

# Check Redis connection
docker-compose exec worker python -c "import redis; r=redis.Redis(host='redis'); print(r.ping())"
```

### Frontend can't connect to backend
```bash
# Check REACT_APP_API_URL in docker-compose.yml
# Should be: http://localhost:8000

# Restart frontend
docker-compose restart frontend
```

### Database connection errors
```bash
# Check database is running
docker-compose ps db

# Check connection
docker-compose exec web python -c "from app.db.database import engine; print(engine.connect())"
```

### Satellite downloads failing
```bash
# Check GEE credentials
docker-compose exec web ls -la /root/.config/earthengine/

# Test GEE connection
docker-compose exec web python -c "import ee; ee.Initialize(); print('GEE OK')"

# Check worker logs
docker-compose logs worker | grep -i satellite
```

---

## 🔄 Development Workflow

### 1. Code Changes (Hot Reload)
- **Backend:** Changes auto-reload (uvicorn --reload)
- **Frontend:** Changes auto-reload (npm start)
- **No restart needed!**

### 2. Dependency Changes
```bash
# Backend (requirements.txt changed)
docker-compose build backend
docker-compose up -d backend worker beat

# Frontend (package.json changed)
docker-compose build frontend
docker-compose up -d frontend
```

### 3. Database Schema Changes
```bash
# Create migration
docker-compose exec web alembic revision --autogenerate -m "description"

# Apply migration
docker-compose exec web alembic upgrade head
```

### 4. Environment Variable Changes
```bash
# Edit .env file
# Then restart affected services
docker-compose restart web worker beat
```

---

## 📦 Production Deployment

### Build Production Images
```bash
# Build optimized images
docker-compose -f docker-compose.prod.yml build

# Push to registry
docker tag crop-risk-backend:latest your-registry/crop-risk-backend:latest
docker push your-registry/crop-risk-backend:latest
```

### Environment Variables for Production
```bash
DEBUG=False
SECRET_KEY=<generate-strong-key>
DATABASE_URL=postgresql://user:pass@prod-db:5432/crop_risk_db
ALLOWED_HOSTS=your-domain.com
```

---

## 🎯 Quick Reference

| Service | Port | URL | Purpose |
|---------|------|-----|---------|
| Frontend | 5174 | http://localhost:5174 | Web UI |
| Backend | 8000 | http://localhost:8000 | REST API |
| API Docs | 8000 | http://localhost:8000/docs | Swagger UI |
| Database | 5434 | localhost:5434 | PostgreSQL |
| Redis | 6379 | localhost:6379 | Cache/Queue |

### Essential Commands
```bash
# Start
docker-compose up -d

# Stop
docker-compose down

# Logs
docker-compose logs -f

# Rebuild
docker-compose up -d --build

# Shell
docker-compose exec web bash
```

---

## ✅ Verification Checklist

After starting containers, verify:

- [ ] All 6 containers running: `docker-compose ps`
- [ ] Backend healthy: `curl http://localhost:8000/api/v1/health`
- [ ] Frontend accessible: `curl http://localhost:5174`
- [ ] Database connected: `docker-compose exec web python -c "from app.db.database import engine; engine.connect()"`
- [ ] Redis working: `docker-compose exec redis redis-cli ping`
- [ ] Worker processing: `docker-compose logs worker | grep "ready"`
- [ ] Beat scheduling: `docker-compose logs beat | grep "beat"`

---

## 🎉 Success!

Your Crop Risk Platform is now running in Docker! 🚀

**Next Steps:**
1. Access frontend: http://localhost:5174
2. Login with default credentials
3. Navigate to "Stress Monitoring"
4. Select a farm and click "Update Satellite Data"
5. Watch the magic happen! ✨
