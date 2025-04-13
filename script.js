// 初始化数据
let prizes = JSON.parse(localStorage.getItem('prizes')) || [];
let records = JSON.parse(localStorage.getItem('records')) || [];

// DOM 元素
const prizeForm = document.getElementById('prizeForm');
const prizeNameInput = document.getElementById('prizeName');
const prizeCountInput = document.getElementById('prizeCount');
const prizeList = document.getElementById('prizeList');
const recordList = document.getElementById('recordList');
const prizeContent = document.getElementById('prizeContent');
const scratchCanvas = document.getElementById('scratchCanvas');
const newCardBtn = document.getElementById('newCardBtn');
const resetGameBtn = document.getElementById('resetGameBtn');

// Canvas 相关变量
const ctx = scratchCanvas.getContext('2d');
let isDrawing = false;
let lastX = 0;
let lastY = 0;
let scratchedPercentage = 0;
let totalPixels = scratchCanvas.width * scratchCanvas.height;
let scratchedPixels = 0;
let currentPrize = null;

// 初始化函数
function init() {
    renderPrizeList();
    renderRecordList();
    initScratchCard();
    
    // 添加事件监听
    prizeForm.addEventListener('submit', addPrize);
    newCardBtn.addEventListener('click', initScratchCard);
    resetGameBtn.addEventListener('click', resetGame);
    
    // 触摸设备支持
    scratchCanvas.addEventListener('mousedown', startDrawing);
    scratchCanvas.addEventListener('mousemove', draw);
    scratchCanvas.addEventListener('mouseup', stopDrawing);
    scratchCanvas.addEventListener('mouseout', stopDrawing);
    
    scratchCanvas.addEventListener('touchstart', handleTouchStart);
    scratchCanvas.addEventListener('touchmove', handleTouchMove);
    scratchCanvas.addEventListener('touchend', stopDrawing);
}

// 渲染奖品列表
function renderPrizeList() {
    prizeList.innerHTML = '';
    
    if (prizes.length === 0) {
        const emptyRow = document.createElement('tr');
        emptyRow.innerHTML = `
            <td colspan="3" class="px-4 py-3 text-center text-gray-500 italic">暂无奖品，请添加</td>
        `;
        prizeList.appendChild(emptyRow);
        return;
    }
    
    prizes.forEach((prize, index) => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td class="px-4 py-3">${prize.name}</td>
            <td class="px-4 py-3">${prize.count}</td>
            <td class="px-4 py-3">
                <button class="delete-btn text-red-500 hover:text-red-700" data-index="${index}">
                    删除
                </button>
            </td>
        `;
        prizeList.appendChild(row);
    });
    
    // 添加删除事件监听
    document.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const index = parseInt(this.getAttribute('data-index'));
            prizes.splice(index, 1);
            savePrizes();
            renderPrizeList();
        });
    });
}

// 渲染中奖记录
function renderRecordList() {
    recordList.innerHTML = '';
    
    if (records.length === 0) {
        const emptyRow = document.createElement('tr');
        emptyRow.innerHTML = `
            <td colspan="5" class="px-4 py-3 text-center text-gray-500 italic">暂无中奖记录</td>
        `;
        recordList.appendChild(emptyRow);
        return;
    }
    
    // 按时间从早到晚排列（不再倒序）
    const sortedRecords = [...records].sort((a, b) => a.time - b.time);
    
    sortedRecords.forEach((record, index) => {
        const row = document.createElement('tr');
        const date = new Date(record.time);
        const formattedTime = `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
        
        // 格式化兑奖时间（如果有）
        let redeemTimeFormatted = '-';
        if (record.redeemTime) {
            const redeemDate = new Date(record.redeemTime);
            redeemTimeFormatted = `${redeemDate.getFullYear()}-${(redeemDate.getMonth() + 1).toString().padStart(2, '0')}-${redeemDate.getDate().toString().padStart(2, '0')} ${redeemDate.getHours().toString().padStart(2, '0')}:${redeemDate.getMinutes().toString().padStart(2, '0')}`;
        }
        
        // 根据是否已兑奖决定是否显示兑奖按钮
        const redeemButton = record.redeemTime ? 
            `<span class="text-green-500">已兑奖</span>` : 
            `<button class="redeem-btn bg-blue-500 hover:bg-blue-600 text-white text-xs py-1 px-2 rounded" data-index="${index}">兑奖</button>`;
        
        row.innerHTML = `
            <td class="px-4 py-3 text-center">${index + 1}</td>
            <td class="px-4 py-3">${formattedTime}</td>
            <td class="px-4 py-3 font-medium text-amber-600">${record.prize}</td>
            <td class="px-4 py-3">${redeemTimeFormatted}</td>
            <td class="px-4 py-3">${redeemButton}</td>
        `;
        recordList.appendChild(row);
    });
    
    // 添加兑奖按钮事件监听
    document.querySelectorAll('.redeem-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const index = parseInt(this.getAttribute('data-index'));
            redeemPrize(index);
        });
    });
}

// 添加奖品
function addPrize(e) {
    e.preventDefault();
    
    const name = prizeNameInput.value.trim();
    const count = parseInt(prizeCountInput.value);
    
    if (!name || count <= 0) {
        alert('请输入有效的奖品名称和数量！');
        return;
    }
    
    // 检查是否已存在相同名称的奖品
    const existingIndex = prizes.findIndex(p => p.name === name);
    if (existingIndex >= 0) {
        prizes[existingIndex].count += count;
    } else {
        prizes.push({ name, count });
    }
    
    savePrizes();
    renderPrizeList();
    
    // 清空表单
    prizeNameInput.value = '';
    prizeCountInput.value = '';
    
    // 如果是第一个奖品，初始化刮刮卡
    if (prizes.length === 1) {
        initScratchCard();
    }
}

// 保存奖品到本地存储
function savePrizes() {
    localStorage.setItem('prizes', JSON.stringify(prizes));
}

// 保存记录到本地存储
function saveRecords() {
    localStorage.setItem('records', JSON.stringify(records));
}

// 初始化刮刮卡
// 初始化刮刮卡
function initScratchCard() {
    // 检查是否有可用奖品
    const availablePrizes = prizes.filter(prize => prize.count > 0);
    
    if (availablePrizes.length === 0) {
        prizeContent.textContent = '奖品已抽完';
        prizeContent.style.color = '#9ca3af';
        drawScratchLayer('#e5e7eb');
        return;
    }
    
    // 随机选择一个奖品
    const totalWeight = availablePrizes.reduce((sum, prize) => sum + prize.count, 0);
    let random = Math.floor(Math.random() * totalWeight);
    let selectedPrize = null;
    
    for (const prize of availablePrizes) {
        if (random < prize.count) {
            selectedPrize = prize;
            break;
        }
        random -= prize.count;
    }
    
    // 设置当前奖品
    currentPrize = selectedPrize;
    prizeContent.textContent = currentPrize.name;
    prizeContent.style.color = '#d97706';
    
    // 重置刮刮卡状态
    scratchedPercentage = 0;
    scratchedPixels = 0;
    
    // 绘制刮刮层 - 确保每次都重新绘制完整的蒙层
    ctx.globalCompositeOperation = 'source-over';
    drawScratchLayer('#6b7280');
}

// 绘制刮刮层
function drawScratchLayer(color) {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, scratchCanvas.width, scratchCanvas.height);
}

// 开始刮卡
function startDrawing(e) {
    isDrawing = true;
    [lastX, lastY] = getCoordinates(e);
}

// 处理触摸开始事件
function handleTouchStart(e) {
    e.preventDefault();
    startDrawing(e.touches[0]);
}

// 处理触摸移动事件
function handleTouchMove(e) {
    e.preventDefault();
    draw(e.touches[0]);
}

// 刮卡过程
function draw(e) {
    if (!isDrawing) return;
    
    const [x, y] = getCoordinates(e);
    
    ctx.globalCompositeOperation = 'destination-out';
    ctx.lineWidth = 30;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(x, y);
    ctx.stroke();
    
    // 计算刮开的像素数量（近似值）
    const distance = Math.sqrt(Math.pow(x - lastX, 2) + Math.pow(y - lastY, 2));
    const area = Math.PI * Math.pow(ctx.lineWidth / 2, 2) + ctx.lineWidth * distance;
    scratchedPixels += area;
    
    // 计算刮开的百分比
    scratchedPercentage = Math.min(100, (scratchedPixels / totalPixels) * 100);
    
    // 如果刮开超过50%，显示全部
    if (scratchedPercentage > 50 && currentPrize) {
        revealPrize();
    }
    
    [lastX, lastY] = [x, y];
}

// 停止刮卡
function stopDrawing() {
    isDrawing = false;
}

// 获取坐标
function getCoordinates(e) {
    const rect = scratchCanvas.getBoundingClientRect();
    const scaleX = scratchCanvas.width / rect.width;
    const scaleY = scratchCanvas.height / rect.height;
    
    return [
        (e.clientX - rect.left) * scaleX,
        (e.clientY - rect.top) * scaleY
    ];
}

// 显示奖品
function revealPrize() {
    // 清除刮刮层
    ctx.clearRect(0, 0, scratchCanvas.width, scratchCanvas.height);
    
    // 更新奖品数量
    const index = prizes.findIndex(p => p.name === currentPrize.name);
    prizes[index].count--;
    
    // 添加中奖记录
    records.push({
        prize: currentPrize.name,
        time: new Date().getTime(),
        redeemTime: null // 初始化为null，表示未兑奖
    });
    
    // 保存数据
    savePrizes();
    saveRecords();
    
    // 更新界面
    renderPrizeList();
    renderRecordList();
    
    // 创建庆祝效果
    createConfetti();
    
    // 重置当前奖品
    currentPrize = null;
}

// 创建庆祝效果
function createConfetti() {
    const container = document.querySelector('.scratch-card');
    
    for (let i = 0; i < 50; i++) {
        const confetti = document.createElement('div');
        confetti.classList.add('confetti');
        
        // 随机位置和颜色
        confetti.style.left = `${Math.random() * 100}%`;
        confetti.style.top = `${Math.random() * 100}%`;
        confetti.style.backgroundColor = getRandomColor();
        confetti.style.animationDelay = `${Math.random() * 2}s`;
        
        container.appendChild(confetti);
        
        // 动画结束后移除
        setTimeout(() => {
            confetti.remove();
        }, 3000);
    }
}

// 获取随机颜色
function getRandomColor() {
    const colors = ['#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899'];
    return colors[Math.floor(Math.random() * colors.length)];
}

// 重置游戏
function resetGame() {
    // 弹出确认对话框
    if (confirm('确定要重置游戏吗？这将清空所有奖品和中奖记录！')) {
        // 清空数据
        prizes = [];
        records = [];
        
        // 清除本地存储
        localStorage.removeItem('prizes');
        localStorage.removeItem('records');
        
        // 重新渲染界面
        renderPrizeList();
        renderRecordList();
        
        // 重置刮刮卡
        prizeContent.textContent = '奖品已抽完';
        prizeContent.style.color = '#9ca3af';
        drawScratchLayer('#e5e7eb');
        
        // 重置当前奖品
        currentPrize = null;
        
        // 提示用户
        alert('游戏已重置！');
    }
}

// 兑奖功能
function redeemPrize(index) {
    // 获取对应的记录
    const sortedRecords = [...records].sort((a, b) => a.time - b.time);
    const record = sortedRecords[index];
    
    // 在原始records数组中找到对应的记录
    const originalIndex = records.findIndex(r => r.time === record.time && r.prize === record.prize);
    
    if (originalIndex !== -1) {
        // 设置兑奖时间
        records[originalIndex].redeemTime = new Date().getTime();
        
        // 保存到本地存储
        saveRecords();
        
        // 更新界面
        renderRecordList();
        
        // 提示用户
        alert(`奖品「${record.prize}」已成功兑奖！`);
    }
}

// 初始化应用
init();