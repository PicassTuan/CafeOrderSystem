// js/firebase-service.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getDatabase, ref, push, onValue, update, remove, set } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";
import { firebaseConfig } from './config.js';

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// Xuất các hàm gốc của Firebase để app.js dùng trực tiếp nếu cần
export { push, ref, set, update, remove, db };

// 1. Gửi Menu lên (Upload Excel)
export function saveMenuToDB(menuData) {
    return set(ref(db, 'menu'), menuData);
}

// 2. Lắng nghe Menu
export function listenForMenu(callback) {
    onValue(ref(db, 'menu'), (snapshot) => {
        const data = snapshot.val();
        callback(data || []);
    });
}

// 3. Gửi Order
export function sendOrderToDB(tableName, orderItems, totalCost, totalPrice) {
    // Tự động thêm status 'moi' nếu không truyền vào
    push(ref(db, 'orders'), {
        table: tableName,
        items: orderItems,
        totalPrice: totalPrice,
        totalCost: totalCost,
        status: 'moi', 
        timestamp: Date.now()
    });
}

// 4. Lắng nghe Order (Realtime)
export function listenForOrders(callback) {
    onValue(ref(db, 'orders'), (snapshot) => {
        const data = snapshot.val();
        // Chuyển object thành array
        const orders = data ? Object.entries(data).map(([key, val]) => ({key, ...val})) : [];
        // Sắp xếp mới nhất lên đầu (hoặc cũ nhất lên đầu tùy bạn)
        orders.sort((a, b) => a.timestamp - b.timestamp);
        callback(orders);
    });
}

// 5. Cập nhật trạng thái
export function updateOrderStatus(key, newStatus) {
    update(ref(db, 'orders/' + key), { status: newStatus });
}

// 6. Xóa Order
export function deleteOrder(key) {
    remove(ref(db, 'orders/' + key));
}