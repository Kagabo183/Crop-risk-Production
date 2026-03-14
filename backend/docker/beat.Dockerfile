FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    g++ \
    build-essential \
    libpq-dev \
    libgdal-dev \
    gdal-bin \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first for better caching
COPY requirements.txt /app/requirements.txt

# Install Python dependencies
RUN pip install --no-cache-dir -r /app/requirements.txt

# Install Google Earth Engine API
RUN pip install --no-cache-dir earthengine-api

# Install additional dependencies
RUN pip install --no-cache-dir \
    pystac-client \
    planetary-computer \
    rasterio \
    numpy \
    scipy

# Copy application code
COPY . /app

# Create necessary directories
RUN mkdir -p /app/data /app/logs /app/ml /root/.config/earthengine

# Start Celery Beat scheduler with database scheduler
CMD ["celery", "-A", "app.tasks.celery_app", "beat", "--loglevel=info", "--scheduler", "django_celery_beat.schedulers:DatabaseScheduler"]
