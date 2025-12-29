import { saveMenuToDB, listenForMenu, sendOrderToDB, listenForOrders, updateOrderStatus, deleteOrder, set, ref, db } from './firebase-service.js';

// --- CẤU HÌNH ---
// Link QR: Thay STK và NH vào link này. Ví dụ: MB Bank, STK 0349315099
const BANK_QR_BASE = "https://img.vietqr.io/image/MB-0349315099-compact.png"; 

// --- BIẾN TOÀN CỤC ---
let MENU_DATA = [];
let cart = {}; // Giỏ hàng (Món chưa gửi) - Key: unique_id
let dbOrders = []; // Đơn hàng từ Firebase
let currentTable = "Mang Về";
let currentCategory = "ALL";
let currentSearch = "";
let currentItemForModal = null;
let currentTableForCashier = null; // Bàn thu ngân đang xem

const CATEGORIES = [
    { code: "ALL", name: "Tất cả" }, { code: "TS", name: "Trà sữa" },
    { code: "THQ", name: "Trà hoa quả" }, { code: "SCL", name: "Sữa chua" },
    { code: "CF", name: "Cà phê" }, { code: "TP", name: "Topping" }, 
    { code: "AV", name: "Ăn vặt" }
];

// --- MAIN INIT ---
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
        
        // Nếu khách đang mở giỏ hàng, cập nhật lại để thấy món đã gọi
        if (!view && !document.getElementById('cart-modal').classList.contains('hidden')) {
            openCartDetails();
        }
        if(!view) updateBottomBar();
    });

    if (!view) initCustomerView();
    if (view === 'bep') document.getElementById('view-kitchen').classList.remove('hidden');
    if (view === 'thungan') document.getElementById('view-cashier').classList.remove('hidden');

    const uploadInput = document.getElementById('cashier-upload-excel');
    if(uploadInput) uploadInput.addEventListener('change', handleFileUpload);

    const searchInput = document.getElementById('search-input');
    if(searchInput) searchInput.addEventListener('input', (e) => {
        currentSearch = e.target.value.toLowerCase();
        renderMenu();
    });
});

/* ==================== 1. LOGIC KHÁCH HÀNG ==================== */

function initCustomerView() {
    document.getElementById('view-customer').classList.remove('hidden');
    const displayTable = document.getElementById('display-table');
    if(displayTable) displayTable.innerText = currentTable;
}

function renderCategories() {
    const container = document.getElementById('category-list');
    if(!container) return;
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
    if(!container) return;
    container.innerHTML = "";
    
    const filtered = MENU_DATA.filter(item => {
        const matchCat = currentCategory === "ALL" ? item.PhanLoai !== 'TP' : item.PhanLoai === currentCategory;
        const matchSearch = item.TenMon.toLowerCase().includes(currentSearch);
        return matchCat && matchSearch;
    });

    filtered.forEach(item => {
        // Tính số lượng trong giỏ (Local)
        let currentQty = 0;
        Object.values(cart).forEach(order => {
            if (order.item.id === item.id && order.size === 'M') currentQty += order.qty;
        });

        let btnHtml = "";
        if (item.hasMultiSize) {
            btnHtml = `<button class="btn-add-cart" onclick="openMultiSizeModal(${item.id})">Thêm</button>`;
        } else {
            if (currentQty === 0) {
                btnHtml = `<button class="btn-add-cart" onclick="addToCart(${item.id})">Thêm</button>`;
            } else {
                btnHtml = `
                    <div class="qty-control">
                        <button class="qty-btn" onclick="removeRecentItem(${item.id})">-</button>
                        <span class="qty-num">${currentQty}</span>
                        <button class="qty-btn" onclick="addToCart(${item.id})">+</button>
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

function addToCart(id) {
    const item = MENU_DATA.find(i => i.id == id);
    const uniqueKey = `draft_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    cart[uniqueKey] = { 
        item: item, size: 'M', qty: 1, price: item.GiaM, 
        note: '', timestamp: Date.now() 
    };
    renderMenu(); updateBottomBar();
}

function removeRecentItem(itemId) {
    const keys = Object.keys(cart).filter(k => cart[k].item.id === itemId && cart[k].size === 'M');
    if (keys.length > 0) {
        delete cart[keys[keys.length - 1]];
    }
    renderMenu(); updateBottomBar();
}

// Logic Popup Size
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
        cart[uniqueKey] = {
            item: item, size: size, qty: 1, price: price, note: '', timestamp: Date.now()
        };
        updateBottomBar();
        alert(`Đã thêm 1 ${item.TenMon} (${size})`);
    }
}

function updateBottomBar() {
    let count = 0; let total = 0;
    
    // Tính Local Cart
    Object.values(cart).forEach(o => { count += o.qty; total += o.price * o.qty; });

    // Tính DB (Món đã gọi)
    const ordered = dbOrders.filter(o => o.table == currentTable);
    ordered.forEach(o => {
        o.items.forEach(i => { count += i.qty; total += i.price * i.qty; });
    });

    document.getElementById('total-count').innerText = count;
    document.getElementById('total-price').innerText = total.toLocaleString() + "đ";
}

// --- GIỎ HÀNG CHI TIẾT ---
function openCartDetails() {
    const list = document.getElementById('cart-items-list');
    list.innerHTML = "";
    
    // 1. Món ĐÃ GỌI (Lịch sử từ Firebase)
    const history = dbOrders.filter(o => o.table == currentTable).sort((a,b) => b.timestamp - a.timestamp);
    
    if (history.length > 0) {
        list.innerHTML += `<div class="mb-2 fw-bold text-muted small">LỊCH SỬ GỌI MÓN</div>`;
        history.forEach(batch => {
            const time = new Date(batch.timestamp).toLocaleTimeString();
            batch.items.forEach(i => {
                const noteHtml = i.note ? `<div class="text-primary small"><i class="fas fa-pen"></i> ${i.note}</div>` : '';
                list.innerHTML += `
                    <div class="cart-item-row" style="border-left: 4px solid #198754;">
                        <span class="status-badge status-sent">Đã gọi ${time}</span>
                        <div class="d-flex justify-content-between">
                            <div><b>${i.name} (${i.size})</b> <br> <small>${i.price.toLocaleString()}đ</small></div>
                            <div class="fw-bold">x${i.qty}</div>
                        </div>
                        ${noteHtml}
                    </div>`;
            });
        });
    }

    // 2. Món ĐANG CHỌN (Local Cart)
    const drafts = Object.entries(cart);
    if (drafts.length > 0) {
        list.innerHTML += `<div class="mb-2 fw-bold text-muted small mt-3">MÓN ĐANG CHỌN (Chưa gửi)</div>`;
        drafts.forEach(([key, order]) => {
            list.innerHTML += `
                <div class="cart-item-row" style="border-left: 4px solid #ffc107;">
                    <span class="status-badge status-draft">Chưa gửi</span>
                    <div class="d-flex justify-content-between">
                        <div><b>${order.item.TenMon} (${order.size})</b> <br> <small>${order.price.toLocaleString()}đ</small></div>
                        <div class="qty-control">
                            <button onclick="removeDraft('${key}')" class="qty-btn">-</button>
                            <span class="qty-num">${order.qty}</span>
                            <button onclick="addDraft('${key}')" class="qty-btn">+</button>
                        </div>
                    </div>
                    <input type="text" class="note-input" placeholder="Thêm ghi chú..." value="${order.note}" onchange="updateDraftNote('${key}', this.value)">
                </div>`;
        });
    }

    if (drafts.length === 0 && history.length === 0) {
        list.innerHTML = "<p class='text-center text-muted mt-5'>Giỏ hàng trống</p>";
    }

    // Cập nhật trạng thái nút
    const hasDraft = drafts.length > 0;
    const hasHistory = history.length > 0;
    
    document.getElementById('btn-order').disabled = !hasDraft; // Chỉ gửi được nếu có món mới
    document.getElementById('btn-pay').disabled = !hasHistory; // Chỉ thanh toán được nếu đã có đơn cũ
    
    document.getElementById('cart-modal').classList.remove('hidden');
}

function removeDraft(key) { delete cart[key]; renderMenu(); updateBottomBar(); openCartDetails(); }
function addDraft(key) { 
    // Clone ra item mới thay vì tăng qty để giữ logic tách dòng nếu cần, 
    // nhưng ở đây khách muốn tăng số lượng, ta tạo 1 key mới tương tự
    const old = cart[key];
    addToCart(old.item.id); 
    openCartDetails();
}
function updateDraftNote(key, val) { if(cart[key]) cart[key].note = val; }

function submitOrder() {
    if(confirm("Gửi món xuống bếp?")) {
        const items = Object.values(cart).map(c => ({
            name: c.item.TenMon, size: c.size, qty: c.qty, price: c.price, note: c.note
        }));
        let total = 0; items.forEach(i => total += i.price * i.qty);
        
        // Gửi lên Firebase
        sendOrderToDB(currentTable, items, 0, total);
        
        cart = {}; // Xóa draft
        alert("Gọi món thành công!");
        renderMenu(); updateBottomBar(); openCartDetails(); // Refresh để thấy nó chuyển xuống phần lịch sử
    }
}

// --- HÓA ĐƠN & QR ---
function requestBill() {
    const billHtml = generateBillHtml(currentTable);
    document.getElementById('bill-content').innerHTML = billHtml;
    // Ẩn nút thu ngân
    document.getElementById('cashier-actions').classList.add('hidden');
    document.getElementById('bill-modal').classList.remove('hidden');
}

function generateBillHtml(tId) {
    const orders = dbOrders.filter(o => o.table == tId);
    let totalAll = 0;
    let itemsHtml = "";
    
    // Gộp các món giống nhau để in bill cho gọn (hoặc liệt kê hết tùy ý)
    orders.forEach(batch => {
        batch.items.forEach(i => {
            const sub = i.price * i.qty;
            totalAll += sub;
            itemsHtml += `
                <div class="bill-row">
                    <div style="flex:2"><b>${i.name}</b> (${i.size})</div>
                    <div style="flex:1; text-align:center">x${i.qty}</div>
                    <div style="flex:1; text-align:right">${sub.toLocaleString()}</div>
                </div>`;
        });
    });

    const qrLink = `${BANK_QR_BASE}?addInfo=Ban ${tId}`;

    return `
        <div class="bill-container text-dark">
            <div class="text-center">
                <h4 class="fw-bold m-0">NACA Coffee & Tea</h4>
                <small>ĐC: Thôn 9, Cao Nhân, Thủy Nguyên, HP</small><br>
                <small>ĐT: 0349.315.099</small>
            </div>
            <div class="dashed-line"></div>
            <div class="d-flex justify-content-between fw-bold">
                <span>Bàn: ${tId}</span>
                <span>Giờ: ${new Date().toLocaleTimeString('en-US', {hour12:false})}</span>
            </div>
            <div class="dashed-line"></div>
            ${itemsHtml}
            <div class="dashed-line"></div>
            <div class="d-flex justify-content-between fs-5 fw-bold">
                <span>TỔNG CỘNG:</span>
                <span>${totalAll.toLocaleString()} đ</span>
            </div>
            <div class="text-center mt-3">
                <img src="${qrLink}" style="width:150px; height:150px">
                <div class="small fw-bold mt-1">Quét mã để thanh toán</div>
                <div class="small text-muted">Nội dung: Ban ${tId}</div>
            </div>
            <div class="text-center mt-3 fst-italic small">Cảm ơn quý khách và hẹn gặp lại!</div>
        </div>
    `;
}

function downloadBill() {
    html2canvas(document.getElementById('bill-content')).then(canvas => {
        const link = document.createElement('a');
        link.download = `HoaDon_Ban${currentTable}.png`;
        link.href = canvas.toDataURL();
        link.click();
    });
}

/* ==================== 2. LOGIC BẾP ==================== */

function initKitchenView(orders) {
    const list = document.getElementById('kitchen-orders');
    if(!list) return;
    list.innerHTML = "";
    
    // Chỉ lấy đơn Mới hoặc Đang làm
    const active = orders.filter(o => o.status === 'moi' || o.status === 'dang_lam');
    
    if(active.length === 0) {
        list.innerHTML = "<p class='text-center text-white mt-5 opacity-50'>Hiện chưa có đơn nào...</p>";
        return;
    }

    active.forEach(o => {
        const itemsHtml = o.items.map(i => {
            const note = i.note ? `<div class="text-info small"><i class="fas fa-pen"></i> ${i.note}</div>` : '';
            return `<div class="border-bottom border-secondary py-1">${i.name} (${i.size}) x${i.qty} ${note}</div>`;
        }).join('');
        
        let btn = o.status==='moi' 
            ? `<button class="btn btn-warning w-100 fw-bold" onclick="updateOrderStatus('${o.key}','dang_lam')">NHẬN ĐƠN</button>`
            : `<button class="btn btn-success w-100 fw-bold" onclick="updateOrderStatus('${o.key}','xong')">PHỤC VỤ XONG</button>`;
        
        const div = document.createElement('div'); 
        div.className = "card-kitchen";
        div.innerHTML = `
            <div class="d-flex justify-content-between text-warning border-bottom border-secondary pb-2 mb-2">
                <h4 class="m-0">BÀN ${o.table}</h4>
                <span>${new Date(o.timestamp).toLocaleTimeString()}</span>
            </div>
            <div class="mb-3">${itemsHtml}</div>
            ${btn}
        `;
        list.appendChild(div);
    });
}

/* ==================== 3. LOGIC THU NGÂN ==================== */

function initCashierView(orders) {
    const grid = document.getElementById('table-grid');
    if(!grid) return;
    grid.innerHTML = "";

    // Gom nhóm các bàn đang hoạt động (có đơn chưa xóa)
    const tables = [...new Set(orders.map(o => o.table))];

    if(tables.length === 0) {
        grid.innerHTML = "<p class='text-center text-muted w-100'>Chưa có bàn nào hoạt động</p>";
        return;
    }

    tables.forEach(t => {
        const col = document.createElement('div');
        col.className = "col-4 col-md-3";
        col.innerHTML = `
            <div class="table-btn active" onclick="openCashierBill('${t}')">
                <h4 class="m-0 fw-bold">${t}</h4>
                <small class="text-success">Đang phục vụ</small>
            </div>`;
        grid.appendChild(col);
    });
}

function openCashierBill(tId) {
    currentTableForCashier = tId; // Lưu bàn đang chọn
    const html = generateBillHtml(tId);
    document.getElementById('bill-content').innerHTML = html;
    
    // Hiện nút hành động cho thu ngân
    document.getElementById('cashier-actions').classList.remove('hidden');
    document.getElementById('bill-modal').classList.remove('hidden');
}

function cashierAction(action) {
    if(!currentTableForCashier) return;
    
    let msg = "";
    if(action === 'kiotviet') msg = "Xác nhận đã nhập KiotViet và xóa bàn này?";
    if(action === 'paid') msg = "Xác nhận đã Thanh toán và xóa bàn này?";

    if(confirm(msg)) {
        // Tìm tất cả order của bàn này và xóa
        const ordersToDelete = dbOrders.filter(o => o.table == currentTableForCashier);
        ordersToDelete.forEach(o => deleteOrder(o.key));
        
        document.getElementById('bill-modal').classList.add('hidden');
        alert("Đã hoàn thành bàn: " + currentTableForCashier);
    }
}

// Upload Excel
function handleFileUpload(e) {
    const file = e.target.files[0];
    if(!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, {type: 'array'});
        const sheetName = workbook.SheetNames[0];
        const json = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
        const cleanData = json.map(item => ({
            id: item.ID, TenMon: item.TenMon, MoTa: item.MoTa || "", PhanLoai: item.PhanLoai || "TP",
            img: item.HinhAnh || "https://via.placeholder.com/100", hasMultiSize: !!item.Co2Size, 
            GiaM: item.GiaM || 0, VonM: item.VonM || 0, GiaL: item.GiaL || 0, VonL: item.VonL || 0
        }));
        if(confirm(`Cập nhật ${cleanData.length} món?`)) saveMenuToDB(cleanData);
    };
    reader.readAsArrayBuffer(file);
}

// --- EXPOSE TO WINDOW ---
window.addToCart = addToCart;
window.removeRecentItem = removeRecentItem;
window.openMultiSizeModal = openMultiSizeModal;
window.closeModal = () => document.getElementById('size-modal').classList.add('hidden');
window.updateModalQty = updateModalQty;
window.openCartDetails = openCartDetails;
window.closeCartDetails = () => document.getElementById('cart-modal').classList.add('hidden');
window.removeDraft = removeDraft;
window.addDraft = addDraft;
window.updateDraftNote = updateDraftNote;
window.submitOrder = submitOrder;
window.requestBill = requestBill;
window.downloadBill = downloadBill;
window.updateOrderStatus = updateOrderStatus;
window.openCashierBill = openCashierBill;
window.cashierAction = cashierAction;
window.handleFileUpload = handleFileUpload;