import { saveMenuToDB, listenForMenu, sendOrderToDB, listenForOrders, updateOrderStatus, deleteOrder } from './firebase-service.js';

// --- CẤU HÌNH ---
const BANK_QR_URL = "https://img.vietqr.io/image/MB-0349315099-compact.png"; // Thay link ảnh QR của bạn

// --- BIẾN TOÀN CỤC ---
let MENU_DATA = [];
let cart = {}; // Cart local: { "uniqueKey": { item:..., qty:1, ... } }
let dbOrders = []; 
let currentTable = "Mang Về";
let currentCategory = "ALL";
let currentSearch = "";

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
        // Nếu đang mở giỏ hàng thì update lại để thấy trạng thái đơn cũ
        if (!view && !document.getElementById('cart-modal').classList.contains('hidden')) {
            openCartDetails();
        }
        // Update lại thanh bottom bar để hiển thị đúng tổng tiền (bao gồm đơn cũ nếu muốn)
        if(!view) updateBottomBar();
    });

    if (!view) initCustomerView();
    if (view === 'bep') document.getElementById('view-kitchen').classList.remove('hidden');
    if (view === 'thungan') document.getElementById('view-cashier').classList.remove('hidden');

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
        // 1. Tính tổng số lượng món này đang có trong giỏ (Local Cart)
        // Vì cart lưu theo uniqueKey, ta phải lặp qua để cộng dồn
        let currentQty = 0;
        Object.values(cart).forEach(order => {
            if (order.item.id === item.id && order.size === 'M') { // Mặc định tính size M cho nút ngoài
                currentQty += order.qty;
            }
        });

        // 2. Xác định giao diện nút bấm
        let btnHtml = "";
        
        if (item.hasMultiSize) {
            // Món 2 Size: Luôn hiện nút "Thêm" (hoặc "Chọn size")
            btnHtml = `<button class="btn-add-cart" onclick="openMultiSizeModal(${item.id})">Thêm</button>`;
        } else {
            // Món 1 Size: Logic chuyển đổi nút
            if (currentQty === 0) {
                // Chưa có: Hiện nút Thêm
                btnHtml = `<button class="btn-add-cart" onclick="addToCart(${item.id})">Thêm</button>`;
            } else {
                // Đã có: Hiện bộ đếm +/-
                btnHtml = `
                    <div class="qty-control-inline">
                        <button onclick="removeRecentItem(${item.id})">-</button>
                        <span>${currentQty}</span>
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
            </div>
        `;
        container.appendChild(div);
    });
    updateBottomBar();
}

// --- HÀM THÊM VÀO GIỎ (Tạo dòng mới) ---
window.addToCart = function(id) {
    const item = MENU_DATA.find(i => i.id == id);
    // Tạo ID duy nhất để tách dòng (cho phép chọn topping riêng sau này)
    const uniqueKey = `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    cart[uniqueKey] = { 
        item: item, 
        size: 'M', 
        qty: 1, 
        price: item.GiaM, 
        note: '', 
        toppings: [], 
        timestamp: Date.now() 
    };
    
    // Vẽ lại menu để cập nhật số lượng nút bấm
    renderMenu();
    updateBottomBar();
}

// --- HÀM GIẢM SỐ LƯỢNG (Xóa dòng mới nhất của món đó) ---
window.removeRecentItem = function(itemId) {
    // Tìm các key trong giỏ hàng khớp với itemId này
    const keys = Object.keys(cart).filter(k => cart[k].item.id === itemId && cart[k].size === 'M');
    
    if (keys.length > 0) {
        // Sắp xếp để lấy cái mới nhất (dựa vào timestamp hoặc thứ tự key)
        // Ở đây lấy cái cuối cùng tìm thấy
        const keyToRemove = keys[keys.length - 1];
        delete cart[keyToRemove];
    }
    
    renderMenu();
    updateBottomBar();
}

// --- LOGIC POPUP SIZE ---
window.openMultiSizeModal = function(id) {
    const item = MENU_DATA.find(i => i.id == id);
    document.getElementById('modal-title').innerText = item.TenMon;
    document.getElementById('modal-desc').innerText = item.MoTa;
    document.getElementById('modal-img').src = item.img;
    document.getElementById('qty-M').innerText = "0"; // Reset visual
    document.getElementById('qty-L').innerText = "0"; // Reset visual
    window.currentItemForModal = item;
    document.getElementById('size-modal').classList.remove('hidden');
}

window.updateModalQty = function(size, delta) {
    if (delta > 0 && window.currentItemForModal) {
        const item = window.currentItemForModal;
        const price = size === 'M' ? item.GiaM : item.GiaL;
        const uniqueKey = `local_${Date.now()}_${Math.random()}`;
        
        cart[uniqueKey] = {
            item: item, size: size, qty: 1, price: price, note: '', toppings: [],
            timestamp: Date.now()
        };
        updateBottomBar();
        alert(`Đã thêm 1 ${item.TenMon} (${size})`);
    }
}

// --- CẬP NHẬT THANH BOTTOM ---
function updateBottomBar() {
    let count = 0; let total = 0;

    // 1. Tính từ Giỏ hàng Local (Chưa gửi)
    Object.values(cart).forEach(order => {
        count += order.qty;
        total += (order.price * order.qty);
        order.toppings.forEach(tp => total += tp.price);
    });

    // 2. Tính từ Đơn đã gọi (DB) - Nếu bạn muốn hiện tổng tiền cả bữa ăn
    const myTableOrders = dbOrders.filter(o => o.table == currentTable && o.status !== 'split_paid');
    myTableOrders.forEach(o => {
        o.items.forEach(i => {
            count += i.qty;
            total += (i.price * i.qty);
            if(i.toppings) i.toppings.forEach(t => total += t.price);
        });
    });

    document.getElementById('total-count').innerText = count;
    document.getElementById('total-price').innerText = total.toLocaleString() + "đ";
}

// --- LOGIC CHI TIẾT GIỎ HÀNG ---
window.openCartDetails = function() {
    const list = document.getElementById('cart-items-list');
    list.innerHTML = "";
    
    // 1. Món ĐÃ GỌI (Lịch sử)
    const historyOrders = dbOrders.filter(o => o.table == currentTable).sort((a,b) => b.timestamp - a.timestamp);
    historyOrders.forEach(batch => {
        if (batch.status === 'split_paid') return; 
        const timeStr = new Date(batch.timestamp).toLocaleTimeString();
        
        list.innerHTML += `<div class="time-divider">Giờ gọi: ${timeStr} <span class="badge-status bg-ordered">Đã gọi</span></div>`;
        
        batch.items.forEach(item => {
            const topStr = item.toppings ? item.toppings.map(t => `<span class="topping-tag">${t.name}</span>`).join('') : '';
            list.innerHTML += `
                <div class="cart-item-row" style="background:#f8f9fa; border-left: 3px solid #198754;">
                    <div class="d-flex justify-content-between">
                        <div><b>${item.name} (${item.size})</b> <br> <small>${item.price.toLocaleString()}đ</small></div>
                        <div class="fw-bold">x${item.qty}</div>
                    </div>
                    <div class="text-muted small"><i>${item.note || ''}</i></div>
                    <div>${topStr}</div>
                </div>`;
        });
    });

    // 2. Món CHƯA GỌI (Local Cart)
    if (Object.keys(cart).length > 0) {
        list.innerHTML += `<div class="time-divider">Hiện tại <span class="badge-status bg-draft">Chưa gọi</span></div>`;
        
        Object.entries(cart).forEach(([key, order]) => {
            const topHtml = order.toppings.map(tp => 
                `<span class="topping-tag">${tp.name} <i class="fas fa-times text-danger" onclick="removeTopping('${key}', ${tp.id})"></i></span>`
            ).join('');

            list.innerHTML += `
                <div class="cart-item-row">
                    <div class="d-flex justify-content-between mb-2">
                        <div><b>${order.item.TenMon} (${order.size})</b> <br> <small>${order.price.toLocaleString()}đ</small></div>
                        <div class="qty-control-inline">
                            <button onclick="changeCartQty('${key}', -1)">-</button><span>${order.qty}</span><button onclick="changeCartQty('${key}', 1)">+</button>
                        </div>
                    </div>
                    <input type="text" class="note-input" placeholder="Ghi chú..." value="${order.note}" onchange="updateNote('${key}', this.value)">
                    <div class="mt-1">${topHtml}</div>
                    <div class="text-end mt-2">
                        <button class="btn btn-sm btn-outline-primary p-0 px-2" style="font-size:10px" onclick="showToppingSelector('${key}')">+ Topping</button>
                    </div>
                </div>`;
        });
    }

    // Nút footer
    const hasLocal = Object.keys(cart).length > 0;
    const hasHistory = historyOrders.length > 0;
    document.getElementById('btn-send-order').disabled = !hasLocal;
    
    // Logic nút thanh toán: Chỉ sáng khi KHÔNG còn món nào chưa gửi (đã gửi hết) VÀ có lịch sử
    const canPay = !hasLocal && hasHistory;
    ['btn-bill', 'btn-split', 'btn-pay'].forEach(id => {
        const btn = document.getElementById(id);
        btn.disabled = !canPay;
        if(canPay) {
            btn.classList.remove('disabled-action', 'btn-outline-secondary');
            btn.classList.add('btn-primary');
        } else {
            btn.classList.add('disabled-action', 'btn-outline-secondary');
            btn.classList.remove('btn-primary');
        }
    });

    document.getElementById('cart-modal').classList.remove('hidden');
}

window.closeCartDetails = function() { document.getElementById('cart-modal').classList.add('hidden'); }

window.changeCartQty = function(key, delta) {
    if (cart[key]) {
        cart[key].qty += delta;
        if (cart[key].qty <= 0) delete cart[key];
        renderMenu(); // Cập nhật lại nút bên ngoài
        updateBottomBar();
        openCartDetails();
    }
}
window.updateNote = function(key, val) { if(cart[key]) cart[key].note = val; }
window.removeTopping = function(key, tpId) {
    cart[key].toppings = cart[key].toppings.filter(t => t.id !== tpId);
    updateBottomBar(); openCartDetails();
}

window.showToppingSelector = function(key) {
    const tps = MENU_DATA.filter(i => i.PhanLoai === 'TP');
    const html = tps.map(t => `<li class="list-group-item d-flex justify-content-between" onclick="selectTopping('${key}',${t.id})"><span>${t.TenMon}</span> <b>+${t.GiaM}</b></li>`).join('');
    document.getElementById('cart-items-list').innerHTML = `<div class="bg-white p-3 rounded"><h5>Chọn Topping</h5><ul class="list-group">${html}</ul><button class="btn btn-secondary w-100 mt-2" onclick="openCartDetails()">Quay lại</button></div>`;
}
window.selectTopping = function(key, tId) {
    const t = MENU_DATA.find(i => i.id == tId);
    cart[key].toppings.push({ id: t.id, name: t.TenMon, price: t.GiaM });
    updateBottomBar(); openCartDetails();
}

window.submitOrder = function() {
    if(confirm("Gửi món xuống bếp?")) {
        const items = Object.values(cart).map(c => ({
            name: c.item.TenMon, size: c.size, qty: c.qty, price: c.price,
            note: c.note, toppings: c.toppings
        }));
        
        let total = 0; items.forEach(i => { total += (i.price * i.qty); if(i.toppings) i.toppings.forEach(t => total += t.price); });
        
        // Gửi status = 'moi'
        sendOrderToDB(currentTable, items, 0, total);
        
        cart = {}; 
        alert("Gọi món thành công!");
        renderMenu(); // Reset nút
        updateBottomBar();
        openCartDetails(); // Refresh modal
    }
}

// --- LOGIC SPLIT BILL ---
let splitSelectedItems = []; 
window.openSplitBillModal = function() {
    const list = document.getElementById('split-items-list');
    list.innerHTML = "";
    splitSelectedItems = [];
    const orders = dbOrders.filter(o => o.table == currentTable && o.status !== 'split_paid');
    
    let index = 0;
    orders.forEach(batch => {
        batch.items.forEach(item => {
            const itemTotal = (item.price * item.qty) + (item.toppings ? item.toppings.reduce((a,b)=>a+b.price,0) : 0);
            const splitId = `${batch.key}_${index}`;
            list.innerHTML += `
                <div class="d-flex justify-content-between align-items-center border-bottom py-2">
                    <div>
                        <input type="checkbox" class="form-check-input me-2" id="chk_${splitId}" 
                               onchange="toggleSplitItem('${splitId}', ${itemTotal}, '${item.name}', '${batch.key}')">
                        <label for="chk_${splitId}"><b>${item.name}</b> (${item.size}) x${item.qty}</label>
                    </div>
                    <span>${itemTotal.toLocaleString()}đ</span>
                </div>`;
            index++;
        });
    });
    document.getElementById('split-total').innerText = "0đ";
    document.getElementById('split-modal').classList.remove('hidden');
}

window.toggleSplitItem = function(id, price, name, batchKey) {
    const chk = document.getElementById(`chk_${id}`);
    if(chk.checked) splitSelectedItems.push({ id, price, name, batchKey });
    else splitSelectedItems = splitSelectedItems.filter(i => i.id !== id);
    const total = splitSelectedItems.reduce((a,b) => a + b.price, 0);
    document.getElementById('split-total').innerText = total.toLocaleString() + "đ";
}

window.proceedSplitPayment = function() {
    if(splitSelectedItems.length === 0) { alert("Chưa chọn món nào!"); return; }
    const total = splitSelectedItems.reduce((a,b) => a + b.price, 0);
    document.getElementById('pay-amount').innerText = total.toLocaleString() + "đ";
    document.getElementById('payment-method-modal').classList.remove('hidden');
    document.getElementById('split-modal').classList.add('hidden');
    document.getElementById('qr-display').classList.add('hidden');
    document.getElementById('cash-display').classList.add('hidden');
}

window.showQR = function() {
    document.getElementById('qr-display').classList.remove('hidden');
    document.getElementById('cash-display').classList.add('hidden');
    document.getElementById('qr-img').src = BANK_QR_URL;
    document.getElementById('qr-desc').innerText = `ND: Bàn ${currentTable}`;
}
window.showCashInstruction = function() {
    document.getElementById('qr-display').classList.add('hidden');
    document.getElementById('cash-display').classList.remove('hidden');
}

window.confirmTransfer = function() {
    if(confirm("Xác nhận đã chuyển khoản?")) {
        const total = splitSelectedItems.reduce((a,b) => a + b.price, 0);
        // Gửi request đặc biệt
        const reqData = {
            table: currentTable,
            items: [{ name: "Yêu cầu TT Riêng ("+splitSelectedItems.length+" món)", size: "", qty: 1, price: total }],
            totalPrice: total,
            status: 'payment_request', // Cờ hiệu
            timestamp: Date.now()
        };
        // Dùng trick: Gửi qua kênh orders nhưng status khác
        // Cần đảm bảo firebase-service export hàm push hoặc dùng sendOrderToDB với tham số tùy chỉnh
        // Ở đây ta dùng hàm sendOrderToDB và sửa status sau hoặc thêm status vào param hàm đó
        // Cách nhanh nhất: Gọi sendOrderToDB nhưng ghi đè logic ở server hoặc...
        // Tốt nhất: Gọi hàm push trực tiếp từ firebase-service nếu đã export.
        // Giả sử sendOrderToDB nhận tham số status thì tốt, nhưng hàm cũ fix cứng 'moi'.
        // Ta dùng cách: sendOrderToDB bình thường, tên món đặc biệt.
        sendOrderToDB(currentTable, reqData.items, 0, total);
        
        alert("Đã gửi yêu cầu. Vui lòng đợi thu ngân.");
        document.getElementById('payment-method-modal').classList.add('hidden');
    }
}
window.closePaymentModal = function() { document.getElementById('payment-method-modal').classList.add('hidden'); }

// --- BILL ---
window.requestBill = function() {
    const html = generateBillHtml(currentTable);
    document.getElementById('bill-content').innerHTML = html;
    document.getElementById('bill-modal').classList.remove('hidden');
}
function generateBillHtml(tId) {
    const orders = dbOrders.filter(o => o.table == tId);
    let html = `<div class="text-center fw-bold">HÓA ĐƠN TẠM TÍNH<br>Bàn ${tId}</div><hr>`;
    let total = 0;
    orders.forEach(batch => {
        if(batch.items[0]?.name.includes("Yêu cầu TT")) return; // Ẩn các request thanh toán
        batch.items.forEach(i => {
            const iTotal = (i.price*i.qty) + (i.toppings?i.toppings.reduce((a,b)=>a+b.price,0):0);
            total += iTotal;
            const top = i.toppings?.length ? `<br><small>+${i.toppings.map(t=>t.name)}</small>` : '';
            html += `<div class="d-flex justify-content-between mb-1"><span>${i.name} (${i.size}) x${i.qty} ${top}</span><span>${iTotal.toLocaleString()}</span></div>`;
        });
    });
    html += `<hr><div class="d-flex justify-content-between fw-bold"><span>TỔNG:</span><span>${total.toLocaleString()}đ</span></div>`;
    html += `<div class="text-center mt-3"><img src="${BANK_QR_URL}" style="width:100px"><br><small>Quét mã thanh toán</small></div>`;
    return html;
}
window.downloadBill = function() {
    html2canvas(document.getElementById('bill-content')).then(c => {
        const link = document.createElement('a'); link.download="Bill.png"; link.href=c.toDataURL(); link.click();
    });
}

// --- THU NGÂN ---
function initCashierView(orders) {
    const grid = document.getElementById('table-grid');
    grid.innerHTML = "";
    const tables = [...new Set(orders.map(o => o.table))];
    tables.forEach(t => {
        // Check có request thanh toán không (dựa vào tên món đặc biệt ta đã gửi)
        const hasReq = orders.some(o => o.table == t && o.items[0]?.name.includes("Yêu cầu TT"));
        const col = document.createElement('div'); col.className = "col-4 col-md-3";
        col.innerHTML = `<div class="table-btn active" onclick="showTableBill('${t}')"><h4>${t}</h4>${hasReq?'<div class="red-dot"></div>':''}</div>`;
        grid.appendChild(col);
    });
}
window.showTableBill = function(tId) {
    const html = generateBillHtml(tId);
    document.getElementById('bill-content').innerHTML = html;
    document.getElementById('bill-modal').classList.remove('hidden');
}

// --- BẾP ---
function initKitchenView(orders) {
    const list = document.getElementById('kitchen-orders');
    list.innerHTML = "";
    const active = orders.filter(o => o.status === 'moi' || o.status === 'dang_lam');
    active.forEach(o => {
        if(o.items[0]?.name.includes("Yêu cầu TT")) return; // Bếp không hiện đơn thanh toán
        const itemsHtml = o.items.map(i => {
            const note = i.note ? `<div class="text-info small"><i class="fas fa-pen"></i> ${i.note}</div>` : '';
            return `<div class="border-bottom border-secondary py-1">${i.name} (${i.size}) x${i.qty} ${note}</div>`;
        }).join('');
        let btn = o.status==='moi' 
            ? `<button class="btn btn-warning w-100 fw-bold" onclick="updateOrderStatus('${o.key}','dang_lam')">NHẬN ĐƠN</button>`
            : `<button class="btn btn-success w-100 fw-bold" onclick="updateOrderStatus('${o.key}','xong')">PHỤC VỤ XONG</button>`;
        const div = document.createElement('div'); div.className = "card-kitchen p-3 shadow";
        div.innerHTML = `<div class="d-flex justify-content-between text-warning"><h4>BÀN ${o.table}</h4><span>${new Date(o.timestamp).toLocaleTimeString()}</span></div><div class="mb-3">${itemsHtml}</div>${btn}`;
        list.appendChild(div);
    });
}