import { saveMenuToDB, listenForMenu, sendOrderToDB, listenForOrders, updateOrderStatus, deleteOrder } from './firebase-service.js';

// --- KHAI BÁO BIẾN ---
let MENU_DATA = [];
let cart = {}; 
let currentModalItem = null;
let currentSearch = "";
let currentCategory = "ALL";

// Danh sách danh mục
const CATEGORIES = [
    { code: "ALL", name: "Tất cả" },
    { code: "TS", name: "Trà sữa" },
    { code: "THQ", name: "Trà hoa quả" },
    { code: "SCL", name: "Sữa chua" },
    { code: "NE", name: "Nước ép" },
    { code: "DUST", name: "Sữa tươi" },
    { code: "DXPK", name: "Đá xay" },
    { code: "CF", name: "Cà phê" },
    { code: "ST", name: "Sinh tố" },
    { code: "KT", name: "Kem tươi" },
    { code: "DUN", name: "Đồ nóng" },
    { code: "AV", name: "Ăn vặt" },
    { code: "TP", name: "Topping" }
];

// --- KHỞI CHẠY ---
document.addEventListener("DOMContentLoaded", () => {
    // 1. Lắng nghe Menu
    listenForMenu((data) => {
        MENU_DATA = data;
        renderCategories();
        renderMenu();
    });

    // 2. Xác định màn hình
    const urlParams = new URLSearchParams(window.location.search);
    const view = urlParams.get('view');
    const table = urlParams.get('ban') || "Khách Lẻ";

    if (view === 'bep') {
        initKitchenView();
    } else if (view === 'thungan') {
        initCashierView();
    } else {
        initCustomerView(table);
    }

    // 3. Sự kiện tìm kiếm
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            currentSearch = e.target.value.toLowerCase();
            renderMenu();
        });
    }
});

/* ================= LOGIC KHÁCH HÀNG (GIỮ NGUYÊN) ================= */

function initCustomerView(tableName) {
    document.getElementById('view-customer').classList.remove('hidden');
    document.getElementById('display-table').innerText = tableName;
    
    document.querySelector('.cart-status-bar').addEventListener('click', () => {
        submitOrder(tableName);
    });
}

function renderCategories() {
    const catContainer = document.getElementById('category-list');
    if (!catContainer) return; 
    
    catContainer.innerHTML = "";
    CATEGORIES.forEach(cat => {
        const div = document.createElement('div');
        div.className = `cat-chip ${cat.code === currentCategory ? 'active' : ''}`;
        div.innerText = cat.name;
        div.onclick = () => {
            currentCategory = cat.code;
            renderCategories();
            renderMenu();
        };
        catContainer.appendChild(div);
    });
}

function renderMenu() {
    const container = document.getElementById('menu-container');
    if (!container) return; 
    container.innerHTML = "";

    const filteredData = MENU_DATA.filter(item => {
        const matchSearch = item.TenMon.toLowerCase().includes(currentSearch);
        const matchCat = currentCategory === "ALL" || item.PhanLoai === currentCategory;
        return matchSearch && matchCat;
    });

    if(filteredData.length === 0) {
        container.innerHTML = "<p class='text-center text-muted mt-5'>Không tìm thấy món nào...</p>";
        return;
    }

    filteredData.forEach(item => {
        let qtyDisplay = 0;
        if(item.hasMultiSize) {
            qtyDisplay = (cart[`${item.id}_M`] || 0) + (cart[`${item.id}_L`] || 0);
        } else {
            qtyDisplay = cart[`${item.id}_M`] || 0;
        }

        let btnHtml = "";
        if (item.hasMultiSize) {
            btnHtml = `<button class="btn-add-cart" onclick="openMultiSizeModal(${item.id})">
                        ${qtyDisplay > 0 ? 'Đã chọn: ' + qtyDisplay : 'Thêm vào đơn'}
                       </button>`;
        } else {
            if (qtyDisplay === 0) {
                btnHtml = `<button class="btn-add-cart" onclick="updateQty('${item.id}_M', 1)">Thêm</button>`;
            } else {
                btnHtml = `
                    <div class="qty-control">
                        <button class="qty-btn" onclick="updateQty('${item.id}_M', -1)">-</button>
                        <span class="qty-num">${qtyDisplay}</span>
                        <button class="qty-btn" onclick="updateQty('${item.id}_M', 1)">+</button>
                    </div>`;
            }
        }

        const div = document.createElement('div');
        div.className = "container px-0";
        div.innerHTML = `
            <div class="item-card">
                <img src="${item.img}" class="item-img" onerror="this.src='https://via.placeholder.com/100'">
                <div class="item-info">
                    <div>
                        <h5 class="item-title">${item.TenMon}</h5>
                        <p class="item-desc">${item.MoTa}</p>
                    </div>
                    <div class="d-flex justify-content-between align-items-end">
                        <span class="item-price">${parseInt(item.GiaM).toLocaleString()}đ</span>
                        ${btnHtml}
                    </div>
                </div>
            </div>`;
        container.appendChild(div);
    });
    updateBottomStatus();
}

window.openMultiSizeModal = function(id) {
    const item = MENU_DATA.find(i => i.id == id);
    currentModalItem = item;
    document.getElementById('modal-title').innerText = item.TenMon;
    document.getElementById('modal-desc').innerText = item.MoTa;
    document.getElementById('modal-img').src = item.img;
    document.getElementById('qty-M').innerText = cart[`${id}_M`] || 0;
    document.getElementById('qty-L').innerText = cart[`${id}_L`] || 0;
    document.querySelector('.size-row:nth-child(2) .size-label').innerHTML = `SIZE M <small style="font-size:14px">(${parseInt(item.GiaM).toLocaleString()}đ)</small>`;
    document.querySelector('.size-row:nth-child(3) .size-label').innerHTML = `SIZE L <small style="font-size:14px">(${parseInt(item.GiaL).toLocaleString()}đ)</small>`;
    document.getElementById('size-modal').classList.remove('hidden');
}

window.closeModal = function() {
    document.getElementById('size-modal').classList.add('hidden');
    renderMenu();
}

window.updateQty = function(key, change) {
    if (!cart[key]) cart[key] = 0;
    cart[key] += change;
    if (cart[key] <= 0) delete cart[key];
    renderMenu(); 
}

window.updateModalQty = function(size, change) {
    if (!currentModalItem) return;
    const key = `${currentModalItem.id}_${size}`;
    if (!cart[key]) cart[key] = 0;
    cart[key] += change;
    if (cart[key] < 0) cart[key] = 0;
    document.getElementById(`qty-${size}`).innerText = cart[key];
    if (cart[key] === 0) delete cart[key];
    updateBottomStatus();
}

function updateBottomStatus() {
    let totalCount = 0;
    let totalPrice = 0;
    for (const [key, qty] of Object.entries(cart)) {
        const [id, size] = key.split('_');
        const item = MENU_DATA.find(i => i.id == id);
        if (item) {
            const price = size === 'M' ? item.GiaM : item.GiaL;
            totalCount += qty;
            totalPrice += price * qty;
        }
    }
    document.getElementById('total-count').innerText = totalCount;
    document.getElementById('total-price').innerText = totalPrice.toLocaleString() + " đ";
}

function submitOrder(tableName) {
    const items = [];
    let totalPrice = 0;
    let totalCost = 0;
    for (const [key, qty] of Object.entries(cart)) {
        const [id, size] = key.split('_');
        const item = MENU_DATA.find(i => i.id == id);
        if (item) {
            const price = size === 'M' ? item.GiaM : item.GiaL;
            const cost = size === 'M' ? item.VonM : item.VonL;
            items.push({ name: item.TenMon, size: size, qty: qty, price: price });
            totalPrice += price * qty;
            totalCost += cost * qty;
        }
    }
    if (items.length === 0) { alert("Bạn chưa chọn món nào!"); return; }
    if(confirm(`Gửi đơn ${items.length} món? Tổng: ${totalPrice.toLocaleString()}đ`)) {
        sendOrderToDB(tableName, items, totalCost, totalPrice);
        cart = {}; renderMenu(); alert("Đã gửi đơn xuống bếp!");
    }
}

/* ================= LOGIC BẾP (ĐÃ CẬP NHẬT 2 BƯỚC) ================= */

function initKitchenView() {
    document.getElementById('view-kitchen').classList.remove('hidden');
    document.querySelector('.top-search-bar').classList.add('hidden');
    document.querySelector('.bottom-area').classList.add('hidden');

    const listContainer = document.getElementById('kitchen-orders');
    listenForOrders((orders) => {
        listContainer.innerHTML = "";
        // Hiển thị cả món MỚI (moi) và món ĐANG LÀM (dang_lam)
        const activeOrders = orders.filter(o => o.status === 'moi' || o.status === 'dang_lam');
        
        if(activeOrders.length === 0) listContainer.innerHTML = "<p class='text-center text-white'>Chưa có món cần làm...</p>";

        activeOrders.forEach(order => {
            const itemDetails = order.items.map(i => `<div class="fs-5 fw-bold">- ${i.name} (${i.size}) <span class="text-danger">x${i.qty}</span></div>`).join('');
            
            // Logic nút bấm: Mới -> Nút LÀM (vàng) | Đang làm -> Nút PHỤC VỤ (xanh)
            let actionBtn = "";
            let cardHeaderColor = "bg-danger"; // Mặc định màu đỏ cho đơn mới

            if (order.status === 'moi') {
                actionBtn = `<button class="btn btn-warning w-100 mt-3 p-3 fs-5 fw-bold text-dark btn-action">👨‍🍳 LÀM MÓN</button>`;
                cardHeaderColor = "bg-danger";
            } else if (order.status === 'dang_lam') {
                actionBtn = `<button class="btn btn-success w-100 mt-3 p-3 fs-5 fw-bold btn-action">✅ PHỤC VỤ</button>`;
                cardHeaderColor = "bg-warning text-dark"; // Chuyển màu tiêu đề sang vàng cam
            }

            const div = document.createElement('div');
            div.className = "card mb-3 shadow";
            div.innerHTML = `
                <div class="card-header ${cardHeaderColor} text-white d-flex justify-content-between">
                    <h4 class="m-0">BÀN: ${order.table}</h4>
                    <span>${new Date(order.timestamp).toLocaleTimeString()}</span>
                </div>
                <div class="card-body">
                    ${itemDetails}
                    ${actionBtn}
                </div>`;
            
            // Xử lý sự kiện click
            div.querySelector('.btn-action').addEventListener('click', () => {
                if (order.status === 'moi') {
                    // Bước 1: Chuyển sang đang làm
                    updateOrderStatus(order.key, 'dang_lam');
                } else if (order.status === 'dang_lam') {
                    // Bước 2: Chuyển sang xong (biến mất khỏi màn hình bếp)
                    updateOrderStatus(order.key, 'xong');
                }
            });
            
            listContainer.appendChild(div);
        });
    });
}

/* ================= LOGIC THU NGÂN (ĐÃ CẬP NHẬT HIỆN LẠI ORDER) ================= */

function initCashierView() {
    document.getElementById('view-cashier').classList.remove('hidden');
    document.querySelector('.top-search-bar').classList.add('hidden');
    document.querySelector('.bottom-area').classList.add('hidden');

    const adminPanel = document.createElement('div');
    adminPanel.className = "bg-white p-3 mb-3 shadow-sm rounded border-primary border-start border-5";
    adminPanel.innerHTML = `
        <div class="d-flex justify-content-between align-items-center">
            <h5 class="m-0 text-primary fw-bold">💰 Thu Ngân & Admin</h5>
            <label class="btn btn-success btn-sm">
                <i class="fas fa-file-excel"></i> Up Excel Menu
                <input type="file" id="cashier-upload-excel" accept=".xlsx, .xls" hidden>
            </label>
        </div>`;
    const container = document.getElementById('view-cashier');
    container.insertBefore(adminPanel, container.firstChild);

    document.getElementById('cashier-upload-excel').addEventListener('change', handleFileUpload);

    const listContainer = document.getElementById('cashier-orders');
    listenForOrders((orders) => {
        listContainer.innerHTML = "";
        
        // Hiện tất cả các đơn chưa nhập vào KiotViet (Mới, Đang làm, Xong)
        const activeOrders = orders.filter(o => o.status !== 'da_nhap_kv');
        
        if(activeOrders.length === 0) listContainer.innerHTML = "<p class='text-center text-muted'>Chưa có đơn...</p>";

        activeOrders.forEach(order => {
            const itemDetails = order.items.map(i => `- ${i.name} (${i.size}) x${i.qty}`).join('<br>');
            
            // Tạo huy hiệu trạng thái cho thu ngân dễ theo dõi
            let statusBadge = "";
            if (order.status === 'moi') statusBadge = '<span class="badge bg-secondary">Khách mới gọi</span>';
            else if (order.status === 'dang_lam') statusBadge = '<span class="badge bg-warning text-dark">Bếp đang làm</span>';
            else if (order.status === 'xong') statusBadge = '<span class="badge bg-success">Bếp đã xong</span>';

            const div = document.createElement('div');
            // Nếu xong rồi thì viền xanh, chưa xong thì viền vàng
            div.className = `card mb-2 ${order.status === 'xong' ? 'border-success' : 'border-warning'}`;
            div.innerHTML = `
                <div class="card-body">
                    <div class="d-flex justify-content-between">
                        <h5 class="fw-bold">Bàn ${order.table}</h5>
                        ${statusBadge}
                    </div>
                    <div class="mt-2 mb-2 text-muted" style="font-size:0.9rem">${itemDetails}</div>
                    <div class="d-flex justify-content-between align-items-center">
                        <strong>Tổng: ${parseInt(order.totalPrice).toLocaleString()}đ</strong>
                        <button class="btn btn-primary btn-sm btn-nhap-kv">Đã nhập KiotViet</button>
                    </div>
                </div>`;
            
            div.querySelector('.btn-nhap-kv').addEventListener('click', () => {
                if(confirm("Xác nhận đơn này đã nhập vào KiotViet?")) {
                    // Cách 1: Xóa hẳn
                    deleteOrder(order.key);
                    // Cách 2: Nếu muốn lưu lịch sử thì dùng: updateOrderStatus(order.key, 'da_nhap_kv');
                }
            });
            listContainer.appendChild(div);
        });
    });
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

        if(confirm(`Cập nhật ${cleanData.length} món?`)) {
            saveMenuToDB(cleanData).then(() => alert("Xong! F5 lại web khách.")).catch(err => alert("Lỗi: " + err));
        }
    };
    reader.readAsArrayBuffer(file);
}
