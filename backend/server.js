import express from "express";
import mysql from "mysql2";
import cors from "cors";
import multer from "multer"; // Wajib untuk PB-08 (Upload Legalitas)
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

// Setup ES Module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
app.use(cors());
app.use(express.json());

// Folder Upload (PB-08)
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Koneksi Database sdb_rent
const db = mysql.createConnection({
  host: "localhost",
  user: "root",
  password: "",
  database: "sdb_rent", // ✅ Database kamu
  port: 3307, // Cek XAMPP (biasanya 3306, kalau error ganti 3307)
});

db.connect((err) => {
  if (err) console.error("❌ Gagal Konek Database:", err.message);
  else console.log("✅ Terhubung ke Database sdb_rent");
});

// Setup Penyimpanan File (PB-08)
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) => {
    const uniqueName = "DOC-" + Date.now() + path.extname(file.originalname);
    cb(null, uniqueName);
  },
});
const upload = multer({ storage: storage });

// --- API ROUTES (Sesuai PBI) ---

// PB-01: Customer Melihat Daftar Mobil
app.get("/api/products", (req, res) => {
  db.query("SELECT * FROM products", (err, results) => {
    if (err) return res.status(500).json(err);
    res.json(results);
  });
});

// PB-07 & PB-08: Logic Booking & Input Detail + Upload
app.post("/api/checkout", upload.single("sim_document"), (req, res) => {
  const {
    customer_name,
    project_loc,
    product_id,
    total_rental_fee,
    start_date,
    duration,
  } = req.body;

  // Validasi PB-08: User Wajib Upload Dokumen
  const ktp_sim_image = req.file ? req.file.filename : null;
  if (!ktp_sim_image) {
    return res
      .status(400)
      .json({ message: "Dokumen Legalitas Wajib Diupload!" });
  }

  const orderId = "TRX-" + Date.now();

  // PB-09: Status otomatis PAID_VERIFY (Simulasi bayar sukses)
  const status = "PAID_VERIFY";

  const sql = `INSERT INTO transactions 
    (order_id, customer_name, project_loc, product_id, total_rental_fee, start_date, duration, ktp_sim_image, status) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;

  db.query(
    sql,
    [
      orderId,
      customer_name,
      project_loc,
      product_id,
      total_rental_fee,
      start_date,
      duration,
      ktp_sim_image,
      status,
    ],
    (err, result) => {
      if (err) return res.status(500).json({ error: "Gagal menyimpan order" });
      res.json({
        success: true,
        orderId,
        message: "Order berhasil, menunggu verifikasi admin.",
      });
    },
  );
});

// PB-11: Laporan Transaksi (Untuk Admin nanti)
app.get("/api/orders", (req, res) => {
  const sql = `SELECT t.*, p.name as item_name FROM transactions t LEFT JOIN products p ON t.product_id = p.id ORDER BY t.created_at DESC`;
  db.query(sql, (err, results) => {
    if (err) return res.status(500).json(err);
    res.json(results);
  });
});

// Start Server
const PORT = 5000;
app.listen(PORT, () => console.log(`🚀 Backend PBI Jalan di Port ${PORT}`));

// --- TAMBAHAN API LOGIN (PB-03) ---
app.post("/api/login", (req, res) => {
  const { username, password } = req.body;

  // Query ke Database XAMPP
  const sql = "SELECT * FROM users WHERE username = ? AND password = ?";
  db.query(sql, [username, password], (err, result) => {
    if (err) return res.status(500).json({ message: "Database Error" });

    if (result.length > 0) {
      // User Ditemukan
      res.json({
        success: true,
        message: "Login Berhasil",
        data: result[0], // Kirim data user (id, role, fullname)
      });
    } else {
      // User Tidak Ditemukan
      res
        .status(401)
        .json({ success: false, message: "Username/Password Salah" });
    }
  });
});
