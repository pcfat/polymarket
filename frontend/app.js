// Socket.IO connection
const socket = io();

// DOM Elements
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const paperModeBtn = document.getElementById('paperModeBtn');
const liveModeBtn = document.getElementById('liveModeBtn');
const clearRecordsBtn = document.getElementById('clearRecordsBtn');
const engineStatus = document.getElementById('engineStatus');
const currentMode = document.getElementById('currentMode');
const totalTrades = document.getElementById('totalTrades');
const winRate = document.getElementById('winRate');
const totalPnl = document.getElementById('totalPnl');
const avgPnl = document.getElementById('avgPnl');
const updateConfigBtn = document.getElementById('updateConfigBtn');
const tradeFilter = document.getElementById('tradeFilter');
const marketCount = document.getElementById('marketCount');
const marketsGrid = document.getElementById('marketsGrid');
const tradesBody = document.getElementById('tradesBody');
const logsContainer = document.getElementById('logsContainer');
const confirmModal = document.getElementById('confirmModal');
const confirmTitle = document.getElementById('confirmTitle');
const confirmMessage = document.getElementById('confirmMessage');
const confirmYes = document.getElementById('confirmYes');
const confirmNo = document.getElementById('confirmNo');

// State
let currentModeValue = 'paper';
let pendingAction = null;

// Utility Functions
function formatTimestamp(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleString('zh-TW', { 
        year: 'numeric', 
        month: '2-digit', 
        day: '2-digit',
        hour: '2-digit', 
        minute: '2-digit', 
        second: '2-digit' 
    });
}

function formatCurrency(value) {
    return `$${parseFloat(value).toFixed(2)}`;
}

function addLog(message, type = 'info') {
    const logEntry = document.createElement('div');
    logEntry.className = `log-entry ${type}`;
    logEntry.textContent = `[${new Date().toLocaleTimeString('zh-TW')}] ${message}`;
    logsContainer.insertBefore(logEntry, logsContainer.firstChild);
    
    // Keep only last 100 logs
    while (logsContainer.children.length > 100) {
        logsContainer.removeChild(logsContainer.lastChild);
    }
}

function showConfirmDialog(title, message, onConfirm) {
    confirmTitle.textContent = title;
    confirmMessage.textContent = message;
    confirmModal.classList.add('active');
    
    pendingAction = onConfirm;
}

function hideConfirmDialog() {
    confirmModal.classList.remove('active');
    pendingAction = null;
}

// Socket.IO Event Handlers
socket.on('connect', () => {
    statusDot.className = 'status-dot connected';
    statusText.textContent = '已連接';
    addLog('已連接到伺服器', 'success');
});

socket.on('disconnect', () => {
    statusDot.className = 'status-dot disconnected';
    statusText.textContent = '已斷線';
    addLog('已斷開連接', 'error');
});

socket.on('status', (data) => {
    updateStatus(data);
});

socket.on('modeChanged', (data) => {
    currentModeValue = data.mode;
    updateModeUI(data.mode);
    addLog(`交易模式已切換至: ${data.mode === 'paper' ? '模擬盤' : '實盤'}`, 'info');
});

socket.on('newTrade', (trade) => {
    addLog(`新交易: ${trade.side} ${trade.outcome} - ${trade.market_question.substring(0, 50)}...`, 'success');
});

socket.on('stats', (stats) => {
    updateStats(stats);
});

socket.on('markets', (data) => {
    updateMarkets(data.markets);
    marketCount.textContent = data.count;
});

socket.on('recentTrades', (trades) => {
    updateTradesTable(trades);
});

socket.on('recordsCleared', () => {
    addLog('所有紀錄已清除', 'warning');
    updateTradesTable([]);
});

socket.on('error', (data) => {
    addLog(`錯誤: ${data.message}`, 'error');
});

// Update Functions
function updateStatus(data) {
    if (data.isRunning) {
        engineStatus.textContent = '運行中 🟢';
        engineStatus.style.color = 'var(--accent-green)';
        startBtn.disabled = true;
        stopBtn.disabled = false;
    } else {
        engineStatus.textContent = '已停止 🔴';
        engineStatus.style.color = 'var(--accent-red)';
        startBtn.disabled = false;
        stopBtn.disabled = true;
    }
    
    currentModeValue = data.mode;
    updateModeUI(data.mode);
}

function updateModeUI(mode) {
    if (mode === 'paper') {
        paperModeBtn.classList.add('active');
        liveModeBtn.classList.remove('active');
        currentMode.textContent = '模擬盤 📝';
        currentMode.style.color = 'var(--accent-purple)';
    } else {
        paperModeBtn.classList.remove('active');
        liveModeBtn.classList.add('active');
        currentMode.textContent = '實盤 💰';
        currentMode.style.color = 'var(--accent-yellow)';
    }
}

function updateStats(stats) {
    totalTrades.textContent = stats.total_trades || 0;
    winRate.textContent = `${(stats.win_rate || 0).toFixed(1)}%`;
    
    const pnl = stats.total_pnl || 0;
    totalPnl.textContent = formatCurrency(pnl);
    totalPnl.className = `stat-value ${pnl >= 0 ? 'positive' : 'negative'}`;
    
    const avg = stats.avg_pnl || 0;
    avgPnl.textContent = formatCurrency(avg);
    avgPnl.className = `stat-value ${avg >= 0 ? 'positive' : 'negative'}`;
}

function updateMarkets(markets) {
    if (!markets || markets.length === 0) {
        marketsGrid.innerHTML = '<div class="no-data">暫無活躍市場</div>';
        return;
    }
    
    marketsGrid.innerHTML = markets.map(market => `
        <div class="market-card">
            <h4>${market.question}</h4>
            <div class="market-info">
                <small style="color: var(--text-secondary);">到期時間: ${new Date(market.end_date).toLocaleString('zh-TW')}</small>
            </div>
        </div>
    `).join('');
}

function updateTradesTable(trades) {
    if (!trades || trades.length === 0) {
        tradesBody.innerHTML = '<tr class="no-data-row"><td colspan="9">暫無交易紀錄</td></tr>';
        return;
    }
    
    tradesBody.innerHTML = trades.map(trade => `
        <tr>
            <td>${formatTimestamp(trade.timestamp)}</td>
            <td><span class="mode-badge ${trade.mode}">${trade.mode === 'paper' ? '模擬' : '實盤'}</span></td>
            <td style="max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${trade.market_question}">${trade.market_question}</td>
            <td>${trade.side}</td>
            <td style="color: ${trade.outcome === 'YES' ? 'var(--accent-green)' : 'var(--accent-red)'}">${trade.outcome}</td>
            <td>${trade.price.toFixed(4)}</td>
            <td>${formatCurrency(trade.amount)}</td>
            <td><span class="status-badge ${trade.status}">${trade.status}</span></td>
            <td style="color: ${trade.pnl >= 0 ? 'var(--accent-green)' : 'var(--accent-red)'}">${formatCurrency(trade.pnl)}</td>
        </tr>
    `).join('');
}

// API Functions
async function apiCall(endpoint, method = 'GET', body = null) {
    try {
        const options = {
            method,
            headers: {
                'Content-Type': 'application/json'
            }
        };
        
        if (body) {
            options.body = JSON.stringify(body);
        }
        
        const response = await fetch(endpoint, options);
        const data = await response.json();
        
        if (!data.success) {
            throw new Error(data.error || 'Unknown error');
        }
        
        return data;
    } catch (error) {
        addLog(`API 錯誤: ${error.message}`, 'error');
        throw error;
    }
}

async function startEngine() {
    try {
        await apiCall('/api/start', 'POST');
        addLog('引擎已啟動', 'success');
    } catch (error) {
        // Error already logged
    }
}

async function stopEngine() {
    try {
        await apiCall('/api/stop', 'POST');
        addLog('引擎已停止', 'warning');
    } catch (error) {
        // Error already logged
    }
}

async function switchMode(mode) {
    try {
        await apiCall('/api/mode', 'POST', { mode });
        addLog(`已切換到${mode === 'paper' ? '模擬盤' : '實盤'}模式`, 'info');
    } catch (error) {
        // Error already logged
    }
}

async function clearRecords() {
    try {
        await apiCall('/api/records', 'DELETE');
        addLog('所有紀錄已清除', 'warning');
    } catch (error) {
        // Error already logged
    }
}

async function updateConfig() {
    try {
        const config = {
            tradeAmount: parseFloat(document.getElementById('tradeAmount').value),
            buyThreshold: parseFloat(document.getElementById('buyThreshold').value),
            sellThreshold: parseFloat(document.getElementById('sellThreshold').value),
            tradeWindowSeconds: parseInt(document.getElementById('tradeWindow').value)
        };
        
        await apiCall('/api/config', 'PUT', config);
        addLog('策略設定已更新', 'success');
    } catch (error) {
        // Error already logged
    }
}

async function loadTrades(mode = null) {
    try {
        const query = mode ? `?mode=${mode}` : '';
        const data = await apiCall(`/api/trades${query}`);
        updateTradesTable(data.trades);
    } catch (error) {
        // Error already logged
    }
}

// Event Listeners
startBtn.addEventListener('click', startEngine);
stopBtn.addEventListener('click', stopEngine);

paperModeBtn.addEventListener('click', () => {
    if (currentModeValue !== 'paper') {
        switchMode('paper');
    }
});

liveModeBtn.addEventListener('click', () => {
    if (currentModeValue !== 'live') {
        showConfirmDialog(
            '切換到實盤模式',
            '您確定要切換到實盤模式嗎？這將使用真實資金進行交易。',
            () => switchMode('live')
        );
    }
});

clearRecordsBtn.addEventListener('click', () => {
    showConfirmDialog(
        '清除所有紀錄',
        '您確定要清除所有交易紀錄和市場快照嗎？此操作無法撤銷。',
        clearRecords
    );
});

updateConfigBtn.addEventListener('click', updateConfig);

tradeFilter.addEventListener('change', (e) => {
    const mode = e.target.value || null;
    loadTrades(mode);
});

confirmYes.addEventListener('click', () => {
    if (pendingAction) {
        pendingAction();
    }
    hideConfirmDialog();
});

confirmNo.addEventListener('click', hideConfirmDialog);

// Close modal on click outside
confirmModal.addEventListener('click', (e) => {
    if (e.target === confirmModal) {
        hideConfirmDialog();
    }
});

// Initialize
async function init() {
    try {
        const statusData = await apiCall('/api/status');
        updateStatus(statusData);
        
        // Load config
        if (statusData.config) {
            document.getElementById('tradeAmount').value = statusData.config.tradeAmount;
            document.getElementById('buyThreshold').value = statusData.config.buyThreshold;
            document.getElementById('sellThreshold').value = statusData.config.sellThreshold;
            document.getElementById('tradeWindow').value = statusData.config.tradeWindowSeconds;
        }
        
        addLog('系統初始化完成', 'success');
    } catch (error) {
        addLog('系統初始化失敗', 'error');
    }
}

init();
