import { saveMenuToDB, listenForMenu, sendOrderToDB, listenForOrders, updateOrderStatus, deleteOrder } from './firebase-service.js';

// --- CẤU HÌNH ---
// Thay link ảnh QR của bạn vào đây (Ví dụ VietQR: BankID-AccountNo-Template.png)
const BANK_QR_URL = "https://img.vietqr.io/image/MB-0349315099-compact.png"; 

// --- BIẾN TOÀN CỤC ---
let MENU_DATA = [];
let cart = {}; // Giỏ hàng (Món chưa gửi - Draft)
let dbOrders = []; // Món đã gửi (History)
let currentTable = "Mang Về";
let currentCategory = "ALL";
let currentSearch = "";
let currentItemForModal = null;
let currentCashierTable = null; // Bàn thu ngân đang xem

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
        if (!view && !document.getElementById('cart-modal').classList.contains('hidden')) {
            openCartDetails(); // Refresh modal nếu đang mở
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
        // Tính tổng số lượng món này (cả Đã Gọi và Đang Chọn)
        let totalQty = 0;
        // 1. Từ Cart (Draft)
        Object.values(cart).forEach(o => { if (o.item.id === item.id && o.size === 'M') totalQty += o.qty; });
        // 2. Từ DB (Sent)
        const sentOrders = dbOrders.filter(o => o.table == currentTable);
        sentOrders.forEach(batch => {
            batch.items.forEach(i => { if (i.name === item.TenMon && i.size === 'M') totalQty += i.qty; });
        });

        let btnHtml = "";
        if (item.hasMultiSize) {
            btnHtml = `<button class="btn-add-cart" onclick="openMultiSizeModal(${item.id})">Thêm</button>`;
        } else {
            if (totalQty === 0) {
                btnHtml = `<button class="btn-add-cart" onclick="addToCart(${item.id})">Thêm</button>`;
            } else {
                // Nếu đã có, hiện +/-. Logic +/- ở đây chỉ tác động vào Cart (Draft)
                // Nếu muốn +/- cả món đã gọi thì rất phức tạp, nên ta chỉ cho phép thêm mới vào Cart
                btnHtml = `
                    <div class="qty-control-inline">
                        <button onclick="removeDraftItem(${item.id})">-</button>
                        <span>${totalQty}</span>
                        <button onclick="addToCart(${item.id})">+</button>
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
        item: item, size: 'M', qty: 1, price: item.GiaM, note: '', timestamp: Date.now() 
    };
    renderMenu(); updateBottomBar();
}

function removeDraftItem(itemId) {
    // Chỉ xóa được món trong Cart (Draft), không xóa được món Đã Gọi (DB)
    const keys = Object.keys(cart).filter(k => cart[k].item.id === itemId && cart[k].size === 'M');
    if (keys.length > 0) {
        delete cart[keys[keys.length - 1]];
        renderMenu(); updateBottomBar();
    } else {
        alert("Món đã gửi xuống bếp không thể giảm tại đây. Vui lòng liên hệ nhân viên.");
    }
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

function closeModal() { document.getElementById('size-modal').classList.add('hidden'); }

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
    
    // 1. Tính Draft
    Object.values(cart).forEach(o => { count += o.qty; total += o.price * o.qty; });
    
    // 2. Tính History (DB)
    const sentOrders = dbOrders.filter(o => o.table == currentTable);
    sentOrders.forEach(o => {
        o.items.forEach(i => { count += i.qty; total += i.price * i.qty; });
    });

    document.getElementById('total-count').innerText = count;
    document.getElementById('total-price').innerText = total.toLocaleString() + "đ";
}

// --- GIỎ HÀNG CHI TIẾT ---
function openCartDetails() {
    const list = document.getElementById('cart-items-list');
    list.innerHTML = "";
    
    // 1. LIST ĐÃ GỌI (Từ DB)
    const sentOrders = dbOrders.filter(o => o.table == currentTable).sort((a,b) => b.timestamp - a.timestamp);
    if(sentOrders.length > 0) {
        list.innerHTML += `<div class="mb-2 text-success fw-bold small"><i class="fas fa-check-circle"></i> MÓN ĐÃ GỌI (Bếp đang làm)</div>`;
        sentOrders.forEach(batch => {
            const time = new Date(batch.timestamp).toLocaleTimeString().slice(0,5);
            batch.items.forEach(i => {
                const note = i.note ? `<div class="text-muted small"><i>Note: ${i.note}</i></div>` : '';
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

    // 2. LIST ĐANG CHỌN (Từ Cart)
    const drafts = Object.entries(cart);
    if(drafts.length > 0) {
        list.innerHTML += `<div class="mt-3 mb-2 text-warning fw-bold small"><i class="fas fa-pen"></i> MÓN ĐANG CHỌN (Chưa gửi)</div>`;
        drafts.forEach(([key, order]) => {
            list.innerHTML += `
                <div class="cart-item-row" style="border-left: 4px solid #ffc107;">
                    <span class="status-badge badge-draft">Mới</span>
                    <div class="d-flex justify-content-between">
                        <div><b>${order.item.TenMon} (${order.size})</b> <br> <small>${order.price.toLocaleString()}đ</small></div>
                        <div class="qty-control-inline" style="background:#eee">
                            <button onclick="deleteDraft('${key}')">-</button><span>${order.qty}</span><button onclick="addDraft('${key}')">+</button>
                        </div>
                    </div>
                    <input type="text" class="note-input" placeholder="Ghi chú cho bếp..." value="${order.note}" onchange="updateNote('${key}', this.value)">
                </div>`;
        });
    }

    // Update nút
    const hasDraft = drafts.length > 0;
    const hasSent = sentOrders.length > 0;
    
    document.getElementById('btn-order').disabled = !hasDraft;
    document.getElementById('btn-pay').disabled = !hasSent; // Chỉ thanh toán khi đã gọi món

    document.getElementById('cart-modal').classList.remove('hidden');
}

function deleteDraft(key) { delete cart[key]; updateBottomBar(); openCartDetails(); renderMenu(); }
function addDraft(key) { 
    // Clone item
    const old = cart[key];
    addToCart(old.item.id); 
    openCartDetails();
}
function updateNote(key, val) { if(cart[key]) cart[key].note = val; }
function closeCartDetails() { document.getElementById('cart-modal').classList.add('hidden'); }

// GỌI MÓN
function submitOrder() {
    if(Object.keys(cart).length === 0) return;
    if(confirm("Gửi món xuống bếp?")) {
        const items = Object.values(cart).map(c => ({
            name: c.item.TenMon, size: c.size, qty: c.qty, price: c.price, note: c.note
        }));
        let total = 0; items.forEach(i => total += i.price * i.qty);
        
        // Gửi status = 'moi'
        sendOrderToDB(currentTable, items, 0, total);
        
        cart = {}; // Xóa draft
        alert("Gọi món thành công! Bếp đã nhận đơn.");
        renderMenu(); updateBottomBar(); openCartDetails();
    }
}

// THANH TOÁN (BILL)
function requestBill() {
    // Ẩn nút của thu ngân
    document.getElementById('btn-download-bill').classList.remove('hidden');
    document.getElementById('cashier-actions').classList.add('hidden');

    const html = generateBillHtml(currentTable);
    document.getElementById('bill-content').innerHTML = html;
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

function downloadBill() {
    html2canvas(document.getElementById('bill-content')).then(canvas => {
        const link = document.createElement('a');
        link.download = `HoaDon_Ban${currentTable}.png`;
        link.href = canvas.toDataURL();
        link.click();
    });
}

/* ==================== 2. LOGIC BẾP (SỬA LỖI TRẠNG THÁI) ==================== */

function initKitchenView(orders) {
    const list = document.getElementById('kitchen-orders');
    if(!list) return;
    list.innerHTML = "";
    
    // Lọc đơn MỚI hoặc ĐANG LÀM
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
        
        let btn = "";
        // Logic 2 bước: Moi -> Dang lam -> Xong
        if(o.status === 'moi') {
            btn = `<button class="btn btn-warning w-100 fw-bold" onclick="updateOrderStatus('${o.key}','dang_lam')">NHẬN ĐƠN (ĐANG LÀM)</button>`;
        } else {
            btn = `<button class="btn btn-success w-100 fw-bold" onclick="updateOrderStatus('${o.key}','xong')">ĐÃ XONG (PHỤC VỤ)</button>`;
        }
        
        const div = document.createElement('div'); 
        div.className = "card-kitchen p-3 shadow mb-3 rounded bg-dark text-white";
        div.innerHTML = `
            <div class="d-flex justify-content-between text-warning border-bottom border-secondary pb-2 mb-2">
                <h4 class="m-0">BÀN ${o.table}</h4>
                <span>${new Date(o.timestamp).toLocaleTimeString().slice(0,5)}</span>
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

    // Tìm các bàn có đơn chưa chốt
    const tables = [...new Set(orders.map(o => o.table))];

    if(tables.length === 0) {
        grid.innerHTML = "<p class='text-center text-muted w-100'>Chưa có bàn nào hoạt động</p>";
        return;
    }

    tables.forEach(t => {
        const col = document.createElement('div');
        col.className = "col-4 col-md-3";
        col.innerHTML = `
            <div class="table-btn active p-3 text-center border rounded bg-white shadow-sm" onclick="openCashierBill('${t}')" style="cursor:pointer">
                <h4 class="m-0 fw-bold text-success">Bàn ${t}</h4>
                <small class="text-muted">Đang phục vụ</small>
            </div>`;
        grid.appendChild(col);
    });
}

function openCashierBill(tId) {
    currentCashierTable = tId;
    const html = generateBillHtml(tId);
    document.getElementById('bill-content').innerHTML = html;
    
    // Hiện nút hành động cho thu ngân, ẩn nút khách
    document.getElementById('btn-download-bill').classList.add('hidden');
    document.getElementById('cashier-actions').classList.remove('hidden');
    document.getElementById('bill-modal').classList.remove('hidden');
}

function finishTable(type) {
    if(!currentCashierTable) return;
    
    let confirmMsg = type === 'kv' ? "Xác nhận đã nhập vào KiotViet và kết thúc bàn?" : "Xác nhận đã Thanh toán và kết thúc bàn?";
    
    if(confirm(confirmMsg)) {
        // Tìm tất cả đơn của bàn này -> Xóa (Hoàn thành)
        const toDelete = dbOrders.filter(o => o.table == currentCashierTable);
        toDelete.forEach(o => deleteOrder(o.key));
        
        document.getElementById('bill-modal').classList.add('hidden');
        alert("Đã chốt bàn " + currentCashierTable);
    }
}

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

// EXPOSE GLOBAL
window.addToCart = addToCart;
window.removeDraftItem = removeDraftItem;
window.openMultiSizeModal = openMultiSizeModal;
window.closeModal = closeModal;
window.updateModalQty = updateModalQty;
window.openCartDetails = openCartDetails;
window.closeCartDetails = () => document.getElementById('cart-modal').classList.add('hidden');
window.deleteDraft = deleteDraft;
window.addDraft = addDraft;
window.updateNote = updateNote;
window.submitOrder = submitOrder;
window.requestBill = requestBill;
window.downloadBill = downloadBill;
window.updateOrderStatus = updateOrderStatus;
window.openCashierBill = openCashierBill;
window.finishTable = finishTable;
window.handleFileUpload = handleFileUpload;