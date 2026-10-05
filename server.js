/**
 * Smart Parking System - Node.js & Express Backend
 * Fully deployable on Render with SQLite database, REST APIs,
 * JWT Authentication, real-time IoT synchronization, and Indian Timezone support.
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'smart-parking-secret-key-purple-iot-2026';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve frontend static assets from 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// -------------------------------------------------------------
// Timezone Helper Functions (Asia/Kolkata - UTC +5:30)
// -------------------------------------------------------------
function getISTDateTime() {
  const options = {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  };
  return new Date().toLocaleString('en-IN', options);
}

function getISTDateParts() {
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
  const timeStr = now.toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  });
  return { date: dateStr, time: timeStr, full: `${dateStr} ${timeStr}` };
}

// -------------------------------------------------------------
// Status Calculation Logic
// -------------------------------------------------------------
// | Vehicle | Reserved | Final Status |
// | No (0)  | No (0)   | AVAILABLE    |
// | No (0)  | Yes (1)  | RESERVED     |
// | Yes (1) | No (0)   | OCCUPIED     |
// | Yes (1) | Yes (1)  | OCCUPIED     |
function calculateStatus(vehicleDetected, isReserved) {
  if (vehicleDetected) return 'occupied';
  if (isReserved) return 'reserved';
  return 'available';
}

function getLedStatus(status) {
  if (status === 'occupied') return 'ON (RED)';
  if (status === 'reserved') return 'ON (YELLOW)';
  return 'OFF (GREEN)';
}

// -------------------------------------------------------------
// ESP8266 Live Communication Tracker (Online / Offline)
// -------------------------------------------------------------
let lastEspCommunication = 0; // Timestamp in milliseconds
const ESP_ONLINE_THRESHOLD_MS = 15000; // 15 seconds threshold

function isEspOnline() {
  if (!lastEspCommunication) return false;
  return (Date.now() - lastEspCommunication) < ESP_ONLINE_THRESHOLD_MS;
}

function recordEspActivity() {
  lastEspCommunication = Date.now();
}

// -------------------------------------------------------------
// SQLite Database Initialization
// -------------------------------------------------------------
const DB_PATH = path.join(__dirname, 'parking.db');
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('❌ Error opening SQLite database:', err.message);
  } else {
    console.log('✅ Connected to SQLite database: parking.db');
    initDatabase();
  }
});

function initDatabase() {
  db.serialize(() => {
    // 1. Slots Table
    db.run(`
      CREATE TABLE IF NOT EXISTS slots (
        id INTEGER PRIMARY KEY,
        slot_number INTEGER UNIQUE NOT NULL,
        status TEXT NOT NULL DEFAULT 'available',
        vehicle_detected INTEGER NOT NULL DEFAULT 0,
        reserved INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT
      )
    `);

    // 2. Users Table
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        created_at TEXT
      )
    `);

    // 3. Reservations Table
    db.run(`
      CREATE TABLE IF NOT EXISTS reservations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        slot_number INTEGER NOT NULL,
        user_id INTEGER,
        user_name TEXT,
        user_email TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        reserved_at TEXT,
        cancelled_at TEXT
      )
    `);

    // Seed Slots 1 and 2 if they don't already exist
    const istTime = getISTDateTime();
    db.get('SELECT COUNT(*) AS count FROM slots', (err, row) => {
      if (!err && row.count === 0) {
        const stmt = db.prepare('INSERT INTO slots (slot_number, status, vehicle_detected, reserved, updated_at) VALUES (?, ?, ?, ?, ?)');
        stmt.run(1, 'available', 0, 0, istTime);
        stmt.run(2, 'available', 0, 0, istTime);
        stmt.finalize(() => {
          console.log('✅ Seeded initial parking slots (Slot 1, Slot 2)');
        });
      }
    });

    // Seed default demo user for easy testing
    db.get('SELECT COUNT(*) AS count FROM users', (err, row) => {
      if (!err && row.count === 0) {
        const defaultPassword = 'password123';
        const salt = bcrypt.genSaltSync(10);
        const hashedPassword = bcrypt.hashSync(defaultPassword, salt);
        db.run(
          'INSERT INTO users (name, email, password, created_at) VALUES (?, ?, ?, ?)',
          ['Demo User', 'demo@parking.com', hashedPassword, istTime],
          () => {
            console.log('✅ Seeded demo user: demo@parking.com / password123');
          }
        );
      }
    });
  });
}

// -------------------------------------------------------------
// Authentication Helper & Middleware
// -------------------------------------------------------------
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ success: false, message: 'Invalid or expired session' });
    }
    req.user = user;
    next();
  });
}

// Optional Auth (attaches req.user if available)
function optionalAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (token) {
    jwt.verify(token, JWT_SECRET, (err, user) => {
      if (!err) req.user = user;
      next();
    });
  } else {
    next();
  }
}

// -------------------------------------------------------------
// Authentication REST APIs
// -------------------------------------------------------------

// POST /api/auth/register
app.post('/api/auth/register', (req, res) => {
  const { name, email, password } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ success: false, message: 'Name, email, and password are required' });
  }

  const cleanEmail = email.trim().toLowerCase();
  const istTime = getISTDateTime();

  db.get('SELECT id FROM users WHERE email = ?', [cleanEmail], (err, existingUser) => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Database query error' });
    }
    if (existingUser) {
      return res.status(409).json({ success: false, message: 'An account with this email already exists' });
    }

    const salt = bcrypt.genSaltSync(10);
    const hashedPassword = bcrypt.hashSync(password, salt);

    db.run(
      'INSERT INTO users (name, email, password, created_at) VALUES (?, ?, ?, ?)',
      [name.trim(), cleanEmail, hashedPassword, istTime],
      function (insertErr) {
        if (insertErr) {
          return res.status(500).json({ success: false, message: 'Failed to create user account' });
        }

        const newUser = { id: this.lastID, name: name.trim(), email: cleanEmail };
        const token = jwt.sign(newUser, JWT_SECRET, { expiresIn: '7d' });

        return res.status(201).json({
          success: true,
          message: 'Account registered successfully',
          token,
          user: newUser
        });
      }
    );
  });
});

// POST /api/auth/login
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Email and password are required' });
  }

  const cleanEmail = email.trim().toLowerCase();

  db.get('SELECT * FROM users WHERE email = ?', [cleanEmail], (err, user) => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Database query error' });
    }
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    const isMatch = bcrypt.compareSync(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    const userData = { id: user.id, name: user.name, email: user.email };
    const token = jwt.sign(userData, JWT_SECRET, { expiresIn: '7d' });

    return res.json({
      success: true,
      message: 'Login successful',
      token,
      user: userData
    });
  });
});

// GET /api/auth/me
app.get('/api/auth/me', authenticateToken, (req, res) => {
  db.get('SELECT id, name, email, created_at FROM users WHERE id = ?', [req.user.id], (err, user) => {
    if (err || !user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    return res.json({ success: true, user });
  });
});

// -------------------------------------------------------------
// ESP8266 & Parking Communication REST APIs
// -------------------------------------------------------------

/**
 * POST /api/parking/update
 * ESP8266 sends real-time IR sensor readings.
 * Expected payload:
 * {
 *   "slot1": { "vehicleDetected": true/false },
 *   "slot2": { "vehicleDetected": true/false }
 * }
 */
app.post('/api/parking/update', (req, res) => {
  recordEspActivity();

  const { slot1, slot2 } = req.body;
  const istTime = getISTDateTime();

  db.all('SELECT * FROM slots ORDER BY slot_number ASC', (err, rows) => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Database error reading slots' });
    }

    const slot1Data = rows.find(r => r.slot_number === 1) || { reserved: 0, vehicle_detected: 0 };
    const slot2Data = rows.find(r => r.slot_number === 2) || { reserved: 0, vehicle_detected: 0 };

    // Parse Slot 1 vehicle state
    let slot1Vehicle = slot1Data.vehicle_detected;
    if (slot1 !== undefined) {
      if (typeof slot1 === 'boolean') slot1Vehicle = slot1 ? 1 : 0;
      else if (slot1.vehicleDetected !== undefined) slot1Vehicle = slot1.vehicleDetected ? 1 : 0;
    }

    // Parse Slot 2 vehicle state
    let slot2Vehicle = slot2Data.vehicle_detected;
    if (slot2 !== undefined) {
      if (typeof slot2 === 'boolean') slot2Vehicle = slot2 ? 1 : 0;
      else if (slot2.vehicleDetected !== undefined) slot2Vehicle = slot2.vehicleDetected ? 1 : 0;
    }

    // Calculate final status per prompt specifications
    const slot1Status = calculateStatus(slot1Vehicle === 1, slot1Data.reserved === 1);
    const slot2Status = calculateStatus(slot2Vehicle === 1, slot2Data.reserved === 1);

    // Update SQLite database
    db.serialize(() => {
      db.run(
        'UPDATE slots SET vehicle_detected = ?, status = ?, updated_at = ? WHERE slot_number = 1',
        [slot1Vehicle, slot1Status, istTime]
      );
      db.run(
        'UPDATE slots SET vehicle_detected = ?, status = ?, updated_at = ? WHERE slot_number = 2',
        [slot2Vehicle, slot2Status, istTime]
      );
    });

    // Calculate KPI summary counts
    const slotsList = [
      { status: slot1Status, reserved: slot1Data.reserved === 1, vehicleDetected: slot1Vehicle === 1 },
      { status: slot2Status, reserved: slot2Data.reserved === 1, vehicleDetected: slot2Vehicle === 1 }
    ];

    const totalSlots = 2;
    const availableSlots = slotsList.filter(s => s.status === 'available').length;
    const reservedSlots = slotsList.filter(s => s.status === 'reserved').length;
    const occupiedSlots = slotsList.filter(s => s.status === 'occupied').length;

    return res.json({
      success: true,
      message: 'Parking slots updated successfully',
      totalSlots,
      availableSlots,
      reservedSlots,
      occupiedSlots,
      slots: {
        slot1: {
          status: slot1Status,
          reserved: slot1Data.reserved === 1,
          vehicleDetected: slot1Vehicle === 1,
          led: slot1Status === 'available' ? 'OFF' : 'ON'
        },
        slot2: {
          status: slot2Status,
          reserved: slot2Data.reserved === 1,
          vehicleDetected: slot2Vehicle === 1,
          led: slot2Status === 'available' ? 'OFF' : 'ON'
        }
      }
    });
  });
});

/**
 * GET /api/parking/status
 * Called periodically by ESP8266 and the web dashboard.
 * Returns real-time counts, slot details, and ESP8266 connectivity.
 */
app.get('/api/parking/status', (req, res) => {
  // If ESP8266 is making the request, update heartbeat
  const userAgent = req.headers['user-agent'] || '';
  const isEsp = req.query.source === 'esp8266' || userAgent.includes('ESP8266');
  if (isEsp) {
    recordEspActivity();
  }

  db.all('SELECT * FROM slots ORDER BY slot_number ASC', (err, rows) => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Database error reading slots' });
    }

    const slot1 = rows.find(r => r.slot_number === 1) || { status: 'available', reserved: 0, vehicle_detected: 0 };
    const slot2 = rows.find(r => r.slot_number === 2) || { status: 'available', reserved: 0, vehicle_detected: 0 };

    const totalSlots = 2;
    const availableSlots = rows.filter(s => s.status === 'available').length;
    const reservedSlots = rows.filter(s => s.status === 'reserved').length;
    const occupiedSlots = rows.filter(s => s.status === 'occupied').length;

    const secondsAgo = lastEspCommunication ? Math.round((Date.now() - lastEspCommunication) / 1000) : null;

    return res.json({
      totalSlots,
      availableSlots,
      reservedSlots,
      occupiedSlots,
      espOnline: isEspOnline(),
      espLastSeenSecondsAgo: secondsAgo,
      lastUpdated: getISTDateTime(),
      slots: {
        slot1: {
          status: slot1.status,
          reserved: Boolean(slot1.reserved),
          vehicleDetected: Boolean(slot1.vehicle_detected),
          led: slot1.status === 'available' ? 'OFF' : 'ON'
        },
        slot2: {
          status: slot2.status,
          reserved: Boolean(slot2.reserved),
          vehicleDetected: Boolean(slot2.vehicle_detected),
          led: slot2.status === 'available' ? 'OFF' : 'ON'
        }
      }
    });
  });
});

/**
 * POST /api/parking/reserve
 * Website user reserves an available parking slot.
 * Payload: { "slot": 1 }
 */
app.post('/api/parking/reserve', optionalAuth, (req, res) => {
  const slotNum = parseInt(req.body.slot, 10);
  if (!slotNum || (slotNum !== 1 && slotNum !== 2)) {
    return res.status(400).json({ success: false, message: 'Valid slot number (1 or 2) is required' });
  }

  db.get('SELECT * FROM slots WHERE slot_number = ?', [slotNum], (err, slot) => {
    if (err || !slot) {
      return res.status(404).json({ success: false, message: 'Parking slot not found' });
    }

    // Validation 1: Slot Occupied
    if (slot.vehicle_detected === 1) {
      return res.status(400).json({ success: false, message: 'Slot Occupied' });
    }

    // Validation 2: Slot Already Reserved
    if (slot.reserved === 1) {
      return res.status(400).json({ success: false, message: 'Slot Already Reserved' });
    }

    // Slot is Available -> Process Reservation
    const istTime = getISTDateTime();
    const userId = req.user ? req.user.id : (req.body.userId || 1);
    const userName = req.user ? req.user.name : (req.body.userName || 'Website User');
    const userEmail = req.user ? req.user.email : (req.body.userEmail || 'user@parking.com');

    db.serialize(() => {
      // 1. Update slot status to RESERVED
      db.run(
        'UPDATE slots SET reserved = 1, status = ?, updated_at = ? WHERE slot_number = ?',
        ['reserved', istTime, slotNum]
      );

      // 2. Insert into reservations history
      db.run(
        `INSERT INTO reservations (slot_number, user_id, user_name, user_email, status, reserved_at)
         VALUES (?, ?, ?, ?, 'active', ?)`,
        [slotNum, userId, userName, userEmail, istTime],
        function (insErr) {
          if (insErr) {
            console.error('Error inserting reservation:', insErr);
          }
        }
      );
    });

    return res.json({
      success: true,
      message: 'Reservation Successful',
      slot: slotNum,
      status: 'reserved',
      reservedAt: istTime
    });
  });
});

/**
 * POST /api/parking/cancel
 * Cancels a reservation for a parking slot.
 * Payload: { "slot": 1 }
 */
app.post('/api/parking/cancel', optionalAuth, (req, res) => {
  const slotNum = parseInt(req.body.slot, 10);
  if (!slotNum || (slotNum !== 1 && slotNum !== 2)) {
    return res.status(400).json({ success: false, message: 'Valid slot number (1 or 2) is required' });
  }

  db.get('SELECT * FROM slots WHERE slot_number = ?', [slotNum], (err, slot) => {
    if (err || !slot) {
      return res.status(404).json({ success: false, message: 'Parking slot not found' });
    }

    const istTime = getISTDateTime();
    // Recalculate status: if vehicle is present, it becomes occupied; otherwise available
    const newStatus = slot.vehicle_detected === 1 ? 'occupied' : 'available';

    db.serialize(() => {
      // 1. Update slot in database
      db.run(
        'UPDATE slots SET reserved = 0, status = ?, updated_at = ? WHERE slot_number = ?',
        [newStatus, istTime, slotNum]
      );

      // 2. Mark active reservations for this slot as cancelled
      db.run(
        `UPDATE reservations 
         SET status = 'cancelled', cancelled_at = ? 
         WHERE slot_number = ? AND status = 'active'`,
        [istTime, slotNum]
      );
    });

    return res.json({
      success: true,
      message: 'Reservation Cancelled',
      slot: slotNum,
      status: newStatus,
      cancelledAt: istTime
    });
  });
});

/**
 * GET /api/parking/slots
 * Used by Tab 2: Parking Slot Management
 * Columns: Slot Number, Current Status, Reservation Status, Vehicle Detection, LED Status, Last Updated
 */
app.get('/api/parking/slots', (req, res) => {
  db.all('SELECT * FROM slots ORDER BY slot_number ASC', (err, rows) => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Database error reading slots' });
    }

    const formattedSlots = rows.map(r => ({
      id: r.id,
      slotNumber: `S${r.slot_number}`,
      slotNum: r.slot_number,
      status: r.status.toUpperCase(),
      rawStatus: r.status,
      reserved: r.reserved === 1 ? 'Yes' : 'No',
      isReserved: r.reserved === 1,
      vehicleDetected: r.vehicle_detected === 1 ? 'Yes' : 'No',
      isVehicleDetected: r.vehicle_detected === 1,
      ledStatus: getLedStatus(r.status),
      updatedAt: r.updated_at || 'Just now'
    }));

    return res.json({ success: true, slots: formattedSlots });
  });
});

/**
 * GET /api/parking/reservations
 * Used by Tab 3: Reservation Management
 * Columns: # | Slot | User | Reservation Status | Date | Time | Action
 */
app.get('/api/parking/reservations', (req, res) => {
  db.all('SELECT * FROM reservations ORDER BY id DESC LIMIT 50', (err, rows) => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Database error reading reservations' });
    }

    const formattedReservations = rows.map(r => {
      // Split or parse timestamp for Date and Time display in IST
      let dateDisplay = 'N/A';
      let timeDisplay = 'N/A';
      if (r.reserved_at) {
        const parts = r.reserved_at.split(', ');
        if (parts.length === 2) {
          dateDisplay = parts[0];
          timeDisplay = parts[1];
        } else {
          dateDisplay = r.reserved_at;
        }
      }

      return {
        id: r.id,
        slotNumber: `Slot ${r.slot_number}`,
        slotNum: r.slot_number,
        user: r.user_name || r.user_email || 'Website User',
        userEmail: r.user_email || '',
        status: r.status.toUpperCase(),
        rawStatus: r.status,
        date: dateDisplay,
        time: timeDisplay,
        reservedAt: r.reserved_at,
        cancelledAt: r.cancelled_at
      };
    });

    return res.json({ success: true, reservations: formattedReservations });
  });
});

/**
 * GET /api/esp/heartbeat
 * Quick ping endpoint for ESP8266 or health check monitors
 */
app.get('/api/esp/heartbeat', (req, res) => {
  recordEspActivity();
  return res.json({
    status: 'online',
    timestamp: getISTDateTime(),
    espOnline: isEspOnline()
  });
});

// Root redirects to dashboard if logged in, or index.html (login)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Direct dashboard route
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// Catch-all 404 handler
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'API route not found' });
});

// -------------------------------------------------------------
// Start Server
// -------------------------------------------------------------
app.listen(PORT, '0.0.0.0', () => {
  console.log(`===============================================`);
  console.log(`🚗 Smart Parking System Server Running!`);
  console.log(`📡 Port: ${PORT}`);
  console.log(`🌐 Local URL: http://localhost:${PORT}`);
  console.log(`🕒 Timezone: Asia/Kolkata (IST) [${getISTDateTime()}]`);
  console.log(`🚀 Ready for Render Deployment & ESP8266 REST APIs`);
  console.log(`===============================================`);
});
