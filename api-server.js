import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import crypto from 'crypto';
import { exec } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const ROOT = path.resolve(__dirname);
const DB_FILE = path.join(ROOT, 'database.db');
const WEB_DIR = path.resolve(__dirname, 'web');
const DIST_DIR = path.resolve(__dirname, 'dist');
const BACKUPS_DIR = path.resolve(ROOT, 'backups');
const PORT = parseInt(process.env.PORT || '4051', 10);
const IS_STANDALONE = process.env.STANDALONE === 'true';

let db = null;
const sseClients = [];

function broadcastSSE(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (let i = sseClients.length - 1; i >= 0; i--) {
    try {
      sseClients[i].write(msg);
    } catch {
      sseClients.splice(i, 1);
    }
  }
}

function getDb() {
  if (db) return db;
  try {
    const Database = require('better-sqlite3');
    db = new Database(DB_FILE, {});
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    return db;
  } catch (e) {
    console.error('[API] Error loading better-sqlite3:', e.message);
    return null;
  }
}

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use((req, _res, next) => {
  console.log(`[API] ${req.method} ${req.url}`);
  next();
});

app.use((err, _req, res, _next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON' });
  }
  console.error('[API] Error:', err.message);
  res.status(500).json({ error: err.message });
});

// ============ SCHEMA & SEED ============
function ensureSchema() {
  const d = getDb();
  d.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL DEFAULT '',
      price REAL NOT NULL DEFAULT 0,
      cost REAL NOT NULL DEFAULT 0,
      stock REAL NOT NULL DEFAULT 0,
      category TEXT NOT NULL DEFAULT 'Varios',
      source TEXT DEFAULT 'local',
      description TEXT DEFAULT '',
      image TEXT DEFAULT '',
      oferta INTEGER DEFAULT 0,
      nuevo INTEGER DEFAULT 0,
      webDesc TEXT DEFAULT '',
      ofertaPrice REAL DEFAULT 0,
      fichaTecnica TEXT DEFAULT '',
      fichaTecnicaFile TEXT DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS clients (
      id TEXT PRIMARY KEY,
      document TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL DEFAULT '',
      phone TEXT DEFAULT '-',
      email TEXT DEFAULT '-'
    );
    CREATE TABLE IF NOT EXISTS providers (
      id TEXT PRIMARY KEY,
      ruc TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL DEFAULT '',
      phone TEXT DEFAULT '-',
      email TEXT DEFAULT '-'
    );
    CREATE TABLE IF NOT EXISTS payment_methods (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      requiresCash INTEGER DEFAULT 0,
      icon TEXT DEFAULT '',
      adjustment REAL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS sales (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      total REAL NOT NULL DEFAULT 0,
      paymentMethod TEXT NOT NULL DEFAULT 'Efectivo',
      clientId TEXT DEFAULT '',
      clientName TEXT DEFAULT 'Cliente General',
      cashReceived REAL DEFAULT 0,
      change REAL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS sale_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      saleId TEXT NOT NULL,
      productId TEXT DEFAULT '',
      productName TEXT DEFAULT '',
      quantity REAL NOT NULL DEFAULT 0,
      price REAL NOT NULL DEFAULT 0,
      FOREIGN KEY (saleId) REFERENCES sales(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS purchases (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      providerId TEXT DEFAULT '',
      providerName TEXT DEFAULT '',
      paymentMethod TEXT DEFAULT 'Efectivo',
      total REAL NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS purchase_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      purchaseId TEXT NOT NULL,
      productId TEXT DEFAULT '',
      productName TEXT DEFAULT '',
      quantity REAL NOT NULL DEFAULT 0,
      cost REAL NOT NULL DEFAULT 0,
      FOREIGN KEY (purchaseId) REFERENCES purchases(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS expenses (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'transferencia',
      description TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS app_config (
      key TEXT PRIMARY KEY,
      value TEXT
    );
    CREATE TABLE IF NOT EXISTS repairs (
      id TEXT PRIMARY KEY,
      code TEXT,
      clientId TEXT DEFAULT '',
      clientName TEXT DEFAULT '',
      clientPhone TEXT DEFAULT '',
      equipment TEXT DEFAULT '',
      marca TEXT DEFAULT '',
      modelo TEXT DEFAULT '',
      status TEXT DEFAULT 'recibido',
      price REAL DEFAULT 0,
      problem TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      date TEXT NOT NULL,
      updatedAt TEXT
    );
    CREATE TABLE IF NOT EXISTS site_visits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      count INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS web_categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS web_services (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      desc TEXT DEFAULT '',
      icon TEXT DEFAULT '',
      price REAL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS restock_pending (
      id TEXT PRIMARY KEY,
      productId TEXT NOT NULL,
      productName TEXT NOT NULL,
      quantity REAL NOT NULL DEFAULT 1,
      notes TEXT DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS monthly_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      month TEXT NOT NULL,
      totalSales REAL DEFAULT 0,
      totalCosts REAL DEFAULT 0,
      totalExpenses REAL DEFAULT 0,
      totalPurchases REAL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS exchanges (
      id TEXT PRIMARY KEY,
      clientId TEXT DEFAULT '',
      clientName TEXT DEFAULT '',
      productId TEXT DEFAULT '',
      productName TEXT DEFAULT '',
      status TEXT DEFAULT 'recibido',
      date TEXT NOT NULL,
      notes TEXT DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      content TEXT DEFAULT '',
      date TEXT NOT NULL,
      category TEXT DEFAULT ''
    );
  `);
}

function seedIfEmpty() {
  const d = getDb();
  const webCount = d.prepare("SELECT COUNT(*) as c FROM products WHERE source = 'web'").get();
  if (webCount.c > 0) return;

  const cats = [
    { id: '1', name: 'Tinto' },
    { id: '2', name: 'Blanco' },
    { id: '3', name: 'Rosado' },
    { id: '4', name: 'Espumante' },
  ];
  const insCat = d.prepare('INSERT OR IGNORE INTO web_categories (id, name) VALUES (?,?)');
  for (const c of cats) insCat.run(c.id, c.name);

  const prods = [
    { id: '1', code: 'TIN001', name: 'Malbec Reserva Catena Zapata', price: 8500, cost: 5500, stock: 20, category: 'Tinto', desc: 'Malbec 100%. Aroma a frutos rojos, violetas y un toque especiado. Crianza 12 meses en roble.', image: 'https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?w=400&h=400&fit=crop' },
    { id: '2', code: 'TIN002', name: 'Cabernet Sauvignon Nieto Senetiner', price: 6200, cost: 4000, stock: 15, category: 'Tinto', desc: 'Cabernet Sauvignon con notas de pimiento rojo, cassis y chocolate amargo.', image: 'https://images.unsplash.com/photo-1547592166-23ac45744acd?w=400&h=400&fit=crop' },
    { id: '3', code: 'TIN003', name: 'Bonarda Domingo Molina', price: 4800, cost: 3000, stock: 25, category: 'Tinto', desc: 'Bonarda frutado y vibrante. Perfecto para carnes rojas y pastas.', image: 'https://images.unsplash.com/photo-1506377247377-2a5b3b417ebb?w=400&h=400&fit=crop' },
    { id: '4', code: 'TIN004', name: 'Syrah Lagarde', price: 5500, cost: 3500, stock: 18, category: 'Tinto', desc: 'Syrah de cuerpo medio con aromas a moras, pimienta negra y hierbas.', image: 'https://images.unsplash.com/photo-1569529465841-dfecdab7503b?w=400&h=400&fit=crop' },
    { id: '5', code: 'BLA001', name: 'Torrontés Cielo y Tierra', price: 3900, cost: 2500, stock: 30, category: 'Blanco', desc: 'Torrontés fresco y floral. Ideal como aperitivo o con sushi.', image: 'https://images.unsplash.com/photo-1558001373-7b93ee48ffa0?w=400&h=400&fit=crop' },
    { id: '6', code: 'BLA002', name: 'Chardonnay Navarro Correas', price: 5200, cost: 3400, stock: 22, category: 'Blanco', desc: 'Chardonnay con notas de pera, manzana y vainilla. Crianza en barrica.', image: 'https://images.unsplash.com/photo-1559563458-527698bf5295?w=400&h=400&fit=crop' },
    { id: '7', code: 'BLA003', name: 'Sauvignon Blanc Salentein', price: 4800, cost: 3100, stock: 16, category: 'Blanco', desc: 'Sauvignon Blanc cítrico y herbáceo. Perfecto con ensaladas y pescados.', image: 'https://images.unsplash.com/photo-1474722883778-792e7990302f?w=400&h=400&fit=crop' },
    { id: '8', code: 'BLA004', name: 'Viognier Del Fin del Mundo', price: 4500, cost: 2900, stock: 20, category: 'Blanco', desc: 'Viognier floral con notas de durazno y damasco. Textura sedosa.', image: 'https://images.unsplash.com/photo-1568213816046-0ee1f42bd2e2?w=400&h=400&fit=crop' },
    { id: '9', code: 'ROS001', name: 'Rosé de Malbec Valentín Bianchi', price: 4200, cost: 2700, stock: 15, category: 'Rosado', desc: 'Rosé de Malbec fresco y vibrante. Aromas a frutillas y cerezas.', image: 'https://images.unsplash.com/photo-1681930673962-1c76ae02f0a3?w=400&h=400&fit=crop' },
    { id: '10', code: 'ROS002', name: 'Rosado de Syrah Dante Robino', price: 3800, cost: 2400, stock: 18, category: 'Rosado', desc: 'Rosado de Syrah con notas a frambuesa y un final cítrico.', image: 'https://images.unsplash.com/photo-1578911595546-1e9e5d12d38a?w=400&h=400&fit=crop' },
    { id: '11', code: 'ESP001', name: 'Extra Brut Chandon', price: 7500, cost: 5000, stock: 12, category: 'Espumante', desc: 'Extra Brut elegante y complejo. Burbujas finas y persistentes.', image: 'https://images.unsplash.com/photo-1528823872057-9c018a7a7553?w=400&h=400&fit=crop' },
    { id: '12', code: 'ESP002', name: 'Brut Nature Nieto Senetiner', price: 6800, cost: 4500, stock: 10, category: 'Espumante', desc: 'Brut Nature sin azúcar residual. Fresco y mineral.', image: 'https://images.unsplash.com/photo-1516594915697-87eb3b1c14ea?w=400&h=400&fit=crop' },
  ];
  const ins = d.prepare(`INSERT INTO products (id, code, name, price, cost, stock, category, source, description, image, oferta, nuevo, webDesc, ofertaPrice, fichaTecnica, fichaTecnicaFile) VALUES (?,?,?,?,?,?,?,?,?,?,0,0,?,0,'','')`);
  for (const p of prods) {
    ins.run(p.id, p.code, p.name, p.price, p.cost, p.stock, p.category, 'web', p.desc, p.image, p.desc);
  }

  const pmts = [
    { id: 'pm1', name: 'Efectivo', requiresCash: 1, adjustment: 0 },
    { id: 'pm2', name: 'Tarjeta', requiresCash: 0, adjustment: 0 },
    { id: 'pm3', name: 'Transferencia', requiresCash: 0, adjustment: 0 },
  ];
  const insPmt = d.prepare('INSERT OR IGNORE INTO payment_methods (id, name, requiresCash, icon, adjustment) VALUES (?,?,?,\'\',?)');
  for (const pm of pmts) insPmt.run(pm.id, pm.name, pm.requiresCash, pm.adjustment);

  const cl = { id: 'c1', document: '99999999', name: 'Cliente General', phone: '-', email: 'general@nexuspos.com' };
  d.prepare('INSERT OR IGNORE INTO clients (id, document, name, phone, email) VALUES (?,?,?,?,?)').run(cl.id, cl.document, cl.name, cl.phone, cl.email);

  console.log('[API] Base de datos inicializada con productos de ejemplo');
}

ensureSchema();
seedIfEmpty();

// Migrate: add stock images to products without image
try {
  const d = getDb();
  const IMG_MAP = {
    'Tinto': 'https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?w=400&h=400&fit=crop',
    'Blanco': 'https://images.unsplash.com/photo-1558001373-7b93ee48ffa0?w=400&h=400&fit=crop',
    'Rosado': 'https://images.unsplash.com/photo-1541971897566-308cf7ad0934?w=400&h=400&fit=crop',
    'Espumante': 'https://images.unsplash.com/photo-1528823872057-9c018a7a7553?w=400&h=400&fit=crop',
  };
  const missing = d.prepare("SELECT id, category FROM products WHERE image IS NULL OR image = ''").all();
  const upd = d.prepare('UPDATE products SET image = ? WHERE id = ?');
  for (const row of missing) {
    const img = IMG_MAP[row.category] || 'https://images.unsplash.com/photo-1569529465841-dfecdab7503b?w=400&h=400&fit=crop';
    upd.run(img, row.id);
  }
  if (missing.length > 0) console.log(`[API] Imágenes asignadas a ${missing.length} productos`);
} catch (e) { console.log('[API] Migración de imágenes:', e.message); }

// ============ PRODUCTS ============
app.get('/api/products', (req, res) => {
  try {
    const rows = getDb().prepare('SELECT * FROM products ORDER BY name').all();
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/products', (req, res) => {
  try {
    const p = req.body;
    const id = p.id || Date.now().toString();
    getDb().prepare(`INSERT OR REPLACE INTO products (id, code, name, price, cost, stock, category, source, description, image, oferta, nuevo, webDesc, ofertaPrice, fichaTecnica, fichaTecnicaFile) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      id, p.code || '', p.name || '', Number(p.price) || 0, Number(p.cost) || 0, Number(p.stock) || 0,
      p.category || 'General', p.source || 'local', p.desc || '', p.image || '',
      p.oferta ? 1 : 0, p.nuevo ? 1 : 0, p.webDesc || '', Number(p.ofertaPrice) || 0,
      p.fichaTecnica || '', p.fichaTecnicaFile || ''
    );
    res.json({ success: true, id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/products/:id', (req, res) => {
  try {
    const p = req.body;
    getDb().prepare(`UPDATE products SET code=?, name=?, price=?, cost=?, stock=?, category=?, source=?, description=?, image=?, oferta=?, nuevo=?, webDesc=?, ofertaPrice=?, fichaTecnica=?, fichaTecnicaFile=? WHERE id=?`).run(
      p.code || '', p.name || '', Number(p.price) || 0, Number(p.cost) || 0, Number(p.stock) || 0,
      p.category || 'General', p.source || 'local', p.desc || '', p.image || '',
      p.oferta ? 1 : 0, p.nuevo ? 1 : 0, p.webDesc || '', Number(p.ofertaPrice) || 0,
      p.fichaTecnica || '', p.fichaTecnicaFile || '', req.params.id
    );
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/products/:id', (req, res) => {
  try {
    getDb().prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/products/bulk-price-update', (req, res) => {
  try {
    const pct = Number(req.body.percentage) || 0;
    const factor = 1 + pct / 100;
    const rows = getDb().prepare('SELECT * FROM products').all();
    let count = 0;
    for (const r of rows) {
      let newPrice = Math.round(r.price * factor);
      newPrice = Math.max(500, Math.min(1000, newPrice));
      getDb().prepare('UPDATE products SET price = ? WHERE id = ?').run(newPrice, r.id);
      count++;
    }
    res.json({ success: true, count });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ============ WEB DATA ============
app.get('/api/web-data', (req, res) => {
  try {
    const d = getDb();
    const dbProducts = d.prepare("SELECT * FROM products WHERE source = 'web'").all();
    const clients = d.prepare('SELECT * FROM clients').all();
    const repairs = d.prepare('SELECT * FROM repairs ORDER BY date DESC').all();
    const services = d.prepare('SELECT * FROM web_services ORDER BY name').all();
    const config = getConfig('webConfig', {});
    const categories = d.prepare('SELECT * FROM web_categories ORDER BY name').all();
    res.json({ products: dbProducts, clients, repairs, services, config, categories });
  } catch { res.json({ products: [], clients: [], repairs: [], services: [], config: {}, categories: [] }); }
});

app.post('/api/web-save', (req, res) => {
  try {
    const data = req.body;
    const d = getDb();
    const upsertProduct = d.prepare(`INSERT OR REPLACE INTO products (id, code, name, price, cost, stock, category, source, description, image, oferta, nuevo, webDesc, ofertaPrice, fichaTecnica, fichaTecnicaFile) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const delCats = d.prepare('DELETE FROM web_categories');
    const insCat = d.prepare('INSERT INTO web_categories (id, name) VALUES (?,?)');
    const delSvcs = d.prepare('DELETE FROM web_services');
    const insSvc = d.prepare('INSERT INTO web_services (id, name, desc, icon, price) VALUES (?,?,?,?,?)');
    d.transaction(() => {
      for (const p of (data.products || [])) {
        upsertProduct.run(p.id, p.code || '', p.name || '', Number(p.price) || 0, Number(p.cost) || 0, Number(p.stock) || 0, p.category || 'Varios', 'web', p.desc || p.webDesc || '', p.image || '', p.oferta ? 1 : 0, p.nuevo ? 1 : 0, p.webDesc || p.desc || '', Number(p.ofertaPrice) || 0, p.fichaTecnica || '', p.fichaTecnicaFile || '');
      }
      delCats.run();
      for (const c of (data.categories || [])) { insCat.run(c.id, c.name || ''); }
      delSvcs.run();
      for (const s of (data.services || [])) { insSvc.run(s.id, s.name || '', s.desc || '', s.icon || '', Number(s.price) || 0); }
      if (data.config) setConfig('webConfig', data.config);
    })();
    res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ============ NOTES ============
app.get('/api/notes', (req, res) => {
  try {
    const rows = getDb().prepare('SELECT * FROM notes ORDER BY date DESC').all();
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/notes', (req, res) => {
  try {
    const n = req.body;
    const id = Date.now().toString();
    getDb().prepare('INSERT INTO notes (id, title, content, date, category) VALUES (?,?,?,?,?)').run(
      id, n.title || '', n.content || '', new Date().toISOString(), n.category || 'General'
    );
    res.json({ success: true, id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/notes/:id', (req, res) => {
  try {
    const n = req.body;
    getDb().prepare('UPDATE notes SET title=?, content=?, category=? WHERE id=?').run(
      n.title || '', n.content || '', n.category || 'General', req.params.id
    );
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/notes/:id', (req, res) => {
  try {
    getDb().prepare('DELETE FROM notes WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ============ BACKUPS ============
app.get('/api/backups', (req, res) => {
  try {
    const backupsDir = BACKUPS_DIR;
    if (!fs.existsSync(backupsDir)) { fs.mkdirSync(backupsDir, { recursive: true }); return res.json([]); }
    const files = fs.readdirSync(backupsDir).filter(f => f.endsWith('.db') || f.endsWith('.json')).map(f => {
      const stat = fs.statSync(path.join(backupsDir, f));
      const ext = path.extname(f);
      const base = f.replace(ext, '');
      return {
        base,
        date: stat.birthtime.toISOString().replace('T', ' ').slice(0, 19),
        hasJson: ext === '.json',
        hasDb: ext === '.db',
      };
    }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    // Deduplicate by base name
    const seen = new Set();
    const deduped = files.filter((f) => {
      if (seen.has(f.base)) return false;
      seen.add(f.base);
      return true;
    });
    res.json(deduped);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/backups/create', (req, res) => {
  try {
    const d = getDb();
    const data = {};
    const tables = ['products', 'clients', 'providers', 'payment_methods', 'sales', 'sale_items', 'purchases', 'purchase_items', 'expenses', 'repairs', 'web_categories', 'web_services', 'notes', 'orders', 'app_config', 'restock_pending', 'monthly_stats', 'exchanges', 'site_visits'];
    for (const t of tables) {
      try { data[t] = d.prepare(`SELECT * FROM ${t}`).all(); } catch { data[t] = []; }
    }
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const backupFile = path.join(BACKUPS_DIR, `backup-${timestamp}.json`);
    if (!fs.existsSync(BACKUPS_DIR)) fs.mkdirSync(BACKUPS_DIR, { recursive: true });
    fs.writeFileSync(backupFile, JSON.stringify(data, null, 2));
    console.log(`[API] Backup creado: ${backupFile}`);
    res.json({ success: true, file: `backup-${timestamp}.json` });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/backups/restore', (req, res) => {
  try {
    const { base } = req.body;
    const dbFile = path.join(BACKUPS_DIR, base + '.db');
    const jsonFile = path.join(BACKUPS_DIR, base + '.json');
    if (fs.existsSync(dbFile)) {
      getDb().close();
      db = null;
      fs.copyFileSync(dbFile, DB_FILE);
      getDb();
      res.json({ success: true });
    } else if (fs.existsSync(jsonFile)) {
      const data = JSON.parse(fs.readFileSync(jsonFile, 'utf-8'));
      restoreFromJson(data);
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Backup no encontrado' });
    }
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ============ COMPANY CONFIG ============
app.get('/api/company-config', (req, res) => {
  try {
    const config = getConfig('companyConfig', {});
    res.json(config.companyName ? config : null);
  } catch { res.json(null); }
});

app.put('/api/company-config', (req, res) => {
  try {
    const existing = getConfig('companyConfig', {});
    const updated = { ...existing, ...req.body };
    setConfig('companyConfig', updated);
    res.json(updated);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ============ CASH REGISTER ============
app.get('/api/cash-register', (req, res) => {
  try {
    const cr = getConfig('cashRegister', { cash: 0, bank: 0 });
    res.json(cr);
  } catch { res.json({ cash: 0, bank: 0 }); }
});

app.put('/api/cash-register', (req, res) => {
  try {
    setConfig('cashRegister', req.body);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ============ SUPABASE ORDERS SYNC ============
app.get('/api/orders/supabase', async (req, res) => {
  try {
    const cfg = getConfig('companyConfig', {});
    if (!cfg.supabaseUrl || !cfg.supabaseKey) return res.json([]);
    const r = await fetch(cfg.supabaseUrl + '/rest/v1/orders?select=*&order=date.desc', {
      headers: { 'apikey': cfg.supabaseKey, 'Authorization': 'Bearer ' + cfg.supabaseKey }
    });
    if (!r.ok) return res.json([]);
    res.json(await r.json());
  } catch { res.json([]); }
});

app.post('/api/orders/sync-from-supabase', async (req, res) => {
  try {
    const cfg = getConfig('companyConfig', {});
    if (!cfg.supabaseUrl || !cfg.supabaseKey) return res.json({ synced: 0 });
    fs.appendFileSync(require('path').join(require('os').tmpdir(), 'nexus-sync.log'), 'Starting sync\n');
    const r = await fetch(cfg.supabaseUrl + '/rest/v1/orders?select=*&order=date.desc', {
      headers: { 'apikey': cfg.supabaseKey, 'Authorization': 'Bearer ' + cfg.supabaseKey }
    });
    if (!r.ok) { fs.appendFileSync(require('path').join(require('os').tmpdir(), 'nexus-sync.log'), 'Fetch failed: ' + r.status + '\n'); return res.json({ synced: 0 }); }
    const orders = await r.json();
    fs.appendFileSync(require('path').join(require('os').tmpdir(), 'nexus-sync.log'), 'Orders from supabase: ' + orders.length + '\n');
    const d = getDb();
    let synced = 0;
    for (const o of orders) {
      const existing = d.prepare('SELECT id FROM orders WHERE id = ?').get(o.id?.toString() || '');
      fs.appendFileSync(require('path').join(require('os').tmpdir(), 'nexus-sync.log'), 'Processing order id=' + o.id + ' existing=' + (existing ? existing.id : 'none') + '\n');
      if (!existing) {
        d.prepare(`INSERT INTO orders (id, client_name, client_phone, items, total, notes, delivery_type, status, date) VALUES (?,?,?,?,?,?,?,?,?)`).run(
          o.id?.toString() || 'sb-' + Date.now(), o.client_name || '', o.client_phone || '', typeof o.items === 'string' ? o.items : JSON.stringify(o.items || []), Number(o.total) || 0, o.notes || '', o.delivery_type || '', o.status || 'nuevo', o.date || new Date().toISOString()
        );
        synced++;
      }
    }
    fs.appendFileSync(require('path').join(require('os').tmpdir(), 'nexus-sync.log'), 'Synced: ' + synced + '\n');
    res.json({ synced });
  } catch (e) { fs.appendFileSync(require('path').join(require('os').tmpdir(), 'nexus-sync.log'), 'Error: ' + (e?.message || e) + '\n'); res.json({ synced: 0 }); }
});

// ============ SYNC STATUS & MISC ============
app.get('/api/auto-sync-status', (req, res) => {
  res.json({ pending: false, syncing: false, lastSync: null, error: null });
});

app.get('/api/status', (req, res) => {
  try {
    const d = getDb();
    const counts = {};
    const tables = ['products', 'clients', 'providers', 'payment_methods', 'sales', 'purchases', 'expenses', 'repairs', 'web_categories', 'web_services', 'notes', 'orders'];
    for (const t of tables) {
      try { counts[t] = (d.prepare(`SELECT COUNT(*) as c FROM ${t}`).get()).c; } catch { counts[t] = 0; }
    }
    res.json({
      pid: process.pid,
      ppid: process.ppid,
      uptime: formatUptime(process.uptime()),
      uptimeSeconds: process.uptime(),
      memory: {
        rss: formatBytes(process.memoryUsage().rss),
        heapTotal: formatBytes(process.memoryUsage().heapTotal),
        heapUsed: formatBytes(process.memoryUsage().heapUsed),
      },
      nodeVersion: process.version,
      platform: process.platform,
      dbSize: fs.existsSync(DB_FILE) ? formatBytes(fs.statSync(DB_FILE).size) : '0 B',
      dbSizeBytes: fs.existsSync(DB_FILE) ? fs.statSync(DB_FILE).size : 0,
      counts,
      children: [],
      gitRemote: 'local',
      lastSync: null,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/backup', (req, res) => {
  try {
    const d = getDb();
    const data = {};
    const tables = ['products', 'clients', 'providers', 'payment_methods', 'sales', 'sale_items', 'purchases', 'purchase_items', 'expenses', 'repairs', 'web_categories', 'web_services', 'notes', 'orders', 'app_config', 'restock_pending', 'monthly_stats', 'exchanges', 'site_visits'];
    for (const t of tables) {
      try { data[t] = d.prepare(`SELECT * FROM ${t}`).all(); } catch { data[t] = []; }
    }
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="backup-${Date.now()}.json"`);
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/restore', (req, res) => {
  try {
    restoreFromJson(req.body);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/backups/encrypted', (req, res) => {
  res.json([]);
});

app.post('/api/backups/restore-encrypted', (req, res) => {
  res.status(400).json({ error: 'No hay backups encriptados disponibles' });
});

app.post('/api/backups/restore-last', (req, res) => {
  res.status(400).json({ error: 'No hay backups disponibles' });
});

app.post('/api/sync-full', (req, res) => {
  res.json({ success: true, message: 'Sync no disponible en modo Lite' });
});

app.get('/api/download-app', (req, res) => {
  res.json({ success: false, error: 'Descarga no disponible en modo Lite' });
});

app.post('/api/deploy-ghpages', async (req, res) => {
  try {
    const { token, repo } = req.body;
    if (!token || !repo) return res.status(400).json({ success: false, error: 'Token y repositorio requeridos' });

    const api = 'https://api.github.com';
    const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'nexus-lite' };

    // 1. Get latest commit SHA from default branch
    const repoResp = await fetch(`${api}/repos/${repo}`, { headers });
    if (!repoResp.ok) return res.status(400).json({ success: false, error: 'Repositorio no encontrado o token inválido' });
    const repoData = await repoResp.json();
    const defaultBranch = repoData.default_branch;

    const refResp = await fetch(`${api}/repos/${repo}/git/ref/heads/${defaultBranch}`, { headers });
    if (!refResp.ok) return res.status(400).json({ success: false, error: 'No se pudo obtener la rama por defecto' });
    const refData = await refResp.json();
    const baseSha = refData.object.sha;

    // 2. Build tree from web/ directory
    const files = [];
    function walkDir(dir, prefix) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        const rel = prefix ? prefix + '/' + entry.name : entry.name;
        if (entry.isDirectory()) walkDir(full, rel);
        else files.push({ path: rel, content: fs.readFileSync(full, 'utf-8') });
      }
    }
    if (!fs.existsSync(WEB_DIR)) return res.status(400).json({ success: false, error: 'No se encontró el directorio web/' });
    walkDir(WEB_DIR, '');

    // Generate data.json with current web data
    try {
      const d = getDb();
      const dbProducts = d.prepare("SELECT * FROM products WHERE source = 'web'").all();
      const categories = d.prepare('SELECT * FROM web_categories ORDER BY name').all();
      const services = d.prepare('SELECT * FROM web_services ORDER BY name').all();
      const config = getConfig('webConfig', {});
      const companyCfg = getConfig('companyConfig', {});
      const webData = { products: dbProducts, categories, services, config, supabaseUrl: companyCfg.supabaseUrl || '', supabaseKey: companyCfg.supabaseKey || '' };
      files.push({ path: 'data.json', content: JSON.stringify(webData) });
    } catch (e) {
      console.error('[deploy] Error generating data.json:', e.message);
    }

    const treeItems = files.map(f => ({
      path: f.path,
      mode: '100644',
      type: 'blob',
      content: f.content,
    }));

    const treeResp = await fetch(`${api}/repos/${repo}/git/trees`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ tree: treeItems }),
    });
    if (!treeResp.ok) return res.status(500).json({ success: false, error: 'Error al crear el tree' });
    const treeData = await treeResp.json();
    const treeSha = treeData.sha;

    // 3. Create commit (orphan, no parent)
    const commitResp = await fetch(`${api}/repos/${repo}/git/commits`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Deploy Nexus Lite Web', tree: treeSha, parents: [] }),
    });
    if (!commitResp.ok) return res.status(500).json({ success: false, error: 'Error al crear el commit' });
    const commitData = await commitResp.json();
    const commitSha = commitData.sha;

    // 4. Update gh-pages branch
    const ghResp = await fetch(`${api}/repos/${repo}/git/refs/heads/gh-pages`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sha: commitSha, force: true }),
    });
    if (!ghResp.ok) {
      // Try creating the branch if it doesn't exist
      const createResp = await fetch(`${api}/repos/${repo}/git/refs`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ref: 'refs/heads/gh-pages', sha: commitSha }),
      });
      if (!createResp.ok) return res.status(500).json({ success: false, error: 'Error al crear la rama gh-pages' });
    }

    // 5. Enable GitHub Pages (optional)
    await fetch(`${api}/repos/${repo}/pages`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: { branch: 'gh-pages', path: '/' } }),
    }).catch(() => {});

    res.json({ success: true, url: `https://${repo.toLowerCase().replace('/', '.github.io/')}/` });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/import-from-web', (req, res) => {
  res.json({ success: true, imported: 0, updated: 0, message: 'Importación no disponible en modo Lite' });
});

app.get('/api/visits', (req, res) => {
  res.json({ total: 0, today: 0, lastDays: [] });
});

// ============ WEB STORE (static files) ============
app.use('/web', express.static(WEB_DIR, { maxAge: 0 }));
app.get('/web/*', (req, res) => {
  res.sendFile(path.join(WEB_DIR, 'index.html'));
});

// ============ ORDERS ============
try {
  getDb().prepare(`CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    items TEXT NOT NULL DEFAULT '[]',
    total REAL NOT NULL DEFAULT 0,
    clientName TEXT DEFAULT '',
    clientPhone TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pendiente',
    deliveryType TEXT DEFAULT ''
  )`).run();
  try { getDb().prepare("ALTER TABLE orders ADD COLUMN deliveryType TEXT DEFAULT ''").run(); } catch {}
} catch (e) { console.error('[API] Error creating orders table:', e.message); }

app.get('/api/orders/subscribe', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('event: connected\ndata: {}\n\n');
  sseClients.push(res);
  const keepAlive = setInterval(() => {
    try { res.write(':keepalive\n\n'); } catch { clearInterval(keepAlive); }
  }, 15000);
  req.on('close', () => {
    clearInterval(keepAlive);
    const idx = sseClients.indexOf(res);
    if (idx !== -1) sseClients.splice(idx, 1);
  });
});

app.get('/api/orders', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  try {
    const rows = getDb().prepare('SELECT * FROM orders ORDER BY date DESC').all();
    res.json(rows.map(r => ({ ...r, items: JSON.parse(r.items || '[]') })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/orders', (req, res) => {
  try {
    const { items, total, clientName, clientPhone, notes, deliveryType } = req.body;
    const id = 'PED-' + Date.now().toString().slice(-6);
    const date = new Date().toISOString().slice(0, 19).replace('T', ' ');
    getDb().prepare('INSERT INTO orders (id, date, items, total, clientName, clientPhone, notes, status, deliveryType) VALUES (?,?,?,?,?,?,?,?,?)').run(
      id, date, JSON.stringify(items || []), Number(total) || 0, clientName || '', clientPhone || '', notes || '', 'pendiente', deliveryType || ''
    );
    const newOrder = { id, date, items, total, clientName, clientPhone, notes, status: 'pendiente', deliveryType: deliveryType || '' };
    broadcastSSE('new-order', newOrder);
    res.status(201).json(newOrder);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/orders/:id', (req, res) => {
  try {
    const existing = getDb().prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Order not found' });
    const { status, clientName, clientPhone, notes, deliveryType } = req.body;
    getDb().prepare('UPDATE orders SET status=?, clientName=?, clientPhone=?, notes=?, deliveryType=? WHERE id=?').run(
      status || existing.status,
      clientName !== undefined ? clientName : existing.clientName,
      clientPhone !== undefined ? clientPhone : existing.clientPhone,
      notes !== undefined ? notes : existing.notes,
      deliveryType !== undefined ? deliveryType : (existing.deliveryType || ''),
      req.params.id
    );
    const row = getDb().prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
    res.json({ ...row, items: JSON.parse(row.items || '[]') });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/orders/:id', (req, res) => {
  try {
    const r = getDb().prepare('DELETE FROM orders WHERE id = ?').run(req.params.id);
    res.json({ success: r.changes > 0 });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ============ SPA (built files) ============
if (IS_STANDALONE && fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR));
  app.get('*', (req, res) => {
    res.sendFile(path.join(DIST_DIR, 'index.html'));
  });
  console.log(`[API] Sirviendo SPA desde ${DIST_DIR}`);
}

// ============ HELPERS ============
function getConfig(key, def = null) {
  try {
    const row = getDb().prepare('SELECT value FROM app_config WHERE key = ?').get(key);
    return row ? JSON.parse(row.value) : def;
  } catch { return def; }
}

function setConfig(key, value) {
  getDb().prepare('INSERT OR REPLACE INTO app_config (key, value) VALUES (?,?)').run(key, JSON.stringify(value));
}

function restoreFromJson(data) {
  const d = getDb();
  const tables = ['products', 'clients', 'providers', 'payment_methods', 'sales', 'sale_items', 'purchases', 'purchase_items', 'expenses', 'repairs', 'web_categories', 'web_services', 'notes', 'orders', 'app_config', 'restock_pending', 'monthly_stats', 'exchanges', 'site_visits'];
  d.transaction(() => {
    for (const t of tables) {
      try { d.prepare(`DELETE FROM ${t}`).run(); } catch {}
    }
    for (const t of tables) {
      const rows = data[t];
      if (!rows || !Array.isArray(rows) || rows.length === 0) continue;
      for (const row of rows) {
        const keys = Object.keys(row);
        const vals = keys.map(k => row[k]);
        try {
          d.prepare(`INSERT INTO ${t} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...vals);
        } catch {}
      }
    }
  })();
}

function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${d}d ${h}h ${m}m ${s}s`;
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}



function startServer(port, cb) {
  const srv = app.listen(port, '0.0.0.0', cb);
  srv.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`[API] Puerto ${port} ocupado, liberando...`);
      exec(`netstat -ano | findstr :${port} | findstr LISTENING`, (e, stdout) => {
        if (stdout) {
          const parts = stdout.trim().split(/\s+/);
          const pid = parts[parts.length - 1];
          if (pid) {
            try { process.kill(parseInt(pid)); } catch {}
            setTimeout(() => startServer(port, cb), 1000);
            return;
          }
        }
        console.log(`[API] No se pudo liberar el puerto ${port}, usando puerto ${port + 1}`);
        startServer(port + 1, cb);
      });
    } else {
      console.error('[API] Error al iniciar servidor:', err.message);
      process.exit(1);
    }
  });
}

startServer(PORT, () => {
  console.log(`=========================================`);
  console.log(`  Malcriado Vinos - API Server`);
  console.log(`  Puerto: ${PORT}`);
  console.log(`  Base de datos: ${DB_FILE}`);
  console.log(`  Tienda Web: http://localhost:${PORT}/web/`);
  console.log(`=========================================`);
  if (IS_STANDALONE && process.env.BROWSER !== 'none') {
    setTimeout(() => {
      exec(`start http://localhost:${PORT}`, (err) => {
        if (err) console.log('[API] No se pudo abrir el navegador:', err.message);
      });
    }, 1000);
  }
});
