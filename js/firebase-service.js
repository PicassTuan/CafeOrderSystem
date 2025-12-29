// js/firebase-service.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getDatabase, ref, push, onValue, update, remove, set } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";
import { firebaseConfig } from './config.js';

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// Gửi menu lên Firebase (Dùng cho upload Excel)
export function saveMenuToDB(menuData) {
    return set(ref(db, 'menu'), menuData);
}

// Lắng nghe Menu thay đổi
export function listenForMenu(callback) {
    onValue(ref(db, 'menu'), (snapshot) => {
        const data = snapshot.val();
        callback(data || []);
    });
}

// Gửi Order mới
export function sendOrderToDB(tableName, orderItems, totalCost, totalPrice) {
    push(ref(db, 'orders'), {
        table: tableName,
        items: orderItems, // Mảng các món
        totalPrice: totalPrice, // Doanh thu
        totalCost: totalCost,   // Giá vốn (để tính lãi sau này)
        status: 'moi', 
        timestamp: Date.now()
    });
}

// Lắng nghe Order (Cho Bếp & Thu Ngân)
export function listenForOrders(callback) {
    onValue(ref(db, 'orders'), (snapshot) => {
        const data = snapshot.val();
        const orders = data ? Object.entries(data).map(([key, val]) => ({key, ...val})) : [];
        orders.sort((a, b) => a.timestamp - b.timestamp);
        callback(orders);
    });
}

// Cập nhật trạng thái (Xong/Đã nhập KV)
export function updateOrderStatus(key, newStatus) {
    update(ref(db, 'orders/' + key), { status: newStatus });
}

// Xóa Order
export function deleteOrder(key) {
    remove(ref(db, 'orders/' + key));
}