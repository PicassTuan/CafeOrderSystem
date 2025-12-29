// js/app.js
import { sendOrderToDB } from './firebase-service.js';

// --- CẤU TRÚC DỮ LIỆU TỪ EXCEL ---
// PhanLoai: TS, THQ, SCL, NE, DUST, DXPK, CF, ST, KT, DUN, AV, TP
// hasMultiSize: true (có 2 size - hiện popup), false (1 size - hiện cộng trừ)
const MENU_DATA = [
    { id: 1, TenMon: "Trà sữa xoài", MoTa: "Thơm ngon mát lạnh", Gia: 35000, Von: 15000, PhanLoai: "TS", hasMultiSize: false, img: "https://via.placeholder.com/100" },
    { id: 2, TenMon: "Trà sữa Mộc Hương", MoTa: "Đậm vị trà", Gia: 35000, Von: 10000, PhanLoai: "TS", hasMultiSize: true, img: "https://i.ibb.co/jkKHt8Gg/Hinh-Web-OKINAWA-TR-S-A.png" }, // Món này có 2 size
    { id: 3, TenMon: "Trà sữa Kem trứng", MoTa: "Béo ngậy", Gia: 35000, Von: 12000, PhanLoai: "TS", hasMultiSize: false, img: "https://via.placeholder.com/100" },
    { id: 4, TenMon: "Cà phê đen", MoTa: "Đậm đà", Gia: 25000, Von: 5000, PhanLoai: "CF", hasMultiSize: false, img: "https://via.placeholder.com/100" },
    { id: 5, TenMon: "Hướng dương", MoTa: "Giòn tan", Gia: 15000, Von: 5000, PhanLoai: "AV", hasMultiSize: false, img: "https://via.placeholder.com/100" }
];

// Danh sách phân loại
const CATEGORIES = [
    { code: "ALL", name: "Tất cả" },
    { code: "TS", name: "Trà sữa" },
    { code: "THQ", name: "Trà hoa quả" },
    { code: "SCL", name: "Sữa chua lắc" },
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

// Biến lưu giỏ hàng tạm thời trên máy khách: { id_mon: so_luong }
let cart = {}; 
let currentCategory = "ALL";
let currentSearch = "";
let tableNumber = "";

document.addEventListener("DOMContentLoaded", () => {
    // Lấy số bàn từ URL
    const urlParams = new URLSearchParams(window.location.search);
    tableNumber = urlParams.get('ban') || "Mang Về";
    document.getElementById('display-table').innerText = tableNumber;

    renderCategories();
    renderMenu();

    // Sự kiện tìm kiếm
    document.getElementById('search-input').addEventListener('input', (e) => {
        currentSearch = e.target.value.toLowerCase();
        renderMenu();
    });
});

// 1. Render Thanh Phân Loại
function renderCategories() {
    const catContainer = document.getElementById('category-list');
    catContainer.innerHTML = "";
    
    CATEGORIES.forEach(cat => {
        const btn = document.createElement('div');
        btn.className = `cat-chip ${cat.code === currentCategory ? 'active' : ''}`;
        btn.innerText = cat.name;
        btn.onclick = () => {
            currentCategory = cat.code;
            renderCategories(); // Vẽ lại để cập nhật màu active
            renderMenu();
        };
        catContainer.appendChild(btn);
    });
}

// 2. Render Menu Chính
function renderMenu() {
    const container = document.getElementById('menu-container');
    container.innerHTML = "";

    // Lọc dữ liệu
    const filteredData = MENU_DATA.filter(item => {
        const matchCat = currentCategory === "ALL" || item.PhanLoai === currentCategory;
        const matchSearch = item.TenMon.toLowerCase().includes(currentSearch);
        return matchCat && matchSearch;
    });

    filteredData.forEach(item => {
        const qty = cart[item.id] || 0; // Số lượng hiện tại trong giỏ

        // Xác định giao diện nút bấm
        let actionBtnHtml = "";
        
        if (item.hasMultiSize) {
            // Trường hợp 1: Món có 2 size -> Luôn hiện nút "Thêm vào đơn" để mở Popup
            actionBtnHtml = `<button class="btn-add-cart" onclick="openMultiSizeModal(${item.id})">Thêm vào đơn</button>`;
        } else {
            // Trường hợp 2: Món 1 size -> Hiện +/-
            if (qty === 0) {
                actionBtnHtml = `<button class="btn-add-cart" onclick="updateQty(${item.id}, 1)">Thêm vào đơn</button>`;
            } else {
                actionBtnHtml = `
                    <div class="qty-control">
                        <button class="qty-btn" onclick="updateQty(${item.id}, -1)">-</button>
                        <span class="qty-num">${qty}</span>
                        <button class="qty-btn" onclick="updateQty(${item.id}, 1)">+</button>
                    </div>
                `;
            }
        }

        const div = document.createElement('div');
        div.className = "container";
        div.innerHTML = `
            <div class="item-card">
                <img src="${item.img}" class="item-img">
                <div class="item-info">
                    <div>
                        <h5 class="item-title">${item.TenMon}</h5>
                        <p class="item-desc">${item.MoTa}</p>
                    </div>
                    <div class="d-flex justify-content-between align-items-end">
                        <span class="item-price">${item.Gia.toLocaleString()} đ</span>
                        ${actionBtnHtml}
                    </div>
                </div>
            </div>
        `;
        container.appendChild(div);
    });

    updateBottomStatus();
}

// 3. Hàm Update số lượng (Cho món 1 size)
window.updateQty = function(id, change) {
    if (!cart[id]) cart[id] = 0;
    cart[id] += change;
    if (cart[id] <= 0) delete cart[id];
    renderMenu(); // Vẽ lại để cập nhật nút bấm
}

// 4. Hàm xử lý món nhiều size (Chờ thiết kế sau)
window.openMultiSizeModal = function(id) {
    alert("Chức năng chọn size sẽ hiển thị ở màn hình thiết kế sau!");
}

// 5. Cập nhật thanh trạng thái dưới cùng
function updateBottomStatus() {
    let totalCount = 0;
    let totalPrice = 0;

    for (const [id, qty] of Object.entries(cart)) {
        const item = MENU_DATA.find(i => i.id == id);
        if (item) {
            totalCount += qty;
            totalPrice += item.Gia * qty;
        }
    }

    document.getElementById('total-count').innerText = totalCount;
    document.getElementById('total-price').innerText = totalPrice.toLocaleString() + " đ";
}

// 6. Sự kiện bấm vào thanh dưới cùng (Mũi tên lên)
window.openCartDetails = function() {
    alert("Sẽ mở màn hình chi tiết giỏ hàng (Thiết kế sau)");

}

