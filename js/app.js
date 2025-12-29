import { saveMenuToDB, listenForMenu, sendOrderToDB, listenForOrders, updateOrderStatus, deleteOrder, push } from './firebase-service.js';
// (Giả sử bạn cần import thêm hàm push để gửi yêu cầu thanh toán riêng, tôi sẽ dùng sendOrderToDB biến thể hoặc bạn thêm hàm push vào firebase-service.js)
// Để đơn giản, tôi giả định firebase-service.js có export 'db' (database instance) hoặc tôi dùng logic sendOrderToDB để gửi requests.

// --- CẤU HÌNH ---
const BANK_QR_URL = "https://img.vietqr.io/image/MB-0349315099-compact.png"; // Thay link ảnh QR của bạn vào đây

// --- BIẾN TOÀN CỤC ---
let MENU_DATA = [];
let cart = {}; // Giỏ hàng cục bộ (Món MỚI chưa gọi)
let dbOrders = []; // Danh sách đơn hàng từ Firebase
let currentTable = "Mang Về";
let currentCategory = "ALL";
let currentSearch = "";
let paymentRequests = []; // Lưu các yêu cầu thanh toán riêng

const CATEGORIES = [
    { code: "ALL", name: "Tất cả" }, { code: "TS", name: "Trà sữa" },
    { code: "THQ", name: "Trà hoa quả" }, { code: "CF", name: "Cà phê" },
    { code: "TP", name: "Topping" }, { code: "AV", name: "Ăn vặt" }
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
        // Tách orders và payment_requests nếu chúng lưu chung node, hoặc giả định orders chứa tất cả
        // Ở đây tôi giả định orders chứa node 'orders' thông thường.
        // Cần logic để nghe thêm node 'payment_requests' nếu bạn tách riêng. 
        // Để đơn giản, tôi sẽ lọc payment requests từ list orders nếu bạn lưu chung, 
        // NHƯNG tốt nhất là dùng một node riêng.
        // Trong code này, tôi giả định dbOrders chứa mọi thứ liên quan bàn.
        dbOrders = orders;
        
        if (view === 'bep') initKitchenView(orders);
        if (view === 'thungan') initCashierView(orders);
        // Nếu đang mở giỏ hàng ở view khách, re-render để cập nhật trạng thái
        if (!view && !document.getElementById('cart-modal').classList.contains('hidden')) {
            openCartDetails();
        }
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
        // Logic nút bấm: 1 Size hiện +/- ngay, 2 Size hiện nút Thêm
        let btnHtml = "";
        if (item.hasMultiSize) {
            btnHtml = `<button class="btn-add-cart" onclick="openMultiSizeModal(${item.id})">Thêm</button>`;
        } else {
            // Check xem trong cart có chưa để hiện số
            // Lưu ý: cart dùng unique ID, nên việc check này chỉ mang tính tương đối cho món đơn giản
            // Để đơn giản hóa UI ngoài, với món 1 size ta dùng nút Thêm/Cộng trừ đơn giản
            btnHtml = `<div class="qty-control-inline">
                <button onclick="addToCart(${item.id}, -1)">-</button>
                <span>Add</span>
                <button onclick="addToCart(${item.id}, 1)">+</button>
            </div>`;
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

// Thêm vào giỏ (Local Cart) - KHÔNG GỘP MÓN (Tạo ID riêng)
window.addToCart = function(id, qty = 1) {
    // Nếu qty < 0 nghĩa là giảm, nhưng ở màn hình ngoài ta chỉ hỗ trợ Thêm mới.
    // Logic +/- ở màn hình ngoài cho món 1 size: Mỗi lần bấm + là thêm 1 dòng mới vào giỏ?
    // Yêu cầu: "không nhóm các cốc giống nhau... tách riêng".
    // Nên mỗi lần bấm + là tạo 1 item mới.
    if (qty < 0) return; // Màn hình ngoài không xóa được, phải vào giỏ xóa

    const item = MENU_DATA.find(i => i.id == id);
    const uniqueKey = `local_${Date.now()}_${Math.random()}`; // ID duy nhất
    
    cart[uniqueKey] = { 
        item: item, size: 'M', qty: 1, price: item.GiaM, note: '', toppings: [], 
        timestamp: Date.now(), status: 'draft' 
    };
    
    updateBottomBar();
}

window.openMultiSizeModal = function(id) {
    const item = MENU_DATA.find(i => i.id == id);
    document.getElementById('modal-title').innerText = item.TenMon;
    document.getElementById('modal-desc').innerText = item.MoTa;
    document.getElementById('modal-img').src = item.img;
    // Reset số lượng hiển thị trong modal (chỉ là visual)
    document.getElementById('qty-M').innerText = "0";
    document.getElementById('qty-L').innerText = "0";
    // Lưu item đang chọn vào biến tạm
    window.currentItemForModal = item;
    document.getElementById('size-modal').classList.remove('hidden');
}

window.updateModalQty = function(size, delta) {
    // Logic cũ: update vào cart ngay. Logic mới: Tách riêng.
    // Khi bấm + ở modal size -> Thêm ngay 1 món vào giỏ
    if (delta > 0 && window.currentItemForModal) {
        const item = window.currentItemForModal;
        const price = size === 'M' ? item.GiaM : item.GiaL;
        const uniqueKey = `local_${Date.now()}_${Math.random()}`;
        
        cart[uniqueKey] = {
            item: item, size: size, qty: 1, price: price, note: '', toppings: [],
            timestamp: Date.now(), status: 'draft'
        };
        updateBottomBar();
        alert(`Đã thêm 1 ${item.TenMon} (${size})`);
    }
}

function updateBottomBar() {
    let count = 0; let total = 0;
    // Chỉ tính món trong cart (Món chưa gọi) hoặc Cả món đã gọi?
    // Thường là tổng cả bàn.
    // Lấy món đã gọi từ DB
    const myTableOrders = dbOrders.filter(o => o.table == currentTable && o.status !== 'split_paid');
    
    // Tính tổng DB
    myTableOrders.forEach(o => {
        o.items.forEach(i => {
            count += i.qty;
            total += (i.price * i.qty);
            if(i.toppings) i.toppings.forEach(t => total += t.price);
        });
    });

    // Tính tổng Local Cart
    Object.values(cart).forEach(order => {
        count += order.qty;
        total += (order.price * order.qty);
        order.toppings.forEach(tp => total += tp.price);
    });

    document.getElementById('total-count').innerText = count;
    document.getElementById('total-price').innerText = total.toLocaleString() + "đ";
}

// --- LOGIC MODAL GIỎ HÀNG ---
window.openCartDetails = function() {
    const list = document.getElementById('cart-items-list');
    list.innerHTML = "";
    
    // 1. Render Món ĐÃ GỌI (Từ Firebase)
    const historyOrders = dbOrders.filter(o => o.table == currentTable).sort((a,b) => b.timestamp - a.timestamp);
    
    // Gom các lệnh gọi theo mốc thời gian
    historyOrders.forEach(batch => {
        // Bỏ qua các đơn đã thanh toán riêng (split_paid) nếu muốn ẩn
        // Nhưng yêu cầu là hiển thị tiếp tục. Ta cứ hiện, nhưng đánh dấu.
        if (batch.status === 'split_paid') return; // Đã thanh toán riêng thì ẩn khỏi list chính? Tùy logic. Giữ lại cho đơn giản.

        const timeStr = new Date(batch.timestamp).toLocaleTimeString();
        list.innerHTML += `<div class="time-divider">Giờ gọi: ${timeStr} <span class="badge-status bg-ordered">Đã gọi</span></div>`;
        
        batch.items.forEach(item => {
            // Render item (Read-only, không sửa được topping/ghi chú nữa)
            // item trong DB không có unique key đơn lẻ, dùng index
            const toppingHtml = item.toppings ? item.toppings.map(t => `<span class="topping-tag">${t.name}</span>`).join('') : '';
            list.innerHTML += `
                <div class="cart-item-row" style="background:#f8f9fa">
                    <div class="d-flex justify-content-between">
                        <div><b>${item.name} (${item.size})</b> <br> <small>${item.price.toLocaleString()}đ</small></div>
                        <div class="fw-bold">x${item.qty}</div>
                    </div>
                    <div class="text-muted small"><i>${item.note || ''}</i></div>
                    <div>${toppingHtml}</div>
                </div>`;
        });
    });

    // 2. Render Món CHƯA GỌI (Local Cart)
    if (Object.keys(cart).length > 0) {
        list.innerHTML += `<div class="time-divider">Hiện tại <span class="badge-status bg-draft">Chưa gọi</span></div>`;
        
        Object.entries(cart).forEach(([key, order]) => {
            const toppingHtml = order.toppings.map(tp => 
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
                    <div class="mt-1">${toppingHtml}</div>
                    <div class="text-end mt-2">
                        <button class="btn btn-sm btn-outline-primary p-0 px-2" style="font-size:10px" onclick="showToppingSelector('${key}')">+ Topping</button>
                    </div>
                </div>`;
        });
    }

    // Logic nút bấm footer
    const hasLocalItems = Object.keys(cart).length > 0;
    const hasHistoryItems = historyOrders.length > 0;

    document.getElementById('btn-send-order').disabled = !hasLocalItems;
    
    // 3 nút dưới chỉ sáng khi KHÔNG có món mới cần gọi (tức là đã gọi hết) VÀ có lịch sử
    const canAction = !hasLocalItems && hasHistoryItems;
    ['btn-bill', 'btn-split', 'btn-pay'].forEach(id => {
        const btn = document.getElementById(id);
        btn.disabled = !canAction;
        if(canAction) {
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
        updateBottomBar(); openCartDetails();
    }
}
window.updateNote = function(key, val) { if(cart[key]) cart[key].note = val; }
window.removeTopping = function(key, tpId) {
    cart[key].toppings = cart[key].toppings.filter(t => t.id !== tpId);
    updateBottomBar(); openCartDetails();
}

// Logic Topping Selector (Vẽ đè lên list)
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
        
        // Gửi DB
        let total = 0; items.forEach(i => { total += (i.price * i.qty); if(i.toppings) i.toppings.forEach(t => total += t.price); });
        sendOrderToDB(currentTable, items, 0, total); // status mặc định là 'moi'
        
        cart = {}; // Clear local
        alert("Gọi món thành công!");
        updateBottomBar();
        openCartDetails(); // Re-render để thấy nút sáng lên
    }
}

// --- LOGIC THANH TOÁN RIÊNG (SPLIT BILL) ---
let splitSelectedItems = []; // Lưu các món được chọn để trả tiền

window.openSplitBillModal = function() {
    const list = document.getElementById('split-items-list');
    list.innerHTML = "";
    splitSelectedItems = [];
    
    // Lấy tất cả món đã gọi (chưa thanh toán riêng)
    const orders = dbOrders.filter(o => o.table == currentTable && o.status !== 'split_paid');
    
    let index = 0;
    orders.forEach(batch => {
        batch.items.forEach(item => {
            const itemTotal = (item.price * item.qty) + (item.toppings ? item.toppings.reduce((a,b)=>a+b.price,0) : 0);
            // Tạo ID ảo để track checkbox
            const splitId = `${batch.key}_${index}`; // Giả sử batch có key từ Firebase
            
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
    if(chk.checked) {
        splitSelectedItems.push({ id, price, name, batchKey });
    } else {
        splitSelectedItems = splitSelectedItems.filter(i => i.id !== id);
    }
    const total = splitSelectedItems.reduce((a,b) => a + b.price, 0);
    document.getElementById('split-total').innerText = total.toLocaleString() + "đ";
}

window.proceedSplitPayment = function() {
    if(splitSelectedItems.length === 0) { alert("Chưa chọn món nào!"); return; }
    
    // Mở modal chọn phương thức
    const total = splitSelectedItems.reduce((a,b) => a + b.price, 0);
    document.getElementById('pay-amount').innerText = total.toLocaleString() + "đ";
    document.getElementById('payment-method-modal').classList.remove('hidden');
    // Ẩn modal split cũ
    document.getElementById('split-modal').classList.add('hidden');
    
    // Reset view modal payment
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
        // Gửi yêu cầu lên DB cho Thu ngân biết
        // Cấu trúc: { type: 'split_req', table: ..., amount: ..., items: [...], status: 'pending' }
        const total = splitSelectedItems.reduce((a,b) => a + b.price, 0);
        
        // Gửi một object đặc biệt lên DB orders (hoặc node riêng)
        // Ở đây tôi dùng sendOrderToDB với status đặc biệt 'payment_request'
        const reqData = {
            table: currentTable,
            amount: total,
            items: splitSelectedItems, // Lưu danh sách item ID đã chọn
            status: 'payment_request', // Cờ để thu ngân hiện chấm đỏ
            timestamp: Date.now()
        };
        
        // Gọi hàm push trực tiếp (Giả sử bạn đã export hoặc dùng sendOrderToDB biến tấu)
        // Đây là cách đi tắt: sendOrderToDB nhận items, ta nhét data vào đó
        sendOrderToDB(currentTable, [{name: "Yêu cầu TT Riêng", qty:1, price: total}], 0, total); 
        // LƯU Ý: Để chính xác, bạn cần sửa firebase-service.js để có hàm pushPaymentRequest.
        // Nhưng logic trên sẽ hiện 1 đơn hàng mới ở thu ngân. Thu ngân nhìn thấy sẽ xử lý.
        
        alert("Đã gửi xác nhận. Vui lòng đợi thu ngân kiểm tra.");
        closePaymentModal();
    }
}

window.closePaymentModal = function() {
    document.getElementById('payment-method-modal').classList.add('hidden');
}

// --- REQUEST BILL (FULL) ---
window.requestBill = function() {
    const html = generateBillHtml(currentTable);
    document.getElementById('bill-content').innerHTML = html;
    document.getElementById('bill-modal').classList.remove('hidden');
}

// Hàm vẽ Hóa đơn (Chung)
function generateBillHtml(tId) {
    const orders = dbOrders.filter(o => o.table == tId);
    let html = `<div class="text-center fw-bold">HÓA ĐƠN TẠM TÍNH<br>Bàn ${tId}</div><hr>`;
    let total = 0;
    
    orders.forEach(batch => {
        // Nếu là yêu cầu thanh toán (payment_request), hiển thị riêng? 
        // Hay chỉ hiện các món Order thông thường?
        // Hiện tại chỉ hiện món ăn.
        if(batch.status === 'payment_request') return; 

        batch.items.forEach(i => {
            const itemTotal = (i.price * i.qty) + (i.toppings ? i.toppings.reduce((a,b)=>a+b.price,0) : 0);
            total += itemTotal;
            const topStr = i.toppings && i.toppings.length ? `<br><small>+${i.toppings.map(t=>t.name).join(',')}</small>` : '';
            html += `<div class="d-flex justify-content-between mb-1">
                <span>${i.name} (${i.size}) x${i.qty} ${topStr}</span>
                <span>${itemTotal.toLocaleString()}</span>
            </div>`;
        });
    });
    html += `<hr><div class="d-flex justify-content-between fw-bold"><span>TỔNG:</span><span>${total.toLocaleString()}đ</span></div>`;
    // Thêm QR Code thanh toán tổng
    html += `<div class="text-center mt-3"><img src="${BANK_QR_URL}" style="width:100px"><br><small>Quét mã để thanh toán</small></div>`;
    return html;
}

window.downloadBill = function() {
    html2canvas(document.getElementById('bill-content')).then(c => {
        const link = document.createElement('a');
        link.download = "Bill.png"; link.href = c.toDataURL(); link.click();
    });
}

/* ==================== 2. LOGIC THU NGÂN ==================== */

function initCashierView(orders) {
    const grid = document.getElementById('table-grid');
    grid.innerHTML = "";
    // Lấy danh sách các bàn ĐANG CÓ ĐƠN (active)
    const tables = [...new Set(orders.map(o => o.table))];
    
    tables.forEach(t => {
        // Check xem bàn này có yêu cầu thanh toán (dấu đỏ) không
        const hasReq = orders.some(o => o.table == t && o.items[0]?.name === "Yêu cầu TT Riêng"); // Logic tạm check tên
        
        const col = document.createElement('div');
        col.className = "col-4 col-md-3";
        col.innerHTML = `
            <div class="table-btn active" onclick="showTableBill('${t}')">
                <h4>${t}</h4>
                ${hasReq ? '<div class="red-dot"></div>' : ''}
            </div>`;
        grid.appendChild(col);
    });
}

window.showTableBill = function(tId) {
    // Logic hiển thị chi tiết cho thu ngân:
    // 1. Các món chưa thanh toán
    // 2. Các yêu cầu thanh toán riêng (để duyệt)
    
    const tOrders = dbOrders.filter(o => o.table == tId);
    // Tạm thời dùng chung hàm generateBillHtml
    const html = generateBillHtml(tId); 
    document.getElementById('bill-content').innerHTML = html;
    document.getElementById('bill-modal').classList.remove('hidden');
}

/* ==================== 3. LOGIC BẾP (SỬA LỖI) ==================== */

function initKitchenView(orders) {
    const list = document.getElementById('kitchen-orders');
    list.innerHTML = "";
    // Lọc đơn mới hoặc đang làm
    const active = orders.filter(o => o.status === 'moi' || o.status === 'dang_lam');
    
    active.forEach(o => {
        const itemsHtml = o.items.map(i => {
            const note = i.note ? `<div class="text-info small"><i class="fas fa-pen"></i> ${i.note}</div>` : '';
            return `<div class="border-bottom border-secondary py-1">${i.name} (${i.size}) x${i.qty} ${note}</div>`;
        }).join('');

        // Logic nút bấm sửa lỗi: moi -> dang_lam -> xong
        let btn = "";
        if(o.status === 'moi') {
            btn = `<button class="btn btn-warning w-100 fw-bold" onclick="updateOrderStatus('${o.key}', 'dang_lam')">NHẬN ĐƠN</button>`;
        } else {
            btn = `<button class="btn btn-success w-100 fw-bold" onclick="updateOrderStatus('${o.key}', 'xong')">PHỤC VỤ XONG</button>`;
        }

        const div = document.createElement('div');
        div.className = "card-kitchen p-3 shadow";
        div.innerHTML = `<div class="d-flex justify-content-between text-warning"><h4>BÀN ${o.table}</h4><span>${new Date(o.timestamp).toLocaleTimeString()}</span></div>
                         <div class="mb-3">${itemsHtml}</div>${btn}`;
        list.appendChild(div);
    });
}