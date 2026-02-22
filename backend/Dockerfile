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

# Install Google Earth Engine API (for satellite stress monitoring)
RUN pip install --no-cache-dir earthengine-api

# Install additional dependencies for stress monitoring
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

# Expose port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:8000/api/v1/health || exit 1

# Copy startup script
COPY start.sh /app/start.sh
RUN chmod +x /app/start.sh

# Default command — runs migrations then starts server
CMD ["/app/start.sh"]
