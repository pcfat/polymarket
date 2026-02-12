"""WebSocket Router"""
import logging
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from ..websocket_manager import websocket_manager

logger = logging.getLogger(__name__)

router = APIRouter(tags=["websocket"])


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket endpoint for real-time updates"""
    await websocket_manager.connect(websocket)
    
    try:
        # Send initial connection success message
        await websocket_manager.send_personal(
            websocket,
            "connected",
            {"message": "Connected to Polymarket Arbitrage System"}
        )
        
        # Keep connection alive and listen for messages
        while True:
            # Receive message from client (e.g., ping/pong)
            data = await websocket.receive_text()
            
            # Handle client messages if needed
            if data == "ping":
                await websocket_manager.send_personal(
                    websocket,
                    "pong",
                    {"timestamp": ""}
                )
    
    except WebSocketDisconnect:
        websocket_manager.disconnect(websocket)
        logger.info("WebSocket client disconnected normally")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        websocket_manager.disconnect(websocket)
