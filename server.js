const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json());

const ADMIN_EMAIL = "admin@admin.com";

// 🔴 THAY CHUỖI KẾT NỐI MONGODB ATLAS CỦA BẠN VÀO ĐÂY 🔴
const MONGO_URI = "mongodb+srv://nbhtuyetmuaha_db_user:M6PfnrVvLPrSQZQU@cluster0.xxxx.mongodb.net/vi-voucher?retryWrites=true&w=majority";

mongoose.connect(MONGO_URI)
  .then(() => console.log("✅ Đã kết nối MongoDB Cloud thành công!"))
  .catch(err => console.error("❌ Lỗi kết nối MongoDB:", err));

// --- ĐỊNH NGHĨA CẤU TRÚC DỮ LIỆU (SCHEMAS) ---
const UserSchema = new mongoose.Schema({
    email: { type: String, unique: true, required: true },
    password: { type: String, required: true },
    isActive: { type: Boolean, default: true },
    createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', UserSchema);

const VoucherSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    userEmail: String,
    code: { type: String, required: true },
    category: { type: String, required: true },
    expiry: { type: String, required: true },
    status: { type: String, default: 'active' }, // 'active' hoặc 'used'
    createdAt: { type: Date, default: Date.now }
});
const Voucher = mongoose.model('Voucher', VoucherSchema);

// --- CÁC ĐƯỜNG DẪN API (ROUTES) ---

// 1. ĐĂNG NHẬP / TỰ ĐỘNG ĐĂNG KÝ CHO NHÂN VIÊN
app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    const cleanEmail = email.toLowerCase().trim();

    try {
        let user = await User.findOne({ email: cleanEmail });
        
        if (!user) {
            // Nếu là Admin hoặc Email đầu tiên, cho phép tạo tài khoản luôn
            if (cleanEmail === ADMIN_EMAIL) {
                user = new User({ email: cleanEmail, password });
                await user.save();
            } else {
                return res.status(403).json({ message: "⛔ Bạn chưa được Admin cấp quyền truy cập hệ thống!" });
            }
        } else {
            if (!user.isActive) return res.status(403).json({ message: "🔒 Tài khoản của bạn đã bị khóa quyền!" });
            if (user.password !== password) return res.status(400).json({ message: "❌ Sai mật khẩu!" });
        }

        res.json({ id: user._id, email: user.email });
    } catch (err) {
        res.status(500).json({ message: "Lỗi máy chủ: " + err.message });
    }
});

// 2. NGƯỜI DÙNG: LẤY DANH SÁCH VOUCHER CỦA MÌNH
app.get('/api/vouchers', async (req, res) => {
    const userId = req.headers['user-id'];
    if (!userId) return res.status(401).json({ message: "Thiếu thông tin User ID" });
    try {
        const list = await Voucher.find({ userId }).sort({ createdAt: -1 });
        res.json(list);
    } catch (err) { res.status(500).json({ message: err.message }); }
});

// 3. NGƯỜI DÙNG: THÊM VOUCHER (CHECK TRÙNG TOÀN HỆ THỐNG HOẶC TRONG VÍ)
app.post('/api/vouchers', async (req, res) => {
    const userId = req.headers['user-id'];
    const { code, category, expiry, userEmail } = req.body;
    const upperCode = code.toUpperCase().trim();

    try {
        // Kiểm tra xem mã này đã có trong hệ thống chưa
        const duplicate = await Voucher.findOne({ code: upperCode });
        if (duplicate) return res.status(400).json({ message: `Mã "${upperCode}" đã tồn tại trên hệ thống!` });

        const newVoucher = new Voucher({ userId, userEmail, code: upperCode, category, expiry });
        await newVoucher.save();
        res.json(newVoucher);
    } catch (err) { res.status(500).json({ message: err.message }); }
});

// 4. NGƯỜI DÙNG: ĐÁNH DẤU ĐÃ SỬ DỤNG VOUCHER
app.put('/api/vouchers/:id/used', async (req, res) => {
    try {
        const voucher = await Voucher.findByIdAndUpdate(req.params.id, { status: 'used' }, { new: true });
        res.json(voucher);
    } catch (err) { res.status(500).json({ message: err.message }); }
});

// 5. ADMIN: LẤY DANH SÁCH TẤT CẢ TÀI KHOẢN (USER)
app.get('/api/admin/users', async (req, res) => {
    try {
        const users = await User.find({ email: { $ne: ADMIN_EMAIL } }).sort({ createdAt: -1 });
        res.json(users);
    } catch (err) { res.status(500).json({ message: err.message }); }
});

// 6. ADMIN: CẤP QUYỀN (TẠO TÀI KHOẢN NHÂN VIÊN MỚI KÈM PASS RANDOM)
app.post('/api/admin/users', async (req, res) => {
    const { email } = req.body;
    const cleanEmail = email.toLowerCase().trim();
    const randomPassword = crypto.randomBytes(4).toString('hex'); // Tạo chuỗi 8 ký tự tự động

    try {
        const exist = await User.findOne({ email: cleanEmail });
        if (exist) return res.status(400).json({ message: "Email này đã có trong hệ thống rồi!" });

        const newUser = new User({ email: cleanEmail, password: randomPassword });
        await newUser.save();
        res.json({ email: cleanEmail, password: randomPassword });
    } catch (err) { res.status(500).json({ message: err.message }); }
});

// 7. ADMIN: THU HỒI QUYỀN / KHÓA TÀI KHOẢN NGƯỜI KHÁC
app.delete('/api/admin/users/:id', async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ message: "Không tìm thấy user" });
        
        // Xóa sạch voucher của user đó và xóa user
        await Voucher.deleteMany({ userId: user._id });
        await User.findByIdAndDelete(req.params.id);
        res.json({ message: "Đã xóa user và toàn bộ voucher thành công!" });
    } catch (err) { res.status(500).json({ message: err.message }); }
});

// 8. ADMIN: TÌM KIẾM VÀ QUẢN LÝ TOÀN BỘ VOUCHER TRÊN HỆ THỐNG
app.get('/api/admin/vouchers', async (req, res) => {
    const { keyword } = req.query;
    try {
        let filter = {};
        if (keyword) filter.code = new RegExp(keyword.toUpperCase().trim(), 'i');
        const list = await Voucher.find(filter).sort({ createdAt: -1 });
        res.json(list);
    } catch (err) { res.status(500).json({ message: err.message }); }
});

// 9. ADMIN: XÓA MÃ VOUCHER TRONG TÀI KHOẢN KHÁCH
app.delete('/api/admin/vouchers/:id', async (req, res) => {
    try {
        await Voucher.findByIdAndDelete(req.params.id);
        res.json({ message: "Xóa mã thành công!" });
    } catch (err) { res.status(500).json({ message: err.message }); }
});

// KHỞI CHẠY MÁY CHỦ
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Máy chủ Backend đang chạy tại port ${PORT}`));
