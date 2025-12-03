const express = require("express");
const mysql = require("mysql2");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// --- KONSTANTA MOBILISASI (DI SISI BACKEND) ---
const MOBILIZATION_RATES = {
  1: { flat_rate: 2500000, flat_distance: 20, rate_per_km_extra: 30000 },
  2: { flat_rate: 2500000, flat_distance: 20, rate_per_km_extra: 30000 },
  3: { flat_rate: 5000000, flat_distance: 20, rate_per_km_extra: 40000 },
  default: { flat_rate: 1000000, flat_distance: 20, rate_per_km_extra: 25000 },
};

// --- FUNGSI HAVERSINE (CALCULATE REAL DISTANCE) 🔥 ---
function calculateDistanceHaversine(lat1, lon1, lat2, lon2) {
  const R = 6371; // Radius Bumi dalam km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // Jarak dalam KM
}
// -------------------------------------------------------------------

// 1. KONEKSI DATABASE
const db = mysql.createConnection({
  host: "localhost",
  user: "root",
  password: "",
  database: "sewa_alat",
  port: 3307,
});

db.connect((err) => {
  if (err) console.error("❌ Database Error:", err);
  else console.log("✅ Database Terhubung!");
});

// --- API PUBLIK ---

app.get("/api/products", (req, res) => {
  db.query("SELECT * FROM products", (err, result) => {
    if (err) return res.status(500).json(err);
    res.json(result);
  });
});

app.get("/api/products/:id", (req, res) => {
  db.query(
    "SELECT * FROM products WHERE id = ?",
    [req.params.id],
    (err, result) => {
      if (err) return res.status(500).json(err);
      if (result.length === 0)
        return res.status(404).json({ message: "Produk tidak ditemukan" });
      res.json(result[0]);
    }
  );
});

// LOGIN API
app.post("/api/login", (req, res) => {
  const { username, password } = req.body;
  const sql = "SELECT * FROM users WHERE username = ? AND password = ?";
  db.query(sql, [username, password], (err, result) => {
    if (err) return res.status(500).json(err);
    if (result.length > 0) {
      res.json({ success: true, message: "Login Berhasil", data: result[0] });
    } else {
      res
        .status(401)
        .json({ success: false, message: "Username/Password Salah!" });
    }
  });
});

// --- API CHECKOUT UTAMA (50% DP MODEL) ---

app.post("/api/checkout", (req, res) => {
  const {
    user_id,
    total_rental_fee,
    down_payment,
    remaining_balance,
    delivery_fee,
    start_date,
    end_date,
  } = req.body;
  const orderId = "TRX-" + Date.now();

  if (!user_id || !total_rental_fee || !start_date || !end_date) {
    return res
      .status(400)
      .json({ success: false, message: "Data sewa tidak lengkap." });
  }

  const sql =
    "INSERT INTO transactions (order_id, user_id, product_id, total_rental_fee, down_payment, remaining_balance, delivery_fee, start_date, end_date, status) VALUES (?, ?, 0, ?, ?, ?, ?, ?, ?, '50%_paid')";

  db.query(
    sql,
    [
      orderId,
      user_id,
      total_rental_fee,
      down_payment || 0,
      remaining_balance || 0,
      delivery_fee || 0,
      start_date,
      end_date,
    ],
    (err, result) => {
      if (err) {
        console.error("❌ Checkout SQL Error:", err);
        return res.status(500).json({
          success: false,
          message: "Gagal menyimpan transaksi di database.",
        });
      }
      res.json({
        success: true,
        orderId: orderId,
        message: "Pesanan berhasil dibuat.",
      });
    }
  );
});

// --- API BARU: KALKULASI MOBILISASI REAL (UTAMA) 🔥 ---
app.post("/api/calculate-mobilization", (req, res) => {
  const { product_id, vendor_lat, vendor_lng, project_lat, project_lng } =
    req.body;

  // 1. HITUNG JARAK (Haversine)
  const lat1 = parseFloat(vendor_lat) || 0;
  const lon1 = parseFloat(vendor_lng) || 0;
  const lat2 = parseFloat(project_lat) || 0;
  const lon2 = parseFloat(project_lng) || 0;

  const distance_km = calculateDistanceHaversine(lat1, lon1, lat2, lon2);

  // 2. TENTUKAN TARIF (Berdasarkan Tiered Rate Logic)
  const rates =
    MOBILIZATION_RATES[product_id.toString()] || MOBILIZATION_RATES["default"];

  let mobilizationFee = 0;
  const distance = Math.ceil(distance_km);

  if (distance <= rates.flat_distance) {
    mobilizationFee = rates.flat_rate;
  } else {
    const extra_distance = distance - rates.flat_distance;
    const extra_fee = extra_distance * rates.rate_per_km_extra;
    mobilizationFee = rates.flat_rate + extra_fee;
  }

  res.json({
    success: true,
    distance_km: distance,
    mobilization_fee: mobilizationFee,
  });
});

// --- API DASHBOARD (USER & ADMIN) ---

app.get("/api/my-orders/:user_id", (req, res) => {
  const userId = req.params.user_id;
  const sql =
    "SELECT * FROM transactions WHERE user_id = ? ORDER BY tanggal DESC";
  db.query(sql, [userId], (err, result) => {
    if (err) return res.status(500).json({ message: "Error database" });
    res.json(result);
  });
});

app.get("/api/admin/transactions", (req, res) => {
  const sql =
    "SELECT t.*, COALESCE(u.username, 'User Dihapus') AS username FROM transactions t LEFT JOIN users u ON t.user_id = u.id ORDER BY tanggal DESC";
  db.query(sql, (err, result) => {
    if (err)
      return res.status(500).json({ message: "Gagal memproses query Admin." });
    res.json(result);
  });
});

app.put("/api/admin/transactions/:order_id", (req, res) => {
  const { status } = req.body;
  const { order_id } = req.params;
  const sql = "UPDATE transactions SET status = ? WHERE order_id = ?";
  db.query(sql, [status, order_id], (err, result) => {
    if (err) return res.status(500).json(err);
    res.json({ success: true });
  });
});

app.listen(5000, () => {
  console.log("🚀 Server Backend FINAL SINKRON JALAN di port 5000");
});
