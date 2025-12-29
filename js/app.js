// js/app.js
import { saveMenuToDB, listenForMenu, sendOrderToDB, listenForOrders, updateOrderStatus, deleteOrder } from './firebase-service.js';

let MENU_DATA = [];
let cart = {}; // Format: { "ID_Size": soluong } (Ví dụ: "1_M": 2)
let currentModalItem = null;
let currentSearch = "";

document.addEventListener("DOMContentLoaded", () => {
    // 1. Lấy dữ liệu Menu từ Firebase
    listenForMenu((data) => {
        MENU_DATA = data;
        renderMenu(); // Vẽ lại menu khi có dữ liệu mới
    });

    // 2. Kiểm tra đang ở màn hình nào (Khách, Bếp hay Thu Ngân)
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

    // 3. Sự kiện tìm kiếm (Chỉ cho khách)
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            currentSearch = e.target.value.toLowerCase();
            renderMenu();
        });
    }
});

/* ================= LOGIC KHÁCH HÀNG ================= */

function initCustomerView(tableName) {
    document.getElementById('view-customer').classList.remove('hidden');
    document.getElementById('display-table').innerText = tableName;
    
    // Nút mở chi tiết giỏ hàng (Gửi đơn)
    document.querySelector('.cart-status-bar').addEventListener('click', () => {
        submitOrder(tableName);
    });
}

function renderMenu() {
    const container = document.getElementById('menu-container');
    if (!container) return; // Nếu đang ở view Bếp/Thu ngân thì bỏ qua
    container.innerHTML = "";

    const filteredData = MENU_DATA.filter(item => 
        item.TenMon.toLowerCase().includes(currentSearch)
    );

    filteredData.forEach(item => {
        // Kiểm tra món này có trong giỏ chưa để hiện số
        let qtyDisplay = 0;
        if(item.hasMultiSize) {
            const qtyM = cart[`${item.id}_M`] || 0;
            const qtyL = cart[`${item.id}_L`] || 0;
            qtyDisplay = qtyM + qtyL;
        } else {
            qtyDisplay = cart[`${item.id}_M`] || 0; // Món 1 size mặc định là M
        }

        // Tạo nút bấm tùy loại món
        let btnHtml = "";
        if (item.hasMultiSize) {
            // Món 2 Size -> Luôn hiện nút mở Popup
            btnHtml = `<button class="btn-add-cart" onclick="openMultiSizeModal(${item.id})">
                        ${qtyDisplay > 0 ? 'Đã chọn: ' + qtyDisplay : 'Thêm vào đơn'}
                       </button>`;
        } else {
            // Món 1 Size -> Cộng trừ trực tiếp
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

// Xử lý Popup chọn Size
window.openMultiSizeModal = function(id) {
    const item = MENU_DATA.find(i => i.id == id);
    currentModalItem = item;

    document.getElementById('modal-title').innerText = item.TenMon;
    document.getElementById('modal-desc').innerText = item.MoTa;
    document.getElementById('modal-img').src = item.img;
    
    document.getElementById('qty-M').innerText = cart[`${id}_M`] || 0;
    document.getElementById('qty-L').innerText = cart[`${id}_L`] || 0;
    
    // Hiện giá lên popup để khách biết
    document.querySelector('.size-row:nth-child(2) .size-label').innerHTML = `SIZE M <small style="font-size:12px">(${parseInt(item.GiaM).toLocaleString()}đ)</small>`;
    document.querySelector('.size-row:nth-child(3) .size-label').innerHTML = `SIZE L <small style="font-size:12px">(${parseInt(item.GiaL).toLocaleString()}đ)</small>`;

    document.getElementById('size-modal').classList.remove('hidden');
}

window.closeModal = function() {
    document.getElementById('size-modal').classList.add('hidden');
    renderMenu(); // Update lại nút bên ngoài
}

// Hàm cập nhật số lượng chung (Dùng cả cho nút ngoài và popup)
window.updateQty = function(key, change) {
    if (!cart[key]) cart[key] = 0;
    cart[key] += change;
    if (cart[key] <= 0) delete cart[key];
    
    renderMenu(); 
}

// Hàm cập nhật số lượng trong Popup (Size M/L)
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
            
            items.push({
                name: item.TenMon,
                size: size,
                qty: qty,
                price: price
            });
            totalPrice += price * qty;
            totalCost += cost * qty;
        }
    }

    if (items.length === 0) {
        alert("Bạn chưa chọn món nào!");
        return;
    }

    if(confirm(`Xác nhận gọi ${items.length} món? Tổng: ${totalPrice.toLocaleString()}đ`)) {
        sendOrderToDB(tableName, items, totalCost, totalPrice);
        cart = {}; // Xóa giỏ
        renderMenu();
        alert("Đã gửi đơn xuống bếp!");
    }
}

/* ================= LOGIC THU NGÂN ================= */

function initCashierView() {
    document.getElementById('view-cashier').classList.remove('hidden');
    // Ẩn giao diện khách
    document.querySelector('.top-search-bar').classList.add('hidden');
    document.querySelector('.bottom-area').classList.add('hidden');

    // Tạo thanh công cụ Admin
    const adminPanel = document.createElement('div');
    adminPanel.className = "bg-white p-3 mb-3 shadow-sm rounded border-primary border-start border-5";
    adminPanel.innerHTML = `
        <div class="d-flex justify-content-between align-items-center">
            <h5 class="m-0 text-primary fw-bold">💰 Thu Ngân & Admin</h5>
            <label class="btn btn-success btn-sm">
                <i class="fas fa-file-excel"></i> Cập nhật Menu (Excel)
                <input type="file" id="cashier-upload-excel" accept=".xlsx, .xls" hidden>
            </label>
        </div>
    `;
    const container = document.getElementById('view-cashier');
    container.insertBefore(adminPanel, container.firstChild);

    // Sự kiện Upload Excel
    document.getElementById('cashier-upload-excel').addEventListener('change', handleFileUpload);

    // Hiển thị danh sách đơn
    const listContainer = document.getElementById('cashier-orders');
    listenForOrders((orders) => {
        listContainer.innerHTML = "";
        const activeOrders = orders.filter(o => o.status !== 'da_nhap_kv');
        
        if(activeOrders.length === 0) listContainer.innerHTML = "<p class='text-center text-muted'>Chưa có đơn hàng nào.</p>";

        activeOrders.forEach(order => {
            const itemDetails = order.items.map(i => `- ${i.name} (${i.size}) x${i.qty}`).join('<br>');
            const isDone = order.status === 'xong';
            
            const div = document.createElement('div');
            div.className = `card mb-2 ${isDone ? 'border-success' : 'border-warning'}`;
            div.innerHTML = `
                <div class="card-body">
                    <div class="d-flex justify-content-between">
                        <h5 class="fw-bold">Bàn ${order.table}</h5>
                        <span class="badge ${isDone ? 'bg-success' : 'bg-warning text-dark'}">
                            ${isDone ? 'Bếp đã xong' : 'Bếp đang làm'}
                        </span>
                    </div>
                    <div class="mt-2 mb-2 text-muted" style="font-size:0.9rem">${itemDetails}</div>
                    <div class="d-flex justify-content-between align-items-center">
                        <strong>Tổng: ${parseInt(order.totalPrice).toLocaleString()}đ</strong>
                        <button class="btn btn-primary btn-sm btn-nhap-kv">Đã nhập KiotViet</button>
                    </div>
                </div>
            `;
            div.querySelector('.btn-nhap-kv').addEventListener('click', () => {
                if(confirm("Đã nhập đơn này vào KiotViet?")) {
                    deleteOrder(order.key);
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
            id: item.ID,
            TenMon: item.TenMon,
            MoTa: item.MoTa || "",
            PhanLoai: item.PhanLoai || "TP",
            img: item.HinhAnh || "https://via.placeholder.com/100",
            hasMultiSize: !!item.Co2Size, 
            GiaM: item.GiaM || 0,
            VonM: item.VonM || 0,
            GiaL: item.GiaL || 0,
            VonL: item.VonL || 0
        }));

        if(confirm(`Tìm thấy ${cleanData.length} món. Cập nhật?`)) {
            saveMenuToDB(cleanData)
                .then(() => alert("Cập nhật thành công!"))
                .catch(err => alert("Lỗi: " + err));
        }
    };
    reader.readAsArrayBuffer(file);
}

/* ================= LOGIC BẾP ================= */

function initKitchenView() {
    document.getElementById('view-kitchen').classList.remove('hidden');
    // Ẩn giao diện khách
    document.querySelector('.top-search-bar').classList.add('hidden');
    document.querySelector('.bottom-area').classList.add('hidden');

    const listContainer = document.getElementById('kitchen-orders');
    listenForOrders((orders) => {
        listContainer.innerHTML = "";
        const activeOrders = orders.filter(o => o.status === 'moi');

        if(activeOrders.length === 0) listContainer.innerHTML = "<p class='text-center text-white'>Bếp đang rảnh rỗi...</p>";

        activeOrders.forEach(order => {
            const itemDetails = order.items.map(i => `<div class="fs-5 fw-bold">- ${i.name} (${i.size}) <span class="text-danger">x${i.qty}</span></div>`).join('');
            
            const div = document.createElement('div');
            div.className = "card mb-3 shadow";
            div.innerHTML = `
                <div class="card-header bg-danger text-white d-flex justify-content-between">
                    <h4 class="m-0">BÀN: ${order.table}</h4>
                    <span>${new Date(order.timestamp).toLocaleTimeString()}</span>
                </div>
                <div class="card-body">
                    ${itemDetails}
                    <button class="btn btn-success w-100 mt-3 p-3 fs-5 fw-bold btn-xong">XONG</button>
                </div>
            `;
            div.querySelector('.btn-xong').addEventListener('click', () => {
                updateOrderStatus(order.key, 'xong');
            });
            listContainer.appendChild(div);
        });
    });
}