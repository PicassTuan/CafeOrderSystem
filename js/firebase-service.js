// js/firebase-service.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getDatabase, ref, push, onValue, update, remove } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";
import { firebaseConfig } from './config.js';

// Khởi tạo
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// Hàm gửi order mới (Dành cho Khách)
export function sendOrderToDB(tableName, itemData) {
    push(ref(db, 'orders'), {
        table: tableName,
        item: itemData.name,
        price: itemData.price,
        status: 'moi', // Các trạng thái: moi -> xong -> da_nhap_kv
        timestamp: Date.now()
    });
}

// Hàm lắng nghe thay đổi dữ liệu (Dành cho Bếp & Thu Ngân)
export function listenForOrders(callback) {
    onValue(ref(db, 'orders'), (snapshot) => {
        const data = snapshot.val();
        const orders = data ? Object.entries(data).map(([key, val]) => ({key, ...val})) : [];
        // Sắp xếp theo thời gian
        orders.sort((a, b) => a.timestamp - b.timestamp);
        callback(orders);
    });
}

// Hàm cập nhật trạng thái (Bếp bấm xong / Thu ngân bấm nhập)
export function updateOrderStatus(key, newStatus) {
    update(ref(db, 'orders/' + key), { status: newStatus });
}

// Hàm xóa order (Nếu cần)
export function deleteOrder(key) {
    remove(ref(db, 'orders/' + key));
}