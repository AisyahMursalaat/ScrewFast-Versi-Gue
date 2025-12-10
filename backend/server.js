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

app.use("/uploads", express.static(path.join(__dirname, "uploads")));

const db = mysql.createConnection({
  host: "localhost",
  user: "root",
  password: "",
  database: "sdb_rent",
  port: 3307,
});

db.connect((err) => {
  if (err) console.error("❌ Gagal Konek Database:", err.message);
  else console.log("✅ Terhubung ke Database sdb_rent");
});

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

// API ROUTES
app.get("/api/products", (req, res) => {
  db.query("SELECT * FROM products", (err, results) => {
    if (err) return res.status(500).json(err);
    res.json(results);
  });
});

// Endpoint Checkout
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
  if (!ktp_sim_image) {
    return res
      .status(400)
      .json({ message: "Dokumen Legalitas Wajib Diupload!" });
  }

  const orderId = "TRX-" + Date.now();
  const status = "PAID_VERIFY";
  const cleanedTotalFee = String(total_rental_fee).replace(/[^0-9.]/g, ""); // QUERY DIBERSIHKAN (SINGLE-LINE)
  const sql = `INSERT INTO transactions (order_id, customer_name, project_loc, product_id, total_rental_fee, start_date, duration, ktp_sim_image, status, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

  db.query(
    sql,
    [
      orderId,
      customer_name,
      project_loc,
      product_id,
      cleanedTotalFee,
      start_date,
      duration,
      ktp_sim_image,
      status,
      user_id,
    ],
    (err, result) => {
      if (err) {
        console.error("Error inserting transaction:", err);
        return res
          .status(500)
          .json({ success: false, error: "Gagal menyimpan order" });
      }
      res.json({
        success: true,
        orderId,
        message: "Order berhasil, menunggu verifikasi admin.",
      });
    },
  );
});

app.get("/api/orders", (req, res) => {
  // QUERY DIBERSIHKAN (SINGLE-LINE)
  const sql = `SELECT t.*, p.name as item_name, p.image as item_image, t.customer_name, t.ktp_sim_image as document_path FROM transactions t LEFT JOIN products p ON t.product_id = p.id ORDER BY t.created_at DESC`;
  db.query(sql, (err, results) => {
    if (err) return res.status(500).json(err);
    res.json(results);
  });
});

// ✅ FINAL: Mengambil item_price (p.price) dan data unit untuk dashboard user
app.get("/api/my-orders/:userId", (req, res) => {
  const { userId } = req.params; // QUERY DIBERSIHKAN (SINGLE-LINE)
  const sql = `SELECT t.*, p.name as item_name, p.price as item_price, p.image as item_image FROM transactions t LEFT JOIN products p ON t.product_id = p.id WHERE t.user_id = ? ORDER BY t.created_at DESC`;

  db.query(sql, [userId], (err, results) => {
    if (err) {
      console.error("Error fetching user orders:", err);
      return res
        .status(500)
        .json({ success: false, message: "Error fetching user orders" });
    }
    res.json(results);
  });
});

// ✅ FINAL: API Perpanjangan Sewa
app.post("/api/extend-rental", (req, res) => {
  const { orderId, additionalDuration, additionalFee } = req.body;

  if (
    !orderId ||
    !additionalDuration ||
    additionalFee === undefined ||
    additionalFee === null
  ) {
    return res
      .status(400)
      .json({ success: false, message: "Data perpanjangan tidak lengkap" });
  }

  const checkSql =
    "SELECT total_rental_fee FROM transactions WHERE order_id = ?";
  db.query(checkSql, [orderId], (err, results) => {
    if (err || results.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Order tidak ditemukan" });
    }
    const existingOrder = results[0];
    const currentTotalFee = parseFloat(existingOrder.total_rental_fee) || 0;
    const newTotalFee = currentTotalFee + parseFloat(additionalFee); // QUERY DIBERSIHKAN (SINGLE-LINE)

    const updateSql = `UPDATE transactions SET duration = CONCAT(duration, ' + ', ?), total_rental_fee = ?, status = 'EXTENDED' WHERE order_id = ?`;

    db.query(
      updateSql,
      [additionalDuration, newTotalFee, orderId],
      (err, result) => {
        if (err) {
          console.error("Update error:", err);
          return res.status(500).json({
            success: false,
            message: "Gagal memproses perpanjangan di database",
          });
        }

        res.json({
          success: true,
          message:
            "Perpanjangan sewa berhasil diajukan! Menunggu persetujuan Admin.",
        });
      },
    );
  });
});

// FINAL: Endpoint Admin untuk Update Status (Verifikasi/Selesai)
app.post("/api/admin/update-order-status", (req, res) => {
  const { orderId, status } = req.body;

  if (!orderId || !status) {
    return res
      .status(400)
      .json({ success: false, message: "Order ID dan Status wajib diisi." });
  }

  const sql = `UPDATE transactions SET status = ? WHERE order_id = ?`;

  db.query(sql, [status, orderId], (err, result) => {
    if (err) {
      console.error("Admin Update Error:", err);
      return res.status(500).json({
        success: false,
        message: "Gagal mengupdate status di database.",
      });
    }
    if (result.affectedRows === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Order tidak ditemukan." });
    }

    res.json({
      success: true,
      message: `Status order ${orderId} berhasil diubah menjadi ${status}.`,
    });
  });
});

// NEW: API Get Invoice Detail
app.get("/api/invoice/:orderId", (req, res) => {
  const { orderId } = req.params; // QUERY DIBERSIHKAN (SINGLE-LINE)

  const sql = `SELECT t.*, p.name as item_name, p.price as item_price, p.image as item_image FROM transactions t LEFT JOIN products p ON t.product_id = p.id WHERE t.order_id = ?`;

  db.query(sql, [orderId], (err, results) => {
    if (err)
      return res
        .status(500)
        .json({ success: false, message: "Database error" });

    if (results.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Invoice tidak ditemukan" });
    }

    res.json({ success: true, data: results[0] });
  });
});

app.post("/api/login", (req, res) => {
  const { username, password } = req.body;

  const sql = "SELECT * FROM users WHERE username = ? AND password = ?";
  db.query(sql, [username, password], (err, result) => {
    if (err) return res.status(500).json({ message: "Database Error" });

    if (result.length > 0) {
      res.json({ success: true, message: "Login Berhasil", data: result[0] });
    } else {
      res
        .status(401)
        .json({ success: false, message: "Username/Password Salah" });
    }
  });
});

const PORT = 5000;
app.listen(PORT, () => console.log(`🚀 Backend PBI Jalan di Port ${PORT}`));
