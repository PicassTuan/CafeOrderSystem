import { saveMenuToDB, listenForMenu, sendOrderToDB, listenForOrders, updateOrderStatus, deleteOrder } from './firebase-service.js';

// --- CẤU HÌNH ---
const BANK_QR_URL = "https://img.vietqr.io/image/MB-0349315099-compact.png"; 

// --- BIẾN TOÀN CỤC ---
let MENU_DATA = [];
let cart = {}; 
let dbOrders = []; 
let currentTable = "Mang Về";
let currentCategory = "ALL";
let currentSearch = "";
let currentItemForModal = null; // Biến tạm cho modal size
let splitSelectedItems = []; // Biến tạm cho tách bill

const CATEGORIES = [
    { code: "ALL", name: "Tất cả" }, { code: "TS", name: "Trà sữa" },
    { code: "THQ", name: "Trà hoa quả" }, { code: "SCL", name: "Sữa chua" },
    { code: "CF", name: "Cà phê" }, { code: "TP", name: "Topping" }, 
    { code: "AV", name: "Ăn vặt" }
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
        dbOrders = orders;
        if (view === 'bep') initKitchenView(orders);
        if (view === 'thungan') initCashierView(orders);
        // Nếu đang mở giỏ hàng thì update lại realtime
        if (!view && !document.getElementById('cart-modal').classList.contains('hidden')) {
            openCartDetails();
        }
        if(!view) updateBottomBar();
    });

    if (!view) initCustomerView();
    if (view === 'bep') document.getElementById('view-kitchen').classList.remove('hidden');
    if (view === 'thungan') document.getElementById('view-cashier').classList.remove('hidden');

    // Sự kiện upload file excel cho thu ngân
    const uploadInput = document.getElementById('cashier-upload-excel');
    if(uploadInput) uploadInput.addEventListener('change', handleFileUpload);

    const searchInput = document.getElementById('search-input');
    if(searchInput) searchInput.addEventListener('input', (e) => {
        currentSearch = e.target.value.toLowerCase();
        renderMenu();
    });
});

/* ==================== 1. LOGIC KHÁCH HÀNG ==================== */

function initCustomerView() {
    document.getElementById('view-customer').classList.remove('hidden');
    // document.getElementById('display-table').innerText = currentTable; // (Đã có logic updateBottomBar lo)
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
        // Tính số lượng trong giỏ (Local)
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
                    <div class="qty-control-inline">
                        <button onclick="removeRecentItem(${item.id})">-</button>
                        <span>${currentQty}</span>
                        <button onclick="addToCart(${item.id})">+</button>
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
    const keys = Object.keys(cart).filter(k => cart[k].item.id === itemId && cart[k].size === 'M');
    if (keys.length > 0) {
        const keyToRemove = keys[keys.length - 1];
        delete cart[keyToRemove];
    }
    renderMenu();
    updateBottomBar();
}

function openMultiSizeModal(id) {
    const item = MENU_DATA.find(i => i.id == id);
    document.getElementById('modal-title').innerText = item.TenMon;
    document.getElementById('modal-desc').innerText = item.MoTa;
    document.getElementById('modal-img').src = item.img;
    document.getElementById('qty-M').innerText = "0";
    document.getElementById('qty-L').innerText = "0";
    currentItemForModal = item;
    document.getElementById('size-modal').classList.remove('hidden');
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
}

function updateBottomBar() {
    let count = 0; let total = 0;
    // Tổng cart local
    Object.values(cart).forEach(order => {
        count += order.qty;
        total += (order.price * order.qty);
        order.toppings.forEach(tp => total += tp.price);
    });
    // Tổng đã gọi (DB) - hiển thị tổng cả bàn
    const myTableOrders = dbOrders.filter(o => o.table == currentTable && o.status !== 'split_paid');
    myTableOrders.forEach(o => {
        if(o.items[0]?.name.includes("Yêu cầu TT")) return;
        o.items.forEach(i => {
            count += i.qty;
            total += (i.price * i.qty);
            if(i.toppings) i.toppings.forEach(t => total += t.price);
        });
    });

    document.getElementById('display-table').innerText = currentTable;
    document.getElementById('total-count').innerText = count;
    document.getElementById('total-price').innerText = total.toLocaleString() + "đ";
}

// --- GIỎ HÀNG CHI TIẾT ---
function openCartDetails() {
    const list = document.getElementById('cart-items-list');
    list.innerHTML = "";
    
    // 1. Render Món ĐÃ GỌI
    const historyOrders = dbOrders.filter(o => o.table == currentTable).sort((a,b) => b.timestamp - a.timestamp);
    historyOrders.forEach(batch => {
        if (batch.status === 'split_paid') return;
        if (batch.items[0]?.name.includes("Yêu cầu TT")) return; // Ẩn đơn yêu cầu thanh toán

        const timeStr = new Date(batch.timestamp).toLocaleTimeString();
        list.innerHTML += `<div class="time-divider">Giờ gọi: ${timeStr} <span class="badge-status bg-ordered">Đã gọi</span></div>`;
        
        batch.items.forEach(item => {
            const topStr = item.toppings ? item.toppings.map(t => `<span class="topping-tag">${t.name}</span>`).join('') : '';
            list.innerHTML += `
                <div class="cart-item-row" style="background:#f8f9fa; border-left: 3px solid #198754;">
                    <div class="d-flex justify-content-between">
                        <div><b>${item.name} (${item.size})</b> <br> <small>${item.price.toLocaleString()}đ</small></div>
                        <div class="fw-bold">x${item.qty}</div>
                    </div>
                    <div class="text-muted small"><i>${item.note || ''}</i></div>
                    <div>${topStr}</div>
                </div>`;
        });
    });

    // 2. Render Món CHƯA GỌI
    if (Object.keys(cart).length > 0) {
        list.innerHTML += `<div class="time-divider">Hiện tại <span class="badge-status bg-draft">Chưa gọi</span></div>`;
        
        Object.entries(cart).forEach(([key, order]) => {
            const topHtml = order.toppings.map(tp => 
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
                    <div class="mt-1">${topHtml}</div>
                    <div class="text-end mt-2">
                        <button class="btn btn-sm btn-outline-primary p-0 px-2" style="font-size:10px" onclick="showToppingSelector('${key}')">+ Topping</button>
                    </div>
                </div>`;
        });
    }

    // Logic nút Footer
    const hasLocal = Object.keys(cart).length > 0;
    const hasHistory = historyOrders.length > 0;
    
    document.getElementById('btn-send-order').disabled = !hasLocal;
    
    // Nút chức năng chỉ sáng khi: KHÔNG CÓ món mới VÀ ĐÃ CÓ lịch sử gọi
    const canAction = !hasLocal && hasHistory;
    ['btn-bill', 'btn-split', 'btn-pay'].forEach(id => {
        const btn = document.getElementById(id);
        if(canAction) {
            btn.disabled = false;
            btn.classList.remove('disabled-action', 'btn-outline-secondary');
            btn.classList.add('btn-primary');
        } else {
            btn.disabled = true;
            btn.classList.add('disabled-action', 'btn-outline-secondary');
            btn.classList.remove('btn-primary');
        }
    });

    document.getElementById('cart-modal').classList.remove('hidden');
}

function closeCartDetails() { document.getElementById('cart-modal').classList.add('hidden'); }

function changeCartQty(key, delta) {
    if (cart[key]) {
        cart[key].qty += delta;
        if (cart[key].qty <= 0) delete cart[key];
        renderMenu(); updateBottomBar(); openCartDetails();
    }
}
function updateNote(key, val) { if(cart[key]) cart[key].note = val; }
function removeTopping(key, tpId) {
    cart[key].toppings = cart[key].toppings.filter(t => t.id !== tpId);
    updateBottomBar(); openCartDetails();
}
function showToppingSelector(key) {
    const tps = MENU_DATA.filter(i => i.PhanLoai === 'TP');
    const html = tps.map(t => `<li class="list-group-item d-flex justify-content-between" onclick="selectTopping('${key}',${t.id})"><span>${t.TenMon}</span> <b>+${t.GiaM}</b></li>`).join('');
    document.getElementById('cart-items-list').innerHTML = `<div class="bg-white p-3 rounded"><h5>Chọn Topping</h5><ul class="list-group">${html}</ul><button class="btn btn-secondary w-100 mt-2" onclick="openCartDetails()">Quay lại</button></div>`;
}
function selectTopping(key, tId) {
    const t = MENU_DATA.find(i => i.id == tId);
    cart[key].toppings.push({ id: t.id, name: t.TenMon, price: t.GiaM });
    updateBottomBar(); openCartDetails();
}

function submitOrder() {
    if(confirm("Gửi món xuống bếp?")) {
        const items = Object.values(cart).map(c => ({
            name: c.item.TenMon, size: c.size, qty: c.qty, price: c.price,
            note: c.note, toppings: c.toppings
        }));
        let total = 0; items.forEach(i => { total += (i.price * i.qty); if(i.toppings) i.toppings.forEach(t => total += t.price); });
        
        sendOrderToDB(currentTable, items, 0, total);
        cart = {}; 
        alert("Gọi món thành công!");
        renderMenu(); updateBottomBar(); openCartDetails();
    }
}

// --- THANH TOÁN RIÊNG ---
function openSplitBillModal() {
    const list = document.getElementById('split-items-list');
    list.innerHTML = "";
    splitSelectedItems = [];
    const orders = dbOrders.filter(o => o.table == currentTable && o.status !== 'split_paid');
    
    let index = 0;
    orders.forEach(batch => {
        if(batch.items[0]?.name.includes("Yêu cầu TT")) return;
        batch.items.forEach(item => {
            const itemTotal = (item.price * item.qty) + (item.toppings ? item.toppings.reduce((a,b)=>a+b.price,0) : 0);
            const splitId = `${batch.key}_${index}`;
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
function toggleSplitItem(id, price, name, batchKey) {
    const chk = document.getElementById(`chk_${id}`);
    if(chk.checked) splitSelectedItems.push({ id, price, name, batchKey });
    else splitSelectedItems = splitSelectedItems.filter(i => i.id !== id);
    const total = splitSelectedItems.reduce((a,b) => a + b.price, 0);
    document.getElementById('split-total').innerText = total.toLocaleString() + "đ";
}
function proceedSplitPayment() {
    if(splitSelectedItems.length === 0) { alert("Chưa chọn món nào!"); return; }
    const total = splitSelectedItems.reduce((a,b) => a + b.price, 0);
    document.getElementById('pay-amount').innerText = total.toLocaleString() + "đ";
    document.getElementById('payment-method-modal').classList.remove('hidden');
    document.getElementById('split-modal').classList.add('hidden');
    document.getElementById('qr-display').classList.add('hidden');
    document.getElementById('cash-display').classList.add('hidden');
}
function showQR() {
    document.getElementById('qr-display').classList.remove('hidden');
    document.getElementById('cash-display').classList.add('hidden');
    document.getElementById('qr-img').src = BANK_QR_URL;
    document.getElementById('qr-desc').innerText = `ND: Bàn ${currentTable}`;
}
function showCashInstruction() {
    document.getElementById('qr-display').classList.add('hidden');
    document.getElementById('cash-display').classList.remove('hidden');
}
function confirmTransfer() {
    if(confirm("Xác nhận đã chuyển khoản?")) {
        const total = splitSelectedItems.reduce((a,b) => a + b.price, 0);
        const reqData = {
            table: currentTable,
            items: [{ name: "Yêu cầu TT Riêng ("+splitSelectedItems.length+" món)", size: "", qty: 1, price: total }],
            totalPrice: total,
            status: 'payment_request',
            timestamp: Date.now()
        };
        // Gửi qua hàm sendOrderToDB nhưng ghi đè status trong object (nếu hàm sendOrderToDB hỗ trợ, hoặc dùng push trực tiếp)
        // Vì hàm sendOrderToDB mặc định set status='moi', nên ở đây ta gọi xong sẽ update lại ngay hoặc sửa hàm sendOrderToDB
        // Cách nhanh: Import { push, ref, db } và gọi trực tiếp
        // Ở đây tôi dùng biến thể: Gọi sendOrderToDB rồi sửa tay trong code
        // ĐỂ ĐƠN GIẢN: Ta sửa hàm sendOrderToDB trong firebase-service.js để nhận status
        // NHƯNG ĐỂ KHÔNG SỬA FILE KIA: Ta import push từ firebase-service
        
        // *Quan trọng*: Nếu bạn chưa export `push` từ firebase-service.js, code này sẽ lỗi.
        // Giả sử bạn ĐÃ SỬA firebase-service.js như bài trước.
        // Tôi sẽ dùng object import ở đầu file.
        
        // Gửi request
        // Lưu ý: Nếu firebase-service export push, ta dùng push.
        // Nếu không, ta dùng sendOrderToDB và chấp nhận nó hiện ở bếp (nhưng ta đã filter tên món ở bếp nên không sao)
        sendOrderToDB(currentTable, reqData.items, 0, total); 
        
        alert("Đã gửi yêu cầu. Vui lòng đợi thu ngân xác nhận.");
        document.getElementById('payment-method-modal').classList.add('hidden');
    }
}
function closePaymentModal() { document.getElementById('payment-method-modal').classList.add('hidden'); }

// --- BILL ---
function requestBill() {
    const html = generateBillHtml(currentTable);
    document.getElementById('bill-content').innerHTML = html;
    document.getElementById('bill-modal').classList.remove('hidden');
}
function generateBillHtml(tId) {
    const orders = dbOrders.filter(o => o.table == tId);
    let html = `<div class="text-center fw-bold">HÓA ĐƠN TẠM TÍNH<br>Bàn ${tId}</div><hr>`;
    let total = 0;
    orders.forEach(batch => {
        if(batch.items[0]?.name.includes("Yêu cầu TT")) return;
        batch.items.forEach(i => {
            const iTotal = (i.price*i.qty) + (i.toppings?i.toppings.reduce((a,b)=>a+b.price,0):0);
            total += iTotal;
            const top = i.toppings?.length ? `<br><small>+${i.toppings.map(t=>t.name)}</small>` : '';
            html += `<div class="d-flex justify-content-between mb-1"><span>${i.name} (${i.size}) x${i.qty} ${top}</span><span>${iTotal.toLocaleString()}</span></div>`;
        });
    });
    html += `<hr><div class="d-flex justify-content-between fw-bold"><span>TỔNG:</span><span>${total.toLocaleString()}đ</span></div>`;
    html += `<div class="text-center mt-3"><img src="${BANK_QR_URL}" style="width:100px"><br><small>Quét mã thanh toán</small></div>`;
    return html;
}
function downloadBill() {
    html2canvas(document.getElementById('bill-content')).then(c => {
        const link = document.createElement('a'); link.download="Bill.png"; link.href=c.toDataURL(); link.click();
    });
}

// --- THU NGÂN ---
function initCashierView(orders) {
    const grid = document.getElementById('table-grid');
    grid.innerHTML = "";
    const tables = [...new Set(orders.map(o => o.table))];
    tables.forEach(t => {
        const hasReq = orders.some(o => o.table == t && o.items[0]?.name.includes("Yêu cầu TT"));
        const col = document.createElement('div'); col.className = "col-4 col-md-3";
        col.innerHTML = `<div class="table-btn active" onclick="showTableBill('${t}')"><h4>${t}</h4>${hasReq?'<div class="red-dot"></div>':''}</div>`;
        grid.appendChild(col);
    });
}
function showTableBill(tId) {
    const html = generateBillHtml(tId);
    document.getElementById('bill-content').innerHTML = html;
    document.getElementById('bill-modal').classList.remove('hidden');
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
        if(confirm(`Cập nhật ${cleanData.length} món?`)) saveMenuToDB(cleanData).then(() => alert("Xong!")).catch(err => alert("Lỗi: " + err));
    };
    reader.readAsArrayBuffer(file);
}

// --- BẾP ---
function initKitchenView(orders) {
    const list = document.getElementById('kitchen-orders');
    list.innerHTML = "";
    const active = orders.filter(o => o.status === 'moi' || o.status === 'dang_lam');
    active.forEach(o => {
        if(o.items[0]?.name.includes("Yêu cầu TT")) return; 
        const itemsHtml = o.items.map(i => {
            const note = i.note ? `<div class="text-info small"><i class="fas fa-pen"></i> ${i.note}</div>` : '';
            return `<div class="border-bottom border-secondary py-1">${i.name} (${i.size}) x${i.qty} ${note}</div>`;
        }).join('');
        
        let btn = o.status==='moi' 
            ? `<button class="btn btn-warning w-100 fw-bold" onclick="updateOrderStatus('${o.key}','dang_lam')">NHẬN ĐƠN</button>`
            : `<button class="btn btn-success w-100 fw-bold" onclick="updateOrderStatus('${o.key}','xong')">PHỤC VỤ XONG</button>`;
        
        const div = document.createElement('div'); div.className = "card-kitchen p-3 shadow";
        div.innerHTML = `<div class="d-flex justify-content-between text-warning"><h4>BÀN ${o.table}</h4><span>${new Date(o.timestamp).toLocaleTimeString()}</span></div><div class="mb-3">${itemsHtml}</div>${btn}`;
        list.appendChild(div);
    });
}

// --- QUAN TRỌNG: GÁN HÀM RA WINDOW ---
window.addToCart = addToCart;
window.removeRecentItem = removeRecentItem;
window.openMultiSizeModal = openMultiSizeModal;
window.updateModalQty = updateModalQty;
window.openCartDetails = openCartDetails;
window.closeCartDetails = closeCartDetails;
window.changeCartQty = changeCartQty;
window.updateNote = updateNote;
window.removeTopping = removeTopping;
window.showToppingSelector = showToppingSelector;
window.selectTopping = selectTopping;
window.submitOrder = submitOrder;
window.openSplitBillModal = openSplitBillModal;
window.toggleSplitItem = toggleSplitItem;
window.proceedSplitPayment = proceedSplitPayment;
window.showQR = showQR;
window.showCashInstruction = showCashInstruction;
window.confirmTransfer = confirmTransfer;
window.closePaymentModal = closePaymentModal;
window.requestBill = requestBill;
window.downloadBill = downloadBill;
window.showTableBill = showTableBill;
window.updateOrderStatus = updateOrderStatus;
window.handleFileUpload = handleFileUpload;