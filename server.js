require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey';

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '.')));

// SQLite Database Setup - use root directory on Railway
const dbPath = path.join(__dirname, 'fares.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Database error:', err);
    process.exit(1);
  } else {
    console.log('Connected to SQLite database');
    initializeDatabase();
    setTimeout(() => {
      startServer();
    }, 1000);
  }
});

// Promise wrappers for SQLite
const dbRun = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
};

const dbGet = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

const dbAll = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
};

// Initialize Database
function initializeDatabase() {
  db.serialize(() => {
    db.run(`
      CREATE TABLE IF NOT EXISTS fares (
        id TEXT PRIMARY KEY,
        \`from\` TEXT NOT NULL,
        via TEXT,
        \`to\` TEXT NOT NULL,
        airline TEXT NOT NULL,
        currency TEXT NOT NULL,
        price REAL NOT NULL,
        available_seats INTEGER,
        date_from TEXT,
        dep_time TEXT,
        arr_time TEXT,
        duration TEXT,
        baggage TEXT,
        notes TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS settings (
        id INTEGER PRIMARY KEY,
        agency_name TEXT,
        whatsapp_number TEXT,
        whatsapp_message TEXT,
        admin_password TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `, async () => {
      db.get('SELECT COUNT(*) as count FROM settings', async (err, row) => {
        if (!err && row.count === 0) {
          const hashedPassword = await bcrypt.hash('admin123', 10);
          db.run(
            'INSERT INTO settings (agency_name, whatsapp_number, whatsapp_message, admin_password) VALUES (?, ?, ?, ?)',
            ['Group Fare Board', '', 'Hi! I saw your group fares and I\'m interested in booking.', hashedPassword],
            () => console.log('✓ Default settings created')
          );
        }
      });
    });

    db.run(`
      CREATE TABLE IF NOT EXISTS feedback (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT,
        rating INTEGER,
        message TEXT NOT NULL,
        timestamp TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
  });
}

// JWT authentication middleware
const verifyAdmin = (req, res, next) => {
  const token = req.headers.authorization;

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    res.status(403).json({ error: 'Invalid token' });
  }
};

// ===== AUTH ROUTES =====

// Login route
app.post('/api/login', async (req, res) => {
  try {
    const { password } = req.body;

    const settings = await dbGet('SELECT admin_password FROM settings LIMIT 1');
    if (!settings) {
      return res.status(500).json({ error: 'No settings found' });
    }

    const valid = await bcrypt.compare(password, settings.admin_password);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid password' });
    }

    const token = jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '2h' });

    res.json({ token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== FARES ROUTES =====

// Get all fares (PUBLIC)
app.get('/api/fares', async (req, res) => {
  try {
    const fares = await dbAll('SELECT * FROM fares ORDER BY created_at DESC');
    
    const formattedFares = fares.map(f => ({
      id: f.id,
      from: f.from,
      via: f.via,
      to: f.to,
      airline: f.airline,
      currency: f.currency,
      price: parseFloat(f.price),
      availableSeats: f.available_seats,
      dateFrom: f.date_from,
      depTime: f.dep_time,
      arrTime: f.arr_time,
      duration: f.duration,
      baggage: f.baggage,
      notes: f.notes
    }));
    
    res.json(formattedFares);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add fare (ADMIN ONLY)
app.post('/api/fares', verifyAdmin, async (req, res) => {
  try {
    const { id, from, via, to, airline, currency, price, availableSeats, dateFrom, depTime, arrTime, duration, baggage, notes } = req.body;
    
    if (!from || !to || !airline || !price) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    await dbRun(
      'INSERT INTO fares (id, `from`, via, `to`, airline, currency, price, available_seats, date_from, dep_time, arr_time, duration, baggage, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [String(id), from, via, to, airline, currency, price, availableSeats, dateFrom, depTime, arrTime, duration, baggage, notes]
    );
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update fare (ADMIN ONLY)
app.put('/api/fares/:id', verifyAdmin, async (req, res) => {
  try {
    const { from, via, to, airline, currency, price, availableSeats, dateFrom, depTime, arrTime, duration, baggage, notes } = req.body;
    
    await dbRun(
      'UPDATE fares SET `from`=?, via=?, `to`=?, airline=?, currency=?, price=?, available_seats=?, date_from=?, dep_time=?, arr_time=?, duration=?, baggage=?, notes=? WHERE id=?',
      [from, via, to, airline, currency, price, availableSeats, dateFrom, depTime, arrTime, duration, baggage, notes, req.params.id]
    );
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete fare (ADMIN ONLY)
app.delete('/api/fares/:id', verifyAdmin, async (req, res) => {
  try {
    await dbRun('DELETE FROM fares WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== SETTINGS ROUTES =====

// Get settings (PUBLIC)
app.get('/api/settings', async (req, res) => {
  try {
    const settings = await dbGet(
      'SELECT id, agency_name as name, whatsapp_number as wa, whatsapp_message as waMsg FROM settings LIMIT 1'
    );
    
    console.log('Settings returned:', settings);
    res.json(settings || {
      name: 'Group Fare Board',
      wa: '',
      waMsg: 'Hi! I saw your group fares and I\'m interested in booking.'
    });
  } catch (err) {
    console.error('Error getting settings:', err);
    res.status(500).json({ error: err.message });
  }
});

// Update settings (ADMIN ONLY)
app.post('/api/settings', verifyAdmin, async (req, res) => {
  try {
    const { name, wa, waMsg } = req.body;
    
    const existing = await dbGet('SELECT id FROM settings LIMIT 1');
    
    if (existing) {
      await dbRun(
        'UPDATE settings SET agency_name=?, whatsapp_number=?, whatsapp_message=? WHERE id=?',
        [name, wa, waMsg, existing.id]
      );
    } else {
      await dbRun(
        'INSERT INTO settings (agency_name, whatsapp_number, whatsapp_message) VALUES (?, ?, ?)',
        [name, wa, waMsg]
      );
    }
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Change password (ADMIN ONLY)
app.post('/api/change-password', verifyAdmin, async (req, res) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }
    
    const existing = await dbGet('SELECT id FROM settings LIMIT 1');
    
    if (existing) {
      const hashed = await bcrypt.hash(newPassword, 10);
      await dbRun(
        'UPDATE settings SET admin_password=? WHERE id=?',
        [hashed, existing.id]
      );
    } else {
      const hashed = await bcrypt.hash(newPassword, 10);
      await dbRun(
        'INSERT INTO settings (admin_password) VALUES (?)',
        [hashed]
      );
    }
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Submit feedback (PUBLIC)
app.post('/api/feedback', async (req, res) => {
  try {
    const { name, email, rating, message, timestamp } = req.body;
    
    if (!name || !message) {
      return res.status(400).json({ error: 'Name and message are required' });
    }
    
    await dbRun(
      'INSERT INTO feedback (name, email, rating, message, timestamp) VALUES (?, ?, ?, ?, ?)',
      [name, email || '', rating || 0, message, timestamp || new Date().toISOString()]
    );
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get feedback (ADMIN ONLY)
app.get('/api/feedback', verifyAdmin, async (req, res) => {
  try {
    const feedbacks = await dbAll('SELECT * FROM feedback ORDER BY timestamp DESC');
    res.json(feedbacks);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete feedback (ADMIN ONLY)
app.delete('/api/feedback', verifyAdmin, async (req, res) => {
  try {
    const { name, email, timestamp } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }
    
    await dbRun(
      'DELETE FROM feedback WHERE name = ? AND email = ? AND timestamp = ?',
      [name, email || '', timestamp]
    );
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Start server function
function startServer() {
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => {
    console.log(`\n🚀 Server running on http://localhost:${PORT}`);
    console.log(`✓ Using SQLite database: ${dbPath}`);
    console.log(`✓ JWT Secret: ${JWT_SECRET}\n`);
  });
}
