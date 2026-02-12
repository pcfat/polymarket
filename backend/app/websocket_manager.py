"""WebSocket Manager for Real-time Updates"""
import json
import logging
from typing import Set, Dict, Any
from datetime import datetime
from fastapi import WebSocket

logger = logging.getLogger(__name__)


class WebSocketManager:
    """Manage WebSocket connections and broadcast updates"""
    
    def __init__(self):
        self.active_connections: Set[WebSocket] = set()
    
    async def connect(self, websocket: WebSocket):
        """Accept new WebSocket connection"""
        await websocket.accept()
        self.active_connections.add(websocket)
        logger.info(f"WebSocket connected. Total connections: {len(self.active_connections)}")
    
    def disconnect(self, websocket: WebSocket):
        """Remove WebSocket connection"""
        self.active_connections.discard(websocket)
        logger.info(f"WebSocket disconnected. Total connections: {len(self.active_connections)}")
    
    async def broadcast(self, message_type: str, data: Dict[str, Any]):
        """Broadcast message to all connected clients"""
        if not self.active_connections:
            return
        
        message = {
            "type": message_type,
            "data": data,
            "timestamp": datetime.now().isoformat(),
        }
        
        message_json = json.dumps(message, default=str)
        
        # Send to all connections, remove dead ones
        dead_connections = set()
        
        for connection in self.active_connections:
            try:
                await connection.send_text(message_json)
            except Exception as e:
                logger.warning(f"Failed to send to WebSocket: {e}")
                dead_connections.add(connection)
        
        # Clean up dead connections
        for connection in dead_connections:
            self.disconnect(connection)
    
    async def send_personal(self, websocket: WebSocket, message_type: str, data: Dict[str, Any]):
        """Send message to specific client"""
        message = {
            "type": message_type,
            "data": data,
            "timestamp": datetime.now().isoformat(),
        }
        
        try:
            await websocket.send_text(json.dumps(message, default=str))
        except Exception as e:
            logger.error(f"Failed to send personal message: {e}")
            self.disconnect(websocket)
    
    async def broadcast_dashboard_update(self, dashboard_data: Dict[str, Any]):
        """Broadcast dashboard update"""
        await self.broadcast("dashboard", dashboard_data)
    
    async def broadcast_opportunities(self, opportunities: list):
        """Broadcast new arbitrage opportunities"""
        await self.broadcast("opportunities", {"opportunities": opportunities})
    
    async def broadcast_trade(self, trade_data: Dict[str, Any]):
        """Broadcast trade execution"""
        await self.broadcast("trade", trade_data)
    
    async def broadcast_alert(self, alert_type: str, message: str):
        """Broadcast alert/notification"""
        await self.broadcast("alert", {
            "alert_type": alert_type,
            "message": message,
        })
    
    def get_connection_count(self) -> int:
        """Get number of active connections"""
        return len(self.active_connections)


# Global WebSocket manager instance
websocket_manager = WebSocketManager()
