import { saveMenuToDB, listenForMenu, sendOrderToDB, listenForOrders, updateOrderStatus, deleteOrder } from './firebase-service.js';

// --- CẤU HÌNH ---
const BANK_QR_URL = "https://img.vietqr.io/image/MB-0349315099-compact.png"; 

// --- STATE ---
let MENU_DATA = [];
let cart = {}; // Chứa các món đang chọn (Draft)
let dbOrders = []; // Chứa các món đã gửi lên Server
let currentTable = "Mang Về";
let currentCategory = "ALL";
let currentSearch = "";
let currentItemForModal = null;
let cashierSelectedTable = null; // Bàn thu ngân đang xem

const CATEGORIES = [
    { code: "ALL", name: "Tất cả" }, { code: "TS", name: "Trà sữa" },
    { code: "THQ", name: "Trà hoa quả" }, { code: "SCL", name: "Sữa chua" },
    { code: "CF", name: "Cà phê" }, { code: "TP", name: "Topping" }, { code: "AV", name: "Ăn vặt" }
];

document.addEventListener("DOMContentLoaded", () => {
    const urlParams = new URLSearchParams(window.location.search);
    const view = urlParams.get('view');
    currentTable = urlParams.get('ban') || "Mang Về";

    listenForMenu((data) => {
        MENU_DATA = data;
        if (!view) { renderCategories(); renderMenu(); }
    });

    listenForOrders((orders) => {
        dbOrders = orders;
        if (view === 'bep') initKitchenView(orders);
        if (view === 'thungan') initCashierView(orders);
        // Nếu modal giỏ hàng đang mở, render lại để thấy cập nhật (ví dụ chuyển trạng thái món)
        if (!view && !document.getElementById('cart-modal').classList.contains('hidden')) {
            openCartDetails();
        }
        if(!view) updateBottomBar();
    });

    if (!view) initCustomerView();
    if (view === 'bep') document.getElementById('view-kitchen').classList.remove('hidden');
    if (view === 'thungan') document.getElementById('view-cashier').classList.remove('hidden');

    // Các sự kiện phụ
    const uploadInput = document.getElementById('cashier-upload-excel');
    if(uploadInput) uploadInput.addEventListener('change', handleFileUpload);
    const searchInput = document.getElementById('search-input');
    if(searchInput) searchInput.addEventListener('input', (e) => {
        currentSearch = e.target.value.toLowerCase();
        renderMenu();
    });
});

/* ================= KHÁCH HÀNG ================= */

function initCustomerView() {
    document.getElementById('view-customer').classList.remove('hidden');
    document.getElementById('display-table').innerText = currentTable;
}

function renderCategories() {
    const container = document.getElementById('category-list');
    container.innerHTML = "";
    CATEGORIES.forEach(cat => {
        const div = document.createElement('div');
        div.className = `cat-chip ${cat.code === currentCategory ? 'active' : ''}`;
        div.innerText = cat.name;
        div.onclick = () => { currentCategory = cat.code; renderCategories(); renderMenu(); };
        container.appendChild(div);
    });
}

function renderMenu() {
    const container = document.getElementById('menu-container');
    container.innerHTML = "";
    
    const filtered = MENU_DATA.filter(item => {
        const matchCat = currentCategory === "ALL" ? item.PhanLoai !== 'TP' : item.PhanLoai === currentCategory;
        const matchSearch = item.TenMon.toLowerCase().includes(currentSearch);
        return matchCat && matchSearch;
    });

    filtered.forEach(item => {
        // Logic hiển thị số lượng: Chỉ tính trong Giỏ hàng (Draft) để khách biết mình đang chọn bao nhiêu
        let draftQty = 0;
        Object.values(cart).forEach(o => { 
            if(o.item.id === item.id && o.size === 'M') draftQty += o.qty; 
        });

        let btnHtml = "";
        if (item.hasMultiSize) {
            btnHtml = `<button class="btn-add-cart" onclick="window.openMultiSizeModal(${item.id})">Thêm</button>`;
        } else {
            if (draftQty === 0) {
                btnHtml = `<button class="btn-add-cart" onclick="window.addToCart(${item.id})">Thêm</button>`;
            } else {
                btnHtml = `
                    <div class="qty-control-inline">
                        <button onclick="window.removeDraftItem(${item.id})">-</button>
                        <span>${draftQty}</span>
                        <button onclick="window.addToCart(${item.id})">+</button>
                    </div>`;
            }
        }

        const div = document.createElement('div');
        div.className = "item-card";
        div.innerHTML = `
            <img src="${item.img}" class="item-img" onerror="this.src='https://via.placeholder.com/100'">
            <div class="item-info">
                <div><h6 class="item-title">${item.TenMon}</h6><span class="item-desc">${item.MoTa}</span></div>
                <div class="d-flex justify-content-between align-items-end">
                    <span class="item-price">${parseInt(item.GiaM).toLocaleString()}đ</span>
                    ${btnHtml}
                </div>
            </div>`;
        container.appendChild(div);
    });
    updateBottomBar();
}

// --- LOGIC GIỎ HÀNG (DRAFT) ---
function addToCart(id) {
    const item = MENU_DATA.find(i => i.id == id);
    const uniqueKey = `draft_${Date.now()}_${Math.random()}`;
    cart[uniqueKey] = { item: item, size: 'M', qty: 1, price: item.GiaM, note: '', timestamp: Date.now() };
    renderMenu(); 
    updateBottomBar();
}

function removeDraftItem(itemId) {
    const keys = Object.keys(cart).filter(k => cart[k].item.id === itemId && cart[k].size === 'M');
    if (keys.length > 0) delete cart[keys[keys.length - 1]];
    renderMenu(); updateBottomBar();
}

// Popup Size
function openMultiSizeModal(id) {
    const item = MENU_DATA.find(i => i.id == id);
    document.getElementById('modal-title').innerText = item.TenMon;
    document.getElementById('modal-desc').innerText = item.MoTa;
    document.getElementById('modal-img').src = item.img;
    document.getElementById('qty-M').innerText = "0";
    document.getElementById('qty-L').innerText = "0";
    currentItemForModal = item;
    document.getElementById('size-modal').classList.remove('hidden');
}

function updateModalQty(size, delta) {
    if (delta > 0 && currentItemForModal) {
        const item = currentItemForModal;
        const price = size === 'M' ? item.GiaM : item.GiaL;
        const uniqueKey = `draft_${Date.now()}_${Math.random()}`;
        cart[uniqueKey] = { item: item, size: size, qty: 1, price: price, note: '', timestamp: Date.now() };
        updateBottomBar();
        // Cập nhật số trên modal
        const el = document.getElementById(`qty-${size}`);
        el.innerText = parseInt(el.innerText) + 1;
    }
}

function updateBottomBar() {
    let count = 0; let total = 0;
    // Tính tổng draft
    Object.values(cart).forEach(o => { count += o.qty; total += o.price * o.qty; });
    // Tính tổng history (đã gọi)
    const history = dbOrders.filter(o => o.table == currentTable);
    history.forEach(o => { o.items.forEach(i => { count += i.qty; total += i.price * i.qty; }); });

    document.getElementById('total-count').innerText = count;
    document.getElementById('total-price').innerText = total.toLocaleString() + "đ";
}

// --- CHI TIẾT GIỎ HÀNG (MŨI TÊN LÊN) ---
function openCartDetails() {
    const list = document.getElementById('cart-items-list');
    list.innerHTML = "";
    
    // 1. Render Món Đã Gọi (History)
    const history = dbOrders.filter(o => o.table == currentTable).sort((a,b) => b.timestamp - a.timestamp);
    if(history.length > 0) {
        list.innerHTML += `<div class="mb-2 text-success fw-bold small">MÓN ĐÃ GỌI (Bếp đang làm)</div>`;
        history.forEach(batch => {
            const time = new Date(batch.timestamp).toLocaleTimeString().slice(0,5);
            batch.items.forEach(i => {
                const note = i.note ? `<div class="text-muted small">Note: ${i.note}</div>` : '';
                list.innerHTML += `
                    <div class="cart-item-row" style="border-left: 4px solid #198754; background: #f0fff4;">
                        <span class="status-badge badge-sent">${time}</span>
                        <div class="d-flex justify-content-between">
                            <div><b>${i.name} (${i.size})</b> <br> <small>${i.price.toLocaleString()}đ</small></div>
                            <div class="fw-bold">x${i.qty}</div>
                        </div>
                        ${note}
                    </div>`;
            });
        });
    }

    // 2. Render Món Đang Chọn (Draft)
    const drafts = Object.entries(cart);
    if(drafts.length > 0) {
        list.innerHTML += `<div class="mt-3 mb-2 text-warning fw-bold small">MÓN ĐANG CHỌN (Chưa gửi)</div>`;
        drafts.forEach(([key, order]) => {
            list.innerHTML += `
                <div class="cart-item-row" style="border-left: 4px solid #ffc107;">
                    <span class="status-badge badge-draft">Mới</span>
                    <div class="d-flex justify-content-between">
                        <div><b>${order.item.TenMon} (${order.size})</b> <br> <small>${order.price.toLocaleString()}đ</small></div>
                        <div class="qty-control-inline" style="background:#eee">
                            <button onclick="window.removeDraft('${key}')">-</button><span>${order.qty}</span><button onclick="window.addDraft('${key}')">+</button>
                        </div>
                    </div>
                    <input type="text" class="note-input" placeholder="Ghi chú cho bếp..." value="${order.note}" onchange="window.updateNote('${key}', this.value)">
                </div>`;
        });
    }

    // Cập nhật trạng thái nút
    const hasDraft = drafts.length > 0;
    const hasHistory = history.length > 0;
    document.getElementById('btn-order').disabled = !hasDraft;
    
    // Nút thanh toán: Chỉ sáng khi KHÔNG còn món draft nào và CÓ lịch sử gọi
    const canPay = !hasDraft && hasHistory;
    document.getElementById('btn-pay').disabled = !canPay; 
    
    document.getElementById('cart-modal').classList.remove('hidden');
}

function removeDraft(key) { delete cart[key]; updateBottomBar(); openCartDetails(); renderMenu(); }
function addDraft(key) { const old = cart[key]; addToCart(old.item.id); openCartDetails(); }
function updateNote(key, val) { if(cart[key]) cart[key].note = val; }

function submitOrder() {
    if(Object.keys(cart).length === 0) return;
    if(confirm("Gửi món xuống bếp?")) {
        const items = Object.values(cart).map(c => ({
            name: c.item.TenMon, size: c.size, qty: c.qty, price: c.price, note: c.note
        }));
        let total = 0; items.forEach(i => total += i.price * i.qty);
        sendOrderToDB(currentTable, items, 0, total);
        cart = {}; 
        alert("Gọi món thành công!");
        renderMenu(); updateBottomBar(); openCartDetails();
    }
}

// --- HÓA ĐƠN & QR ---
function requestBill() {
    document.getElementById('cart-modal').classList.add('hidden');
    
    const html = generateBillHtml(currentTable);
    document.getElementById('bill-content').innerHTML = html;
    
    // Khách: Hiện nút đóng/lưu, Ẩn nút thu ngân
    document.getElementById('customer-actions').classList.remove('hidden');
    document.getElementById('cashier-actions').classList.add('hidden');
    
    document.getElementById('bill-modal').classList.remove('hidden');
}

function generateBillHtml(tId) {
    const orders = dbOrders.filter(o => o.table == tId);
    let itemsHtml = "";
    let totalAll = 0;
    
    orders.forEach(batch => {
        batch.items.forEach(i => {
            const sub = i.price * i.qty;
            totalAll += sub;
            itemsHtml += `
                <div class="d-flex justify-content-between mb-1 border-bottom border-secondary border-opacity-25 pb-1">
                    <div><b>${i.name}</b> (${i.size}) <br> <small class="text-muted">x${i.qty}</small></div>
                    <div class="fw-bold">${sub.toLocaleString()}</div>
                </div>`;
        });
    });

    const qrLink = `${BANK_QR_BASE}?addInfo=Ban ${tId}`;

    return `
        <div class="text-center">
            <h4 class="fw-bold text-uppercase m-0">NACA Coffee & Tea</h4>
            <small>ĐC: Thôn 9, Cao Nhân, Thủy Nguyên, HP</small><br>
            <small>ĐT: 0349.315.099</small>
        </div>
        <hr>
        <div class="d-flex justify-content-between fw-bold mb-3">
            <span>Bàn: ${tId}</span>
            <span>${new Date().toLocaleTimeString()}</span>
        </div>
        ${itemsHtml}
        <hr>
        <div class="d-flex justify-content-between fs-4 fw-bold">
            <span>TỔNG:</span>
            <span>${totalAll.toLocaleString()} đ</span>
        </div>
        <div class="text-center mt-3 bg-light p-2 rounded">
            <img src="${qrLink}" style="width:150px; height:150px">
            <div class="fw-bold mt-1">Quét mã thanh toán</div>
            <div class="small text-muted">Nội dung: Ban ${tId}</div>
        </div>
        <div class="text-center mt-3 fst-italic small">Cảm ơn quý khách và hẹn gặp lại!</div>
    `;
}

// --- BẾP ---
function initKitchenView(orders) {
    const list = document.getElementById('kitchen-orders');
    list.innerHTML = "";
    const active = orders.filter(o => o.status === 'moi' || o.status === 'dang_lam');
    
    if(active.length === 0) { list.innerHTML = "<p class='text-center text-white mt-5'>Không có đơn...</p>"; return; }

    active.forEach(o => {
        const itemsHtml = o.items.map(i => {
            const note = i.note ? `<div class="text-info small"><i class="fas fa-pen"></i> ${i.note}</div>` : '';
            return `<div class="border-bottom border-secondary py-1">${i.name} (${i.size}) x${i.qty} ${note}</div>`;
        }).join('');
        
        let btn = o.status==='moi' 
            ? `<button class="btn btn-warning w-100 fw-bold" onclick="window.updateOrderStatus('${o.key}','dang_lam')">NHẬN ĐƠN</button>`
            : `<button class="btn btn-success w-100 fw-bold" onclick="window.updateOrderStatus('${o.key}','xong')">PHỤC VỤ XONG</button>`;
        
        const div = document.createElement('div'); 
        div.className = "card-kitchen mb-3 bg-dark text-white p-3 rounded shadow";
        div.innerHTML = `
            <div class="d-flex justify-content-between text-warning border-bottom border-secondary pb-2 mb-2">
                <h4 class="m-0">BÀN ${o.table}</h4>
                <span>${new Date(o.timestamp).toLocaleTimeString().slice(0,5)}</span>
            </div>
            <div class="mb-3">${itemsHtml}</div>
            ${btn}`;
        list.appendChild(div);
    });
}

// --- THU NGÂN ---
function initCashierView(orders) {
    const grid = document.getElementById('table-grid');
    grid.innerHTML = "";
    const tables = [...new Set(orders.map(o => o.table))];
    
    if(tables.length === 0) { grid.innerHTML = "<p class='text-center text-muted'>Chưa có bàn nào.</p>"; return; }

    tables.forEach(t => {
        const col = document.createElement('div');
        col.className = "col-4 col-md-3";
        col.innerHTML = `
            <div class="table-btn active p-3 text-center border rounded bg-white shadow-sm" 
                 onclick="window.openCashierBill('${t}')" style="cursor:pointer">
                <h4 class="m-0 fw-bold text-success">${t}</h4>
                <small class="text-muted">Đang phục vụ</small>
            </div>`;
        grid.appendChild(col);
    });
}

function openCashierBill(tId) {
    cashierSelectedTable = tId;
    const html = generateBillHtml(tId);
    document.getElementById('bill-content').innerHTML = html;
    
    // Thu ngân: Ẩn nút khách, hiện nút thu ngân
    document.getElementById('customer-actions').classList.add('hidden');
    document.getElementById('cashier-actions').classList.remove('hidden');
    
    document.getElementById('bill-modal').classList.remove('hidden');
}

function finishTable(type) {
    if(!cashierSelectedTable) return;
    let msg = type === 'kv' ? "Xác nhận đã nhập KiotViet?" : "Xác nhận đã Thanh toán?";
    if(confirm(msg + " Bàn sẽ được xóa.")) {
        const toDelete = dbOrders.filter(o => o.table == cashierSelectedTable);
        toDelete.forEach(o => deleteOrder(o.key));
        document.getElementById('bill-modal').classList.add('hidden');
        alert("Đã chốt bàn " + cashierSelectedTable);
    }
}

// --- CÔNG KHAI HÀM RA WINDOW (QUAN TRỌNG NHẤT) ---
window.addToCart = addToCart;
window.removeDraftItem = removeDraftItem;
window.openMultiSizeModal = openMultiSizeModal;
window.updateModalQty = updateModalQty;
window.openCartDetails = openCartDetails;
window.closeCartDetails = () => document.getElementById('cart-modal').classList.add('hidden');
window.closeModal = () => document.getElementById('size-modal').classList.add('hidden');
window.removeDraft = removeDraft;
window.addDraft = addDraft;
window.updateNote = updateNote;
window.submitOrder = submitOrder;
window.requestBill = requestBill;
window.downloadBill = () => html2canvas(document.getElementById('bill-content')).then(c => { const l=document.createElement('a'); l.download="Bill.png"; l.href=c.toDataURL(); l.click(); });
window.updateOrderStatus = updateOrderStatus;
window.openCashierBill = openCashierBill;
window.finishTable = finishTable;