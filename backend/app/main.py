"""FastAPI Main Application"""
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import os
from pathlib import Path

from .config import settings
from .database import init_db
from .scheduler import scheduler
from .models import HealthResponse
from .routers import dashboard, markets, trades, settings as settings_router, ws

# Configure logging
logging.basicConfig(
    level=getattr(logging, settings.system.log_level),
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan context manager for startup and shutdown events"""
    # Startup
    logger.info("Starting Polymarket Arbitrage System...")
    
    # Initialize database
    await init_db()
    logger.info("Database initialized")
    
    # Start scheduler
    await scheduler.start()
    logger.info("Scheduler started")
    
    yield
    
    # Shutdown
    logger.info("Shutting down Polymarket Arbitrage System...")
    await scheduler.stop()
    logger.info("Scheduler stopped")


# Create FastAPI app
app = FastAPI(
    title="Polymarket Arbitrage System",
    description="Automated arbitrage trading system for Polymarket",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify exact origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(dashboard.router)
app.include_router(markets.router)
app.include_router(trades.router)
app.include_router(settings_router.router)
app.include_router(ws.router)


# Health check endpoint
@app.get("/api/health")
async def health_check() -> HealthResponse:
    """Health check endpoint"""
    return HealthResponse(
        status="healthy",
        version="1.0.0",
        mode=settings.system.mode,
        scheduler_running=scheduler.running,
    )


# Serve frontend static files
FRONTEND_DIST = os.path.join(Path(__file__).parent.parent.parent, "frontend", "dist")

if os.path.exists(FRONTEND_DIST):
    # Mount static files
    app.mount("/assets", StaticFiles(directory=os.path.join(FRONTEND_DIST, "assets")), name="assets")
    
    # Serve index.html for all non-API routes
    @app.get("/{full_path:path}")
    async def serve_frontend(full_path: str):
        """Serve frontend application"""
        # If path looks like a file, try to serve it
        if "." in full_path.split("/")[-1]:
            file_path = os.path.join(FRONTEND_DIST, full_path)
            if os.path.exists(file_path):
                return FileResponse(file_path)
        
        # Otherwise serve index.html (SPA routing)
        index_path = os.path.join(FRONTEND_DIST, "index.html")
        if os.path.exists(index_path):
            return FileResponse(index_path)
        
        return {"error": "Frontend not found"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
