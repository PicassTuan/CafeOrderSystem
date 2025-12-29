// js/app.js
import { sendOrderToDB, listenForOrders, updateOrderStatus, deleteOrder } from './firebase-service.js';

// --- CẤU HÌNH MENU (SỬA MÓN ĂN Ở ĐÂY) ---
const MENU_DATA = [
    { id: 1, name: "Cà phê đen", price: 20000, img: "☕" },
    { id: 2, name: "Cà phê sữa", price: 25000, img: "🥛" },
    { id: 3, name: "Bạc xỉu", price: 28000, img: "🧉" },
    { id: 4, name: "Trà đào cam sả", price: 35000, img: "🍑" },
    { id: 5, name: "Nước cam", price: 30000, img: "🍊" }
];

// --- KHỞI CHẠY ỨNG DỤNG ---
document.addEventListener("DOMContentLoaded", () => {
    const urlParams = new URLSearchParams(window.location.search);
    const view = urlParams.get('view'); // Lấy tham số ?view=
    const table = urlParams.get('ban') || "Mang Về";

    if (view === 'bep') {
        initKitchenView();
    } else if (view === 'thungan') {
        initCashierView();
    } else {
        initCustomerView(table);
    }
});

// 1. LOGIC KHÁCH HÀNG
function initCustomerView(tableName) {
    document.getElementById('view-customer').classList.remove('hidden');
    document.getElementById('table-number').innerText = `Bàn: ${tableName}`;
    
    const menuContainer = document.getElementById('menu-list');
    
    MENU_DATA.forEach(item => {
        const div = document.createElement('div');
        div.className = 'col-6 col-md-4 col-lg-3 mb-3';
        div.innerHTML = `
            <div class="card h-100 shadow-sm border-0">
                <div class="card-body text-center p-2">
                    <div class="display-4 mb-2">${item.img}</div>
                    <h6 class="card-title fw-bold">${item.name}</h6>
                    <p class="text-primary fw-bold">${item.price.toLocaleString()}đ</p>
                    <button class="btn btn-dark w-100 btn-sm btn-order" data-id="${item.id}">Gọi món</button>
                </div>
            </div>
        `;
        menuContainer.appendChild(div);
        
        // Gán sự kiện click
        div.querySelector('.btn-order').addEventListener('click', () => {
            if(confirm(`Gọi món ${item.name} cho ${tableName}?`)) {
                sendOrderToDB(tableName, item);
                alert("Đã gửi order!");
            }
        });
    });
}

// 2. LOGIC BẾP
function initKitchenView() {
    document.getElementById('view-kitchen').classList.remove('hidden');
    const listContainer = document.getElementById('kitchen-orders');

    listenForOrders((orders) => {
        listContainer.innerHTML = ''; // Xóa cũ vẽ mới
        // Lọc chỉ lấy món chưa làm xong (status = 'moi')
        const activeOrders = orders.filter(o => o.status === 'moi');

        if (activeOrders.length === 0) {
            listContainer.innerHTML = '<p class="text-center text-muted">Hiện chưa có món nào...</p>';
            return;
        }

        activeOrders.forEach(order => {
            const div = document.createElement('div');
            div.className = 'alert alert-warning d-flex justify-content-between align-items-center shadow-sm';
            div.innerHTML = `
                <div>
                    <span class="badge bg-dark mb-1">Bàn ${order.table}</span>
                    <h4 class="mb-0 fw-bold">${order.item}</h4>
                    <small class="text-muted">${new Date(order.timestamp).toLocaleTimeString()}</small>
                </div>
                <button class="btn btn-success btn-lg">Xong</button>
            `;
            // Nút Xong
            div.querySelector('button').addEventListener('click', () => {
                updateOrderStatus(order.key, 'xong');
            });
            listContainer.appendChild(div);
        });
    });
}

// 3. LOGIC THU NGÂN
function initCashierView() {
    document.getElementById('view-cashier').classList.remove('hidden');
    const listContainer = document.getElementById('cashier-orders');

    listenForOrders((orders) => {
        listContainer.innerHTML = '';
        // Lọc lấy món 'moi' hoặc 'xong', loại bỏ món đã nhập kiotviet
        const activeOrders = orders.filter(o => o.status !== 'da_nhap_kv');

        activeOrders.forEach(order => {
            const isDone = order.status === 'xong';
            const div = document.createElement('div');
            div.className = `card mb-2 ${isDone ? 'border-success' : 'border-warning'}`;
            div.innerHTML = `
                <div class="card-body d-flex justify-content-between align-items-center p-2">
                    <div>
                        <span class="fw-bold">Bàn ${order.table}</span>: ${order.item}
                        <br>
                        ${isDone 
                            ? '<span class="badge bg-success">Bếp đã xong</span>' 
                            : '<span class="badge bg-warning text-dark">Đang làm...</span>'}
                    </div>
                    <button class="btn btn-outline-primary btn-sm">Đã nhập KiotViet</button>
                </div>
            `;
            
            // Nút xác nhận nhập KiotViet
            div.querySelector('button').addEventListener('click', () => {
                if(confirm("Xác nhận đã nhập món này vào KiotViet?")) {
                    // Cách 1: Xóa luôn (Sạch data)
                    deleteOrder(order.key);
                    // Cách 2: updateOrderStatus(order.key, 'da_nhap_kv'); (Lưu vết)
                }
            });
            listContainer.appendChild(div);
        });
    });
}