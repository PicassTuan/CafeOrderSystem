import { saveMenuToDB, listenForMenu, sendOrderToDB, listenForOrders, updateOrderStatus, deleteOrder } from './firebase-service.js';

// --- BIẾN TOÀN CỤC ---
let MENU_DATA = [];
let cart = {}; // Cấu trúc: { "unique_id": { item: {...}, qty: 1, note: "", toppings: [] } }
// Lưu ý: unique_id = itemID_Size_Timestamp (để tách riêng các món giống nhau nhưng khác ghi chú)
let currentTable = "Mang Về";
let currentCategory = "ALL";
let currentSearch = "";
let dbOrders = []; // Lưu tất cả đơn hàng từ DB để tính hóa đơn

const CATEGORIES = [
    { code: "ALL", name: "Tất cả" },
    { code: "TS", name: "Trà sữa" },
    { code: "THQ", name: "Trà hoa quả" },
    { code: "CF", name: "Cà phê" },
    { code: "TP", name: "Topping" }, // Topping cũng là 1 mục
    { code: "AV", name: "Ăn vặt" }
];

document.addEventListener("DOMContentLoaded", () => {
    // Lấy param URL
    const urlParams = new URLSearchParams(window.location.search);
    const view = urlParams.get('view');
    currentTable = urlParams.get('ban') || "Khách Lẻ";

    listenForMenu((data) => {
        MENU_DATA = data;
        if (!view) { // View Khách
            renderCategories();
            renderMenu();
        }
    });

    listenForOrders((orders) => {
        dbOrders = orders;
        if (view === 'bep') initKitchenView(orders);
        if (view === 'thungan') initCashierView(orders);
    });

    if (!view) initCustomerView();
    if (view === 'bep') document.getElementById('view-kitchen').classList.remove('hidden');
    if (view === 'thungan') document.getElementById('view-cashier').classList.remove('hidden');
    
    // Search
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
    document.getElementById('cart-table-num').innerText = "Bàn " + currentTable;
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
    
    // Lọc (Trừ Topping ra khỏi menu chính để đỡ rối, Topping chỉ hiện khi chọn thêm)
    const filtered = MENU_DATA.filter(item => {
        const matchCat = currentCategory === "ALL" ? item.PhanLoai !== 'TP' : item.PhanLoai === currentCategory;
        const matchSearch = item.TenMon.toLowerCase().includes(currentSearch);
        return matchCat && matchSearch;
    });

    filtered.forEach(item => {
        const div = document.createElement('div');
        div.className = "item-card";
        div.innerHTML = `
            <img src="${item.img}" class="item-img" onerror="this.src='https://via.placeholder.com/100'">
            <div class="item-info">
                <div>
                    <h6 class="item-title">${item.TenMon}</h6>
                    <span class="item-desc">${item.MoTa}</span>
                </div>
                <div class="d-flex justify-content-between align-items-end">
                    <span class="item-price">${parseInt(item.GiaM).toLocaleString()}đ</span>
                    <button class="btn-add-cart" onclick="addToCart(${item.id})">Thêm</button>
                </div>
            </div>
        `;
        container.appendChild(div);
    });
    updateBottomBar();
}

// Thêm món vào giỏ (Tạo unique ID để tách dòng)
window.addToCart = function(id) {
    const item = MENU_DATA.find(i => i.id == id);
    if(item.hasMultiSize) {
        openMultiSizeModal(id);
    } else {
        const uniqueKey = `${item.id}_M_${Date.now()}`;
        cart[uniqueKey] = { item: item, size: 'M', qty: 1, price: item.GiaM, note: '', toppings: [] };
        updateBottomBar();
    }
}

window.openMultiSizeModal = function(id) {
    // Logic Popup Size giữ nguyên, chỉ thay đổi hàm thêm vào giỏ
    const item = MENU_DATA.find(i => i.id == id);
    // ... Render popup info ...
    // Gán tạm thời hàm updateModalQty để add trực tiếp vào cart với uniqueKey
    // (Để đơn giản, bài này tôi focus vào logic cart detail bên dưới)
    // Tạm thời món 2 size sẽ auto add Size M, bạn có thể custom thêm
    const uniqueKey = `${item.id}_M_${Date.now()}`;
    cart[uniqueKey] = { item: item, size: 'M', qty: 1, price: item.GiaM, note: '', toppings: [] };
    updateBottomBar();
    alert("Đã thêm Size M (Bạn có thể chỉnh sửa trong giỏ hàng)");
}

function updateBottomBar() {
    let count = 0; let total = 0;
    Object.values(cart).forEach(order => {
        count += order.qty;
        total += (order.price * order.qty);
        // Cộng tiền topping
        order.toppings.forEach(tp => total += tp.price);
    });
    document.getElementById('total-count').innerText = count;
    document.getElementById('total-price').innerText = total.toLocaleString() + "đ";
    document.getElementById('cart-total-top').innerText = total.toLocaleString() + "đ";
}

// --- LOGIC CHI TIẾT GIỎ HÀNG (QUAN TRỌNG) ---

window.openCartDetails = function() {
    const list = document.getElementById('cart-items-list');
    list.innerHTML = "";
    
    // Enable/Disable buttons
    document.getElementById('btn-send-order').disabled = Object.keys(cart).length === 0;
    // Reset trạng thái nút thanh toán
    toggleFooterButtons(false);

    if(Object.keys(cart).length === 0) {
        list.innerHTML = "<p class='text-center text-muted mt-5'>Giỏ hàng trống</p>";
    }

    Object.entries(cart).forEach(([key, order]) => {
        const toppingHtml = order.toppings.map(tp => 
            `<span class="topping-tag">${tp.name} +${tp.price/1000}k <i class="fas fa-times text-danger" onclick="removeTopping('${key}', ${tp.id})"></i></span>`
        ).join('');

        const div = document.createElement('div');
        div.className = "cart-item-row";
        div.innerHTML = `
            <div class="d-flex justify-content-between mb-2">
                <div>
                    <fw-bold>${order.item.TenMon} (${order.size})</fw-bold> <br>
                    <small class="text-muted">${order.price.toLocaleString()}đ</small>
                </div>
                <div class="qty-control-simple bg-light border">
                    <button onclick="changeCartQty('${key}', -1)">-</button>
                    <span>${order.qty}</span>
                    <button onclick="changeCartQty('${key}', 1)">+</button>
                </div>
            </div>
            
            <div class="mb-2">
                <div class="input-group input-group-sm mb-1">
                    <span class="input-group-text border-0 bg-transparent ps-0"><i class="fas fa-pen text-secondary"></i></span>
                    <input type="text" class="note-input" placeholder="Ghi chú cho bếp..." 
                           value="${order.note}" onchange="updateNote('${key}', this.value)">
                </div>
                <div>${toppingHtml}</div>
            </div>

            <div class="text-end">
                <button class="btn btn-sm btn-outline-primary rounded-pill" style="font-size:10px" onclick="showToppingSelector('${key}')">
                    <i class="fas fa-plus"></i> Thêm Topping
                </button>
            </div>
        `;
        list.appendChild(div);
    });

    document.getElementById('cart-modal').classList.remove('hidden');
    // Animation slide up
    document.querySelector('.cart-modal-content').style.transform = "translateY(0)";
}

window.closeCartDetails = function() {
    document.getElementById('cart-modal').classList.add('hidden');
}

// Logic thay đổi số lượng trong giỏ
window.changeCartQty = function(key, delta) {
    if(cart[key]) {
        cart[key].qty += delta;
        if(cart[key].qty <= 0) delete cart[key];
        updateBottomBar();
        openCartDetails(); // Re-render
    }
}

window.updateNote = function(key, val) {
    if(cart[key]) cart[key].note = val;
}

// Logic Topping
window.showToppingSelector = function(key) {
    // Lấy danh sách topping từ MENU_DATA
    const toppings = MENU_DATA.filter(i => i.PhanLoai === 'TP');
    let toppingListHtml = toppings.map(tp => 
        `<li class="list-group-item d-flex justify-content-between action-hover" onclick="selectTopping('${key}', ${tp.id})">
            <span>${tp.TenMon}</span> <span>+${parseInt(tp.GiaM).toLocaleString()}</span>
         </li>`
    ).join('');

    // Dùng prompt hoặc modal nhỏ (ở đây làm đơn giản dùng alert/prompt không đẹp, tôi sẽ vẽ đè lên list giỏ hàng tạm thời)
    const list = document.getElementById('cart-items-list');
    list.innerHTML = `
        <div class="bg-white p-3 rounded">
            <h5>Chọn Topping <button class="btn btn-sm float-end" onclick="openCartDetails()">Quay lại</button></h5>
            <ul class="list-group list-group-flush">${toppingListHtml}</ul>
        </div>
    `;
}

window.selectTopping = function(keyCart, idTopping) {
    const tp = MENU_DATA.find(i => i.id == idTopping);
    // Check trùng
    if(!cart[keyCart].toppings.find(t => t.id == idTopping)) {
        cart[keyCart].toppings.push({ id: tp.id, name: tp.TenMon, price: tp.GiaM });
        updateBottomBar();
    }
    openCartDetails(); // Quay lại giỏ
}

window.removeTopping = function(key, idTp) {
    cart[key].toppings = cart[key].toppings.filter(t => t.id !== idTp);
    updateBottomBar();
    openCartDetails();
}

// --- GỬI ĐƠN & THANH TOÁN ---

window.submitOrder = function() {
    if(confirm("Xác nhận gọi món?")) {
        // Chuyển đổi cart object thành mảng items để gửi DB
        const items = Object.values(cart).map(c => ({
            name: c.item.TenMon,
            size: c.size,
            qty: c.qty,
            price: c.price,
            note: c.note,
            toppings: c.toppings
        }));
        
        let totalPrice = 0; 
        items.forEach(i => {
            totalPrice += (i.price * i.qty);
            i.toppings.forEach(t => totalPrice += t.price);
        });

        sendOrderToDB(currentTable, items, 0, totalPrice); // cost = 0 tạm
        
        // Clear giỏ nhưng KHÔNG đóng modal ngay
        cart = {};
        updateBottomBar();
        document.getElementById('cart-items-list').innerHTML = 
            `<div class="text-center mt-5 text-success">
                <i class="fas fa-check-circle fa-3x mb-3"></i><br>
                <h5>Đã gửi đơn thành công!</h5>
                <p>Bây giờ bạn có thể yêu cầu hóa đơn.</p>
             </div>`;
        
        document.getElementById('btn-send-order').disabled = true;
        
        // Kích hoạt 3 nút bên dưới
        toggleFooterButtons(true);
    }
}

function toggleFooterButtons(enable) {
    const btns = ['btn-bill', 'btn-split', 'btn-pay'];
    btns.forEach(id => {
        const b = document.getElementById(id);
        if(enable) {
            b.disabled = false;
            b.classList.remove('disabled-action');
            b.classList.replace('btn-outline-secondary', 'btn-primary'); // Đổi màu
        } else {
            b.disabled = true;
            b.classList.add('disabled-action');
            b.classList.replace('btn-primary', 'btn-outline-secondary');
        }
    });
}

// Yêu cầu hóa đơn (Khách ấn nút Xuất HĐ)
window.requestBill = function() {
    // Logic: Lấy tất cả đơn của bàn này từ DBOrders để hiển thị preview
    // Ở đây tôi tái sử dụng hàm generateBillHtml của Thu ngân
    const billHtml = generateBillHtml(currentTable);
    document.getElementById('bill-content').innerHTML = billHtml;
    document.getElementById('bill-modal').classList.remove('hidden');
}

/* ==================== 2. LOGIC THU NGÂN ==================== */

function initCashierView(orders) {
    const grid = document.getElementById('table-grid');
    grid.innerHTML = "";
    
    // Lấy danh sách bàn duy nhất từ orders
    const activeTables = [...new Set(orders.map(o => o.table))];
    
    // Vẽ danh sách bàn
    // (Giả lập có 10 bàn cố định + bàn đang hoạt động)
    for(let i=1; i<=10; i++) {
        const tName = i.toString();
        const isActive = activeTables.includes(tName);
        const col = document.createElement('div');
        col.className = "col-4 col-md-3";
        col.innerHTML = `
            <div class="table-btn ${isActive ? 'active' : ''}" onclick="showTableBill('${tName}')">
                <h4 class="mb-0 fw-bold">${tName}</h4>
                <small>${isActive ? 'Có khách' : 'Trống'}</small>
            </div>
        `;
        grid.appendChild(col);
    }
    
    // Vẽ thêm các bàn có tên lạ (VD: VIP, Mang Về)
    activeTables.forEach(t => {
        if(isNaN(t)) { // Nếu không phải số
             const col = document.createElement('div');
             col.className = "col-4 col-md-3";
             col.innerHTML = `<div class="table-btn active" onclick="showTableBill('${t}')"><h4>${t}</h4></div>`;
             grid.appendChild(col);
        }
    });
}

window.showTableBill = function(tableId) {
    const html = generateBillHtml(tableId);
    document.getElementById('bill-content').innerHTML = html;
    document.getElementById('bill-modal').classList.remove('hidden');
}

// Hàm tạo HTML hóa đơn (Dùng chung cho Khách & Thu ngân)
function generateBillHtml(tableId) {
    // Lọc tất cả đơn của bàn này
    const tableOrders = dbOrders.filter(o => o.table == tableId);
    let itemsHtml = "";
    let totalAll = 0;
    const timeIn = tableOrders.length > 0 ? new Date(tableOrders[0].timestamp).toLocaleTimeString() : "--";
    
    tableOrders.forEach(order => {
        order.items.forEach(item => {
            const itemTotal = (item.price * item.qty);
            let toppingPrice = 0;
            let toppingStr = "";
            if(item.toppings && item.toppings.length > 0) {
                item.toppings.forEach(t => { toppingPrice += t.price; });
                toppingStr = `<br><small class="text-muted">+ ${item.toppings.map(t=>t.name).join(', ')}</small>`;
            }
            
            totalAll += itemTotal + toppingPrice;
            
            itemsHtml += `
                <div class="bill-row">
                    <div style="flex:2">
                        <b>${item.name}</b> (${item.size})
                        ${toppingStr}
                    </div>
                    <div style="flex:1; text-align:center">x${item.qty}</div>
                    <div style="flex:1; text-align:right">${(itemTotal + toppingPrice).toLocaleString()}</div>
                </div>
            `;
        });
    });

    return `
        <div class="text-center mb-3">
            <h5 class="fw-bold m-0">NACA Coffee & Tea</h5>
            <small>ĐC: Thôn 9, Cao Nhân, Thủy Nguyên, HP</small><br>
            <small>ĐT: 0349.315.099</small>
        </div>
        <div class="border-bottom border-top py-2 mb-2 d-flex justify-content-between" style="font-size:12px">
            <span>Bàn: <b>${tableId}</b></span>
            <span>Giờ: ${timeIn}</span>
        </div>
        <div class="mb-2">
            ${itemsHtml || '<div class="text-center fst-italic">Chưa gọi món nào</div>'}
        </div>
        <div class="border-top pt-2">
            <div class="d-flex justify-content-between fw-bold">
                <span>TỔNG CỘNG:</span>
                <span>${totalAll.toLocaleString()} đ</span>
            </div>
            <div class="text-center mt-3 small fst-italic">Cảm ơn quý khách và hẹn gặp lại!</div>
        </div>
    `;
}

// Chức năng chụp ảnh hóa đơn
window.downloadBill = function() {
    const billNode = document.getElementById('bill-content');
    html2canvas(billNode).then(canvas => {
        const link = document.createElement('a');
        link.download = `HoaDon_${new Date().getTime()}.png`;
        link.href = canvas.toDataURL();
        link.click();
    });
}

/* ==================== 3. LOGIC BẾP (Hiển thị ghi chú) ==================== */

function initKitchenView(orders) {
    const container = document.getElementById('kitchen-orders');
    container.innerHTML = "";
    
    // Lọc đơn mới hoặc đang làm
    const active = orders.filter(o => o.status === 'moi' || o.status === 'dang_lam');

    active.forEach(order => {
        const itemsHtml = order.items.map(i => {
            const toppingStr = i.toppings && i.toppings.length > 0 ? `<div class="text-warning small">+ ${i.toppings.map(t=>t.name).join(', ')}</div>` : '';
            const noteStr = i.note ? `<div class="text-info small"><i class="fas fa-pen"></i> ${i.note}</div>` : '';
            
            return `<div class="border-bottom border-secondary py-2">
                <span class="fs-5 fw-bold text-white">${i.name} (${i.size})</span> <span class="text-danger fw-bold fs-4 float-end">x${i.qty}</span>
                ${toppingStr}
                ${noteStr}
            </div>`;
        }).join('');

        let btnState = order.status === 'moi' 
            ? `<button class="btn btn-warning w-100 fw-bold" onclick="updateOrderStatus('${order.key}', 'dang_lam')">NHẬN ĐƠN</button>`
            : `<button class="btn btn-success w-100 fw-bold" onclick="updateOrderStatus('${order.key}', 'xong')">PHỤC VỤ XONG</button>`;

        const div = document.createElement('div');
        div.className = "card-kitchen p-3 shadow";
        div.innerHTML = `
            <div class="d-flex justify-content-between mb-2 text-warning">
                <h3>BÀN ${order.table}</h3>
                <span>${new Date(order.timestamp).toLocaleTimeString().slice(0,5)}</span>
            </div>
            <div class="mb-3">${itemsHtml}</div>
            ${btnState}
        `;
        container.appendChild(div);
    });
}