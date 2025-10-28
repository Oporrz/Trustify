// Trustify Server — Cloudflare & Azure Ready 
import express from "express";
import cors from "cors";
import multer from "multer";
import path from "path";
import fs from "fs";
import sql from "mssql";
import dotenv from "dotenv";
import sharp from "sharp";
import Tesseract from "tesseract.js";
import webpush from "web-push";

dotenv.config();

const USE_SQL = (process.env.USE_SQL || "false").toLowerCase() === "true";
const AUTO_INSERT_PRODUCT = (process.env.AUTO_INSERT_PRODUCT || "true").toLowerCase() === "true";

const app = express();
app.use(cors({ origin: "*", methods: ["GET","POST"], allowedHeaders: ["Content-Type"] }));
app.use(express.json({ limit: "15mb" }));

// ---- Path
const ROOT = process.cwd();
const WEB_DIR = path.join(ROOT, "web");
// ✅ ปรับ path ให้ตรงกับโครงสร้างจริง
const UPLOAD_DIR = path.join(ROOT, "uploads");
const DATA_DIR = path.join(ROOT, "data");

[UPLOAD_DIR, DATA_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });
app.use("/uploads", express.static(UPLOAD_DIR));

// ---- Tiny JSON DB (local mode)
const f = (name) => path.join(DATA_DIR, name);
const load = (name, dflt = []) => { try { return JSON.parse(fs.readFileSync(f(name), "utf8")); } catch { return dflt; } };
const save = (name, data) => fs.writeFileSync(f(name), JSON.stringify(data, null, 2));

["users.json","products.json","images.json","scans.json","reports.json","forwarded.json","analyses.json","push_subs.json"].forEach(n=>{
  if (!fs.existsSync(f(n))) save(n, []);
});

// ---- SQL (optional)
const sqlConfig = {
  user: process.env.AZURE_SQL_USER,
  password: process.env.AZURE_SQL_PASSWORD,
  database: process.env.AZURE_SQL_DB,
  server: process.env.AZURE_SQL_SERVER,
  options: { encrypt: true, trustServerCertificate: false }
};
console.log("[MODE]", USE_SQL ? "SQL" : "LOCAL JSON");
if (USE_SQL) console.log("[DB]", sqlConfig.server, sqlConfig.database, sqlConfig.user);

async function getPool() {
  if (!USE_SQL) return null;
  if (sql.connected) return sql;
  await sql.connect({ ...sqlConfig, connectionTimeout: 10000, requestTimeout: 15000 });
  return sql;
}

// ---- Multer (upload)
const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, UPLOAD_DIR),
  filename: (_, file, cb) => cb(null, Date.now()+"-"+Math.round(Math.random()*1e9)+path.extname(file.originalname))
});
const upload = multer({ storage });

// ---- Web Push
const VAPID_PUBLIC_KEY  = process.env.VAPID_PUBLIC_KEY || "";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || "";
const VAPID_SUBJECT     = process.env.VAPID_SUBJECT || "mailto:admin@trustify.local";

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

// ===== Health =====
app.get("/api/health", (req, res) => {
  res.json({ ok: true, mode: USE_SQL ? "sql" : "local", web: "/index.html" });
});

// ===== Auth (Local JSON) =====
app.post("/api/signup", (req, res) => {
  const { email, password, role } = req.body || {};
  if (!email || !password || !role) return res.status(400).json({ error: "missing_field" });
  const users = load("users.json", []);
  if (users.some(u => u.email === email)) return res.status(400).json({ error: "user_exists" });
  users.push({ id: Date.now(), email, password, role });
  save("users.json", users);
  res.json({ ok: true });
});

app.post("/api/login", (req, res) => {
  const { email, password } = req.body || {};
  const users = load("users.json", []);
  const found = users.find(u => u.email === email && u.password === password);
  if (!found) return res.status(401).json({ error: "invalid_login" });
  res.json({ ok: true, role: found.role });
});

// Guest = customer
app.get("/api/guest", (req, res) => res.json({ ok: true, role: "customer", guest: true }));

// ===== Products =====
// (ส่วนอื่นเหมือนเดิม)

// ===== Azure-friendly Server =====
const PORT = process.env.PORT || 8787;  // ใช้พอร์ตจาก Azure หรือ fallback 8787
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => console.log('✅ Server listening on port', PORT));
