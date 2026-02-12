# Installation Guide

## Prerequisites

- Docker 20.10+ and Docker Compose 2.0+
- OR Python 3.11+ and Node.js 18+ (for local development)
- At least 2GB RAM available
- 5GB free disk space

## Quick Installation (Docker)

### 1. Clone the Repository

```bash
git clone https://github.com/pcfat/polymarket.git
cd polymarket
```

### 2. Configure Environment

```bash
# Copy environment template
cp .env.example .env

# Edit .env file with your credentials (optional for paper trading)
nano .env
```

### 3. Start the System

```bash
# Option A: Use the quick start script
./start.sh

# Option B: Manual start
docker-compose up -d
```

### 4. Access the Dashboard

- Web Interface: http://localhost
- API Documentation: http://localhost:8000/docs
- Backend API: http://localhost:8000/api

## Configuration

The system starts in **Paper Trading** mode by default with $10,000 virtual balance.

See [README.md](README.md) for detailed configuration options.

## Verification

```bash
curl http://localhost:8000/api/health
```

## Troubleshooting

See full troubleshooting guide in [README.md](README.md#常見問題)
