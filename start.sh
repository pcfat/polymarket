#!/bin/bash
# Quick Start Script for Polymarket Arbitrage System

set -e

echo "🚀 Polymarket Arbitrage System - Quick Start"
echo "==========================================="
echo ""

# Check if .env exists
if [ ! -f .env ]; then
    echo "⚠️  No .env file found. Creating from template..."
    cp .env.example .env
    echo "✅ .env file created. Please edit it with your API credentials."
    echo ""
fi

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker first."
    echo "   Visit: https://docs.docker.com/get-docker/"
    exit 1
fi

if ! command -v docker-compose &> /dev/null; then
    echo "❌ Docker Compose is not installed. Please install Docker Compose first."
    echo "   Visit: https://docs.docker.com/compose/install/"
    exit 1
fi

echo "✅ Docker and Docker Compose are installed"
echo ""

# Ask user if they want to proceed
read -p "Do you want to start the system now? (y/n) " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Aborted. You can start the system later with:"
    echo "  docker-compose up -d"
    exit 0
fi

echo ""
echo "📦 Building and starting services..."
docker-compose up -d

echo ""
echo "⏳ Waiting for services to be ready..."
sleep 10

# Check if backend is running
if curl -s http://localhost:8000/api/health > /dev/null 2>&1; then
    echo "✅ Backend is running"
else
    echo "⚠️  Backend might not be ready yet. Please wait a moment."
fi

echo ""
echo "🎉 System started successfully!"
echo ""
echo "Access points:"
echo "  🌐 Web Dashboard: http://localhost"
echo "  📡 Backend API:   http://localhost:8000"
echo "  📚 API Docs:      http://localhost:8000/docs"
echo ""
echo "Useful commands:"
echo "  View logs:        docker-compose logs -f"
echo "  Stop system:      docker-compose stop"
echo "  Restart:          docker-compose restart"
echo "  Remove all:       docker-compose down"
echo ""
echo "⚠️  Remember: The system starts in PAPER mode (simulated trading)"
echo "   To switch to LIVE mode, go to Settings in the web dashboard"
echo ""
