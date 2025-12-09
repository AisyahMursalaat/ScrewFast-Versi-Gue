import express from "express";
import mysql from "mysql2";
import cors from "cors";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

// Buka akses folder uploads agar bisa diakses frontend
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// --- KONEKSI DATABASE ---
const db = mysql.createConnection({
  host: "localhost",
  user: "root",
  password: "",
  database: "sdb_rent", // Pastikan nama DB benar
  port: 3307, // Port MySQL XAMPP
});

db.connect((err) => {
  if (err) console.error("❌ Database Error:", err);
  else console.log("✅ Terhubung ke Database XAMPP (sdb_rent)");
});

// --- SETUP UPLOAD (MULTER) ---
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

// --- API ROUTES ---

// 1. LOGIN (PENTING!)
app.post("/api/login", (req, res) => {
  const { username, password } = req.body;
  const sql = "SELECT * FROM users WHERE username = ? AND password = ?";
  db.query(sql, [username, password], (err, result) => {
    if (err) return res.status(500).json({ message: "Database Error" });
    if (result.length > 0) {
      res.json({ success: true, data: result[0] });
    } else {
      res
        .status(401)
        .json({ success: false, message: "Username/Password Salah" });
    }
  });
});

// 2. GET PRODUK
app.get("/api/products", (req, res) => {
  db.query("SELECT * FROM products", (err, results) => {
    if (err) return res.status(500).json(err);
    res.json(results);
  });
});

// 3. TAMBAH PRODUK
app.post("/api/products", (req, res) => {
  const { name, price, stock, image, description } = req.body;
  const sql =
    "INSERT INTO products (name, category, price, stock, image, description) VALUES (?, 'Heavy', ?, ?, ?, ?)";
  db.query(sql, [name, price, stock, image, description], (err, result) => {
    if (err) return res.status(500).json(err);
    res.json({ message: "Produk tersimpan", id: result.insertId });
  });
});

// 4. CHECKOUT (DENGAN UPLOAD & USER ID)
app.post("/api/checkout", upload.single("sim_document"), (req, res) => {
  const {
    customer_name,
    project_loc,
    product_id,
    total_rental_fee,
    start_date,
    duration,
    user_id,
  } = req.body;

  const ktp_sim_image = req.file ? req.file.filename : null;
  const orderId = "TRX-" + Date.now();

  const sql = `INSERT INTO transactions 
    (order_id, customer_name, project_loc, product_id, total_rental_fee, start_date, duration, ktp_sim_image, status, user_id) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending_verification', ?)`;

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
      user_id,
    ],
    (err, result) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Gagal simpan" });
      }
      res.json({ success: true, orderId, message: "Order berhasil" });
    },
  );
});

// 5. GET ALL ORDERS (ADMIN)
app.get("/api/orders", (req, res) => {
  const sql = `SELECT t.*, p.name as item_name FROM transactions t LEFT JOIN products p ON t.product_id = p.id ORDER BY t.created_at DESC`;
  db.query(sql, (err, results) => {
    if (err) return res.status(500).json(err);
    res.json(results);
  });
});

// 6. GET MY ORDERS (USER)
app.get("/api/my-orders/:userId", (req, res) => {
  const sql = `SELECT t.*, p.name as item_name FROM transactions t LEFT JOIN products p ON t.product_id = p.id WHERE t.user_id = ? ORDER BY t.created_at DESC`;
  db.query(sql, [req.params.userId], (err, results) => {
    if (err) return res.status(500).json(err);
    res.json(results);
  });
});

// 7. UPDATE STATUS (VERIFIKASI)
app.put("/api/orders/:orderId", (req, res) => {
  const { status } = req.body;
  db.query(
    "UPDATE transactions SET status = ? WHERE order_id = ?",
    [status, req.params.orderId],
    (err) => {
      if (err) return res.status(500).json(err);
      res.json({ success: true });
    },
  );
});

const PORT = 5000;
app.listen(PORT, () =>
  console.log(`🚀 Server Backend Jalan di http://localhost:${PORT}`),
);
