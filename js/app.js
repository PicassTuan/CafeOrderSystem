import { saveMenuToDB, listenForMenu, sendOrderToDB, listenForOrders, updateOrderStatus, deleteOrder } from './firebase-service.js';

// --- CẤU HÌNH ---
// Bạn có thể thay link ảnh QR ngân hàng của bạn vào đây
const BANK_QR_URL = "https://img.vietqr.io/image/MB-0349315099-compact.png"; 

// --- BIẾN TOÀN CỤC ---
let MENU_DATA = [];
let cart = {}; 
let dbOrders = []; 
let currentTable = "Mang Về";
let currentCategory = "ALL";
let currentSearch = "";
let currentItemForModal = null; // Biến tạm cho modal size

// Danh sách danh mục (Khớp với cột PhanLoai trong Excel)
const CATEGORIES = [
    { code: "ALL", name: "Tất cả" }, { code: "TS", name: "Trà sữa" },
    { code: "THQ", name: "Trà hoa quả" }, { code: "SCL", name: "Sữa chua" },
    { code: "CF", name: "Cà phê" }, { code: "TP", name: "Topping" }, 
    { code: "AV", name: "Ăn vặt" }
];

// --- KHỞI CHẠY (MAIN INIT) ---
document.addEventListener("DOMContentLoaded", () => {
    const urlParams = new URLSearchParams(window.location.search);
    const view = urlParams.get('view');
    currentTable = urlParams.get('ban') || "Mang Về";

    // 1. Lắng nghe Menu từ Firebase
    listenForMenu((data) => {
        MENU_DATA = data;
        if (!view) { renderCategories(); renderMenu(); }
    });

    // 2. Lắng nghe Đơn hàng từ Firebase
    listenForOrders((orders) => {
        dbOrders = orders;
        if (view === 'bep') initKitchenView(orders);
        if (view === 'thungan') initCashierView(orders);
        // Nếu đang ở giao diện khách, cập nhật thanh dưới cùng
        if(!view) updateBottomBar();
    });

    // 3. Điều hướng giao diện
    if (!view) initCustomerView();
    if (view === 'bep') document.getElementById('view-kitchen').classList.remove('hidden');
    if (view === 'thungan') document.getElementById('view-cashier').classList.remove('hidden');

    // 4. Sự kiện tìm kiếm
    const searchInput = document.getElementById('search-input');
    if(searchInput) searchInput.addEventListener('input', (e) => {
        currentSearch = e.target.value.toLowerCase();
        renderMenu();
    });
    
    // 5. Sự kiện Upload Excel (Thu ngân)
    const uploadInput = document.getElementById('cashier-upload-excel');
    if(uploadInput) uploadInput.addEventListener('change', handleFileUpload);
});

/* ==================== 1. LOGIC KHÁCH HÀNG ==================== */

function initCustomerView() {
    document.getElementById('view-customer').classList.remove('hidden');
    // Cập nhật tên bàn lên giao diện
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
        // Tính số lượng món này đang có trong giỏ (Local) để hiện +/-
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
    const uniqueKey = `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    cart[uniqueKey] = { 
        item: item, size: 'M', qty: 1, price: item.GiaM, 
        note: '', toppings: [], timestamp: Date.now() 
    };
    renderMenu();
    updateBottomBar();
}

function removeRecentItem(itemId) {
    // Tìm và xóa item mới nhất của món đó
    const keys = Object.keys(cart).filter(k => cart[k].item.id === itemId && cart[k].size === 'M');
    if (keys.length > 0) {
        const keyToRemove = keys[keys.length - 1]; // Lấy cái cuối cùng
        delete cart[keyToRemove];
    }
    renderMenu();
    updateBottomBar();
}

// Logic Popup Size
function openMultiSizeModal(id) {
    const item = MENU_DATA.find(i => i.id == id);
    document.getElementById('modal-title').innerText = item.TenMon;
    document.getElementById('modal-desc').innerText = item.MoTa;
    document.getElementById('modal-img').src = item.img;
    
    // Reset số lượng hiển thị trên modal
    document.getElementById('qty-M').innerText = "0";
    document.getElementById('qty-L').innerText = "0";
    
    currentItemForModal = item;
    document.getElementById('size-modal').classList.remove('hidden');
}

function closeModal() {
    document.getElementById('size-modal').classList.add('hidden');
}

function updateModalQty(size, delta) {
    if (delta > 0 && currentItemForModal) {
        const item = currentItemForModal;
        const price = size === 'M' ? item.GiaM : item.GiaL;
        const uniqueKey = `local_${Date.now()}_${Math.random()}`;
        
        cart[uniqueKey] = {
            item: item, size: size, qty: 1, price: price, note: '', toppings: [], timestamp: Date.now()
        };
        updateBottomBar();
        alert(`Đã thêm 1 ${item.TenMon} (${size})`);
    }
    // Modal size hiện tại chỉ hỗ trợ thêm, không hỗ trợ xóa trực tiếp tại đây (phải vào giỏ)
}

function updateBottomBar() {
    let count = 0; let total = 0;
    
    // Tính tổng Local Cart
    Object.values(cart).forEach(order => {
        count += order.qty;
        total += (order.price * order.qty);
        order.toppings.forEach(tp => total += tp.price);
    });

    // Cập nhật giao diện
    document.getElementById('total-count').innerText = count;
    document.getElementById('total-price').innerText = total.toLocaleString() + "đ";
}

/* ==================== 2. LOGIC BẾP ==================== */

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
        
        let btn = o.status==='moi' 
            ? `<button class="btn btn-warning w-100 fw-bold" onclick="updateOrderStatus('${o.key}','dang_lam')">NHẬN ĐƠN</button>`
            : `<button class="btn btn-success w-100 fw-bold" onclick="updateOrderStatus('${o.key}','xong')">PHỤC VỤ XONG</button>`;
        
        const div = document.createElement('div'); 
        div.className = "card-kitchen p-3 shadow";
        div.innerHTML = `
            <div class="d-flex justify-content-between text-warning">
                <h4>BÀN ${o.table}</h4>
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
    const list = document.getElementById('cashier-orders');
    if(!list) return;
    list.innerHTML = "";

    // Lấy các đơn chưa thanh toán/nhập KV
    const active = orders.filter(o => o.status !== 'da_nhap_kv');

    if(active.length === 0) {
        list.innerHTML = "<p class='text-center text-muted mt-5'>Chưa có đơn hàng nào.</p>";
        return;
    }

    active.forEach(order => {
        const itemDetails = order.items.map(i => `- ${i.name} (${i.size}) x${i.qty}`).join('<br>');
        
        // Badge trạng thái
        let badge = "";
        if(order.status === 'moi') badge = '<span class="badge bg-secondary">Mới</span>';
        else if(order.status === 'dang_lam') badge = '<span class="badge bg-warning text-dark">Đang làm</span>';
        else if(order.status === 'xong') badge = '<span class="badge bg-success">Bếp xong</span>';

        const div = document.createElement('div');
        div.className = `card mb-2 shadow-sm ${order.status === 'xong' ? 'border-success' : 'border-warning'}`;
        div.innerHTML = `
            <div class="card-body">
                <div class="d-flex justify-content-between">
                    <h5 class="fw-bold">Bàn ${order.table}</h5>
                    ${badge}
                </div>
                <div class="mt-2 mb-2 text-muted" style="font-size:0.9rem">${itemDetails}</div>
                <div class="d-flex justify-content-between align-items-center">
                    <strong>Tổng: ${parseInt(order.totalPrice).toLocaleString()}đ</strong>
                    <button class="btn btn-primary btn-sm" onclick="finishOrder('${order.key}')">Đã nhập KiotViet</button>
                </div>
            </div>`;
        list.appendChild(div);
    });
}

function finishOrder(key) {
    if(confirm("Xác nhận đã nhập đơn này vào KiotViet?")) {
        deleteOrder(key); // Xóa khỏi danh sách
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

        if(confirm(`Tìm thấy ${cleanData.length} món. Bạn có muốn cập nhật Menu không?`)) {
            saveMenuToDB(cleanData)
                .then(() => alert("Cập nhật thành công!"))
                .catch(err => alert("Lỗi: " + err));
        }
    };
    reader.readAsArrayBuffer(file);
}

// --- QUAN TRỌNG: CÔNG KHAI HÀM RA WINDOW ĐỂ HTML GỌI ĐƯỢC ---
window.addToCart = addToCart;
window.removeRecentItem = removeRecentItem;
window.openMultiSizeModal = openMultiSizeModal;
window.closeModal = closeModal;
window.updateModalQty = updateModalQty;
window.updateOrderStatus = updateOrderStatus;
window.finishOrder = finishOrder;
window.handleFileUpload = handleFileUpload;
// Bạn có thể thêm các hàm mở giỏ hàng chi tiết nếu cần ở đây