
const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const initSqlJs = require("sql.js");

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, "simstore.sqlite");

const ADMIN_PASSWORD = process.env.MSN_ADMIN_PASSWORD || "Admin";
const SESSION_TTL = 8 * 60 * 60 * 1000;
const sessions = new Map();

app.use(express.json({ limit: "100kb" }));
app.use(express.static(path.join(__dirname, "public")));

let db;

function saveDb() {
  fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
}

function all(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function get(sql, params = []) {
  return all(sql, params)[0] || null;
}

function run(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.run(params);
  stmt.free();
}

function parseCookies(header = "") {
  const result = {};
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index > 0) {
      const key = part.slice(0, index).trim();
      try {
        result[key] = decodeURIComponent(part.slice(index + 1).trim());
      } catch {
        result[key] = "";
      }
    }
  }
  return result;
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function adminAuth(req, res, next) {
  const token = parseCookies(req.headers.cookie).msn_admin;
  const session = token && sessions.get(token);

  if (!session || session.expiresAt < Date.now()) {
    if (token) sessions.delete(token);
    return res.status(401).json({
      error: "Please sign in to the admin panel."
    });
  }

  session.expiresAt = Date.now() + SESSION_TTL;
  next();
}

function cleanProduct(product) {
  if (!product) return product;
  return { ...product, featured: Boolean(product.featured) };
}

function validateProduct(body = {}) {
  const product = {
    name: String(body.name || "").trim(),
    category: String(body.category || "").trim(),
    description: String(body.description || "").trim(),
    price: Number(body.price),
    data: String(body.data || "").trim(),
    minutes: String(body.minutes || "").trim(),
    badge: String(body.badge || "").trim(),
    featured: body.featured ? 1 : 0
  };

  if (
    !product.name ||
    !product.category ||
    !product.description ||
    !product.data ||
    !product.minutes
  ) {
    return { error: "Complete all required plan fields." };
  }

  if (
    !Number.isFinite(product.price) ||
    product.price < 0 ||
    product.price > 1000000
  ) {
    return { error: "Enter a valid plan price." };
  }

  return { product };
}

function validPhone(phone) {
  return /^[+\d\s()-]{7,20}$/.test(phone);
}

function normalizeRechargeStatuses() {
  db.run(`
    UPDATE recharges
    SET status = CASE
      WHEN status = 'Pending' THEN 'Demo - Not Processed'
      WHEN status = 'Reviewed' THEN 'Demo - Reviewed'
      WHEN status IN ('Completed (demo)', 'Completed')
        THEN 'Demo - Completed'
      WHEN status = 'Cancelled' THEN 'Demo - Cancelled'
      ELSE status
    END
  `);
}

initSqlJs()
  .then(SQL => {
    db = fs.existsSync(DB_PATH)
      ? new SQL.Database(new Uint8Array(fs.readFileSync(DB_PATH)))
      : new SQL.Database();

    db.run(`
      CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        description TEXT NOT NULL,
        price REAL NOT NULL,
        data TEXT NOT NULL,
        minutes TEXT NOT NULL,
        badge TEXT DEFAULT '',
        featured INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_name TEXT NOT NULL,
        phone TEXT NOT NULL,
        product_id INTEGER,
        amount REAL NOT NULL,
        status TEXT DEFAULT 'Pending',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS recharges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        phone TEXT NOT NULL,
        amount REAL NOT NULL,
        status TEXT NOT NULL DEFAULT 'Pending',
        reference TEXT NOT NULL UNIQUE,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);

    normalizeRechargeStatuses();

    // Preserve the existing Jawwy-to-MSN migration.
    db.run(`
      UPDATE products
      SET
        name = REPLACE(name, 'Jawwy', 'MSN'),
        category = REPLACE(category, 'Jawwy', 'MSN'),
        description = REPLACE(description, 'Jawwy', 'MSN')
    `);

    // Add sample plans only when the products table is empty.
    if (get("SELECT COUNT(*) AS n FROM products").n === 0) {
      const plans = [
        ["MSN Travel", "MSN Travel",
          "Travel connectivity sample plan. Check destination coverage before ordering.",
          50, "Travel plan", "Roaming", "NEW", 0],
        ["MSN 90", "MSN",
          "Balanced sample plan for everyday browsing, social apps and calls.",
          103.50, "33 GB", "500 mins", "TRENDING", 1],
        ["MSN 110", "MSN",
          "More data and minutes for a busy month.",
          126.50, "45 GB", "990 mins", "", 0],
        ["MSN 150", "MSN",
          "Extra data for streaming, work and entertainment.",
          172.50, "71 GB", "1010 mins", "", 0],
        ["MSN Flex", "Flex",
          "Flexible sample plan. Verify final allowances before publishing.",
          75, "20 GB", "Flexible", "FLEX", 0],
        ["MSN Data", "Data",
          "Data-focused sample package for browsing and apps.",
          40, "10 GB", "Data only", "DATA", 0],
        ["MSN Replacement SIM", "Replacement",
          "Request a replacement SIM. Eligibility and identity checks may apply.",
          15, "SIM replacement", "Not applicable", "", 0]
      ];

      const stmt = db.prepare(`
        INSERT INTO products
        (name, category, description, price, data, minutes, badge, featured)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      plans.forEach(plan => stmt.run(plan));
      stmt.free();
    }

    saveDb();

    // =========================
    // ADMIN LOGIN AND SESSION
    // =========================

    app.post("/api/admin/login", (req, res) => {
      const password = String(req.body?.password || "");

      if (!safeEqual(password, ADMIN_PASSWORD)) {
        return res.status(401).json({
          error: "Incorrect admin password."
        });
      }

      const token = crypto.randomBytes(32).toString("hex");

      sessions.set(token, {
        expiresAt: Date.now() + SESSION_TTL
      });

      const secure =
        process.env.NODE_ENV === "production" ? "; Secure" : "";

      res.setHeader(
        "Set-Cookie",
        `msn_admin=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL / 1000}${secure}`
      );

      res.json({ ok: true });
    });

    app.get("/api/admin/me", adminAuth, (req, res) => {
      res.json({ authenticated: true });
    });

    app.post("/api/admin/logout", (req, res) => {
      const token = parseCookies(req.headers.cookie).msn_admin;
      if (token) sessions.delete(token);

      res.setHeader(
        "Set-Cookie",
        "msn_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0"
      );

      res.json({ ok: true });
    });

    // =========================
    // PUBLIC SIM PLAN CATALOG
    // =========================

    app.get("/api/products", (req, res) => {
      const category = req.query.category;
      const search = String(req.query.search || "").trim();

      let sql = "SELECT * FROM products WHERE 1=1";
      const params = [];

      if (category && category !== "All") {
        sql += " AND category = ?";
        params.push(category);
      }

      if (search) {
        sql += ` AND (
          name LIKE ? OR description LIKE ? OR category LIKE ?
        )`;

        const term = `%${search}%`;
        params.push(term, term, term);
      }

      sql += " ORDER BY featured DESC, id ASC";
      res.json(all(sql, params).map(cleanProduct));
    });

    // =========================
    // CUSTOMER ORDER CREATION
    // =========================

    app.post("/api/orders", (req, res) => {
      const { customerName, phone, productId } = req.body || {};

      if (
        typeof customerName !== "string" ||
        !customerName.trim() ||
        typeof phone !== "string" ||
        !phone.trim() ||
        !productId
      ) {
        return res.status(400).json({
          error: "Enter your name and mobile number."
        });
      }

      if (phone.trim().length < 7) {
        return res.status(400).json({
          error: "Enter a valid mobile number."
        });
      }

      const product = get(
        "SELECT id, price FROM products WHERE id = ?",
        [Number(productId)]
      );

      if (!product) {
        return res.status(400).json({
          error: "Plan not found."
        });
      }

      run(`
        INSERT INTO orders
        (customer_name, phone, product_id, amount, status)
        VALUES (?, ?, ?, ?, 'Pending')
      `, [
        customerName.trim(),
        phone.trim(),
        product.id,
        product.price
      ]);

      const orderId = get(
        "SELECT last_insert_rowid() AS id"
      ).id;

      saveDb();

      res.status(201).json({
        message: "Order created. No payment or activation was performed.",
        orderId
      });
    });

    // =========================
    // CUSTOMER ORDER LOOKUP
    // =========================

    app.get("/api/orders/lookup", (req, res) => {
      const phone = String(req.query.phone || "").trim();

      if (phone.length < 7) {
        return res.status(400).json({
          error: "Enter a valid mobile number."
        });
      }

      const orders = all(`
        SELECT
          o.id, o.phone, o.amount, o.status, o.created_at,
          p.name AS product_name
        FROM orders o
        LEFT JOIN products p ON p.id = o.product_id
        WHERE o.phone = ?
        ORDER BY o.id DESC
        LIMIT 20
      `, [phone]);

      res.json({ orders });
    });

    // =========================
    // ADMIN DASHBOARD STATISTICS
    // =========================

    app.get("/api/admin/dashboard", adminAuth, (req, res) => {
      const orders = get(`
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN status = 'Pending' THEN 1 ELSE 0 END) AS pending,
          COALESCE(SUM(amount), 0) AS orderValue
        FROM orders
      `);

      const products = get(
        "SELECT COUNT(*) AS total FROM products"
      );

      res.json({
        orders: {
          total: orders.total || 0,
          pending: orders.pending || 0,
          orderValue: orders.orderValue || 0
        },
        products: {
          total: products.total || 0
        }
      });
    });

    // =========================
    // ADMIN CUSTOMER ORDERS
    // =========================

    app.get("/api/admin/orders", adminAuth, (req, res) => {
      let sql = `
        SELECT
          o.id, o.customer_name, o.phone, o.product_id,
          o.amount, o.status, o.created_at,
          p.name AS product_name
        FROM orders o
        LEFT JOIN products p ON p.id = o.product_id
        WHERE 1=1
      `;

      const params = [];
      const search = String(req.query.search || "").trim();
      const status = String(req.query.status || "").trim();

      if (search) {
        sql += ` AND (
          CAST(o.id AS TEXT) LIKE ? OR
          o.customer_name LIKE ? OR
          o.phone LIKE ? OR
          p.name LIKE ?
        )`;

        const term = `%${search}%`;
        params.push(term, term, term, term);
      }

      if (status) {
        sql += " AND o.status = ?";
        params.push(status);
      }

      sql += " ORDER BY o.id DESC LIMIT 500";

      res.json({ orders: all(sql, params) });
    });

    app.patch("/api/admin/orders/:id", adminAuth, (req, res) => {
      const id = Number(req.params.id);
      const status = String(req.body?.status || "");

      const allowed = [
        "Pending", "Confirmed", "Completed", "Cancelled"
      ];

      if (!Number.isInteger(id) || id < 1) {
        return res.status(400).json({
          error: "Invalid order ID."
        });
      }

      if (!allowed.includes(status)) {
        return res.status(400).json({
          error: "Invalid order status."
        });
      }

      if (!get("SELECT id FROM orders WHERE id = ?", [id])) {
        return res.status(404).json({
          error: "Order not found."
        });
      }

      run("UPDATE orders SET status = ? WHERE id = ?", [status, id]);
      saveDb();

      res.json({ ok: true, id, status });
    });

    // =========================
    // ADMIN SIM PLAN MANAGEMENT
    // =========================

    app.get("/api/admin/products", adminAuth, (req, res) => {
      const products = all(`
        SELECT * FROM products
        ORDER BY featured DESC, id DESC
      `).map(cleanProduct);

      res.json({ products });
    });

    app.post("/api/admin/products", adminAuth, (req, res) => {
      const result = validateProduct(req.body || {});

      if (result.error) {
        return res.status(400).json({ error: result.error });
      }

      const p = result.product;

      run(`
        INSERT INTO products
        (name, category, description, price, data, minutes, badge, featured)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        p.name, p.category, p.description, p.price,
        p.data, p.minutes, p.badge, p.featured
      ]);

      const id = get("SELECT last_insert_rowid() AS id").id;
      saveDb();

      res.status(201).json({
        product: cleanProduct(
          get("SELECT * FROM products WHERE id = ?", [id])
        )
      });
    });

    app.put("/api/admin/products/:id", adminAuth, (req, res) => {
      const id = Number(req.params.id);

      if (
        !Number.isInteger(id) ||
        !get("SELECT id FROM products WHERE id = ?", [id])
      ) {
        return res.status(404).json({
          error: "Plan not found."
        });
      }

      const result = validateProduct(req.body || {});

      if (result.error) {
        return res.status(400).json({ error: result.error });
      }

      const p = result.product;

      run(`
        UPDATE products SET
          name = ?, category = ?, description = ?, price = ?,
          data = ?, minutes = ?, badge = ?, featured = ?
        WHERE id = ?
      `, [
        p.name, p.category, p.description, p.price,
        p.data, p.minutes, p.badge, p.featured, id
      ]);

      saveDb();

      res.json({
        product: cleanProduct(
          get("SELECT * FROM products WHERE id = ?", [id])
        )
      });
    });

    app.delete("/api/admin/products/:id", adminAuth, (req, res) => {
      const id = Number(req.params.id);

      if (
        !Number.isInteger(id) ||
        !get("SELECT id FROM products WHERE id = ?", [id])
      ) {
        return res.status(404).json({
          error: "Plan not found."
        });
      }

      // Existing orders are retained when a plan is deleted.
      run("DELETE FROM products WHERE id = ?", [id]);
      saveDb();

      res.json({ ok: true });
    });

    // =========================
    // PUBLIC DEMO RECHARGE API
    // =========================

    // This records demo requests only. It never recharges a real phone.
    app.post("/api/recharges", (req, res) => {
      const phone = String(req.body?.phone || "").trim();
      const amount = Number(req.body?.amount);
      const allowedAmounts = [10, 20, 30, 50, 100, 200];

      if (!validPhone(phone)) {
        return res.status(400).json({
          error: "Enter a valid mobile number."
        });
      }

      if (!allowedAmounts.includes(amount)) {
        return res.status(400).json({
          error: "Select a valid recharge amount."
        });
      }

      const reference =
        "MSNR-" + crypto.randomBytes(6).toString("hex").toUpperCase();

      try {
        run(`
          INSERT INTO recharges
          (phone, amount, status, reference)
          VALUES (?, ?, 'Demo - Not Processed', ?)
        `, [phone, amount, reference]);

        saveDb();

        const recharge = get(`
          SELECT id, phone, amount, status, reference, created_at
          FROM recharges
          WHERE reference = ?
        `, [reference]);

        res.status(201).json({
          message: "Demo recharge request saved. No payment or actual recharge was performed.",
          recharge
        });
      } catch (error) {
        console.error("Recharge creation failed:", error);
        res.status(500).json({
          error: "Could not save the recharge request."
        });
      }
    });

    // Look up previous demo recharges by mobile number.
    app.get("/api/recharges/lookup", (req, res) => {
      const phone = String(req.query.phone || "").trim();

      if (!validPhone(phone)) {
        return res.status(400).json({
          error: "Enter a valid mobile number."
        });
      }

      try {
        const recharges = all(`
          SELECT id, phone, amount, status, reference, created_at
          FROM recharges
          WHERE phone = ?
          ORDER BY id DESC
          LIMIT 20
        `, [phone]);

        res.json({ recharges });
      } catch (error) {
        console.error("Recharge lookup failed:", error);
        res.status(500).json({
          error: "Could not retrieve recharge history."
        });
      }
    });

    // =========================
    // ADMIN RECHARGE MANAGEMENT
    // =========================

    app.get("/api/admin/recharges", adminAuth, (req, res) => {
      try {
        let sql = `
          SELECT id, phone, amount, status, reference, created_at
          FROM recharges
          WHERE 1=1
        `;

        const params = [];
        const search = String(req.query.search || "").trim();
        const status = String(req.query.status || "").trim();

        if (search) {
          sql += ` AND (
            phone LIKE ? OR reference LIKE ? OR CAST(id AS TEXT) LIKE ?
          )`;

          const term = `%${search}%`;
          params.push(term, term, term);
        }

        if (status) {
          sql += " AND status = ?";
          params.push(status);
        }

        sql += " ORDER BY id DESC LIMIT 500";

        res.json({ recharges: all(sql, params) });
      } catch (error) {
        console.error("Could not load recharge requests:", error);
        res.status(500).json({
          error: "Could not load recharge requests."
        });
      }
    });

    app.patch("/api/admin/recharges/:id", adminAuth, (req, res) => {
      const id = Number(req.params.id);
      const status = String(req.body?.status || "").trim();

      const allowedStatuses = [
        "Demo - Not Processed",
        "Demo - Reviewed",
        "Demo - Completed",
        "Demo - Cancelled",
        // Backward compatibility with older admin pages.
        "Pending",
        "Reviewed",
        "Completed (demo)",
        "Cancelled"
      ];

      if (!Number.isInteger(id) || id < 1) {
        return res.status(400).json({
          error: "Invalid recharge request ID."
        });
      }

      if (!allowedStatuses.includes(status)) {
        return res.status(400).json({
          error: "Invalid recharge status."
        });
      }

      try {
        const existing = get(
          "SELECT id FROM recharges WHERE id = ?",
          [id]
        );

        if (!existing) {
          return res.status(404).json({
            error: "Recharge request not found."
          });
        }

        run(
          "UPDATE recharges SET status = ? WHERE id = ?",
          [status, id]
        );

        saveDb();

        res.json({
          ok: true,
          message: "Recharge request status updated.",
          id,
          status
        });
      } catch (error) {
        console.error("Could not update recharge request:", error);
        res.status(500).json({
          error: "Could not update recharge request."
        });
      }
    });

    // =========================
    // HEALTH CHECK AND SERVER
    // =========================

    app.get("/api/health", (req, res) => {
      res.json({ status: "ok" });
    });

    app.listen(PORT, () => {
      console.log(`MSN Mobile running at http://localhost:${PORT}`);
    });
  })
  .catch(err => {
    console.error("Could not initialize database:", err);
    process.exit(1);
  });
