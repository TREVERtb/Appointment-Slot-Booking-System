const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3008;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

let db;

(async () => {
    db = await open({
        filename: './database.sqlite',
        driver: sqlite3.Database
    });

    await db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            password TEXT
        )
    `);

    await db.exec(`
        CREATE TABLE IF NOT EXISTS slots (
            slot_time TEXT PRIMARY KEY,
            is_booked BOOLEAN DEFAULT 0,
            user_id INTEGER,
            FOREIGN KEY(user_id) REFERENCES users(id)
        )
    `);
    console.log('Database initialized');
})();

// Helper to generate slots for a specific date
// For simplicity, generate slots from 09:00 to 17:00 every hour
function generateDefaultSlots(dateStr) {
    const slots = [];
    const startHour = 9;
    const endHour = 17;

    for (let hour = startHour; hour <= endHour; hour++) {
        const time = `${hour.toString().padStart(2, '0')}:00`;
        slots.push(`${dateStr}T${time}`);
    }
    return slots;
}

// Auth Endpoints
app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    try {
        const result = await db.run(
            'INSERT INTO users (username, password) VALUES (?, ?)',
            [username, password]
        );
        res.json({ success: true, userId: result.lastID });
    } catch (err) {
        res.status(400).json({ error: 'Username already exists' });
    }
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const user = await db.get(
            'SELECT id, username FROM users WHERE username = ? AND password = ?',
            [username, password]
        );
        if (user) {
            res.json({ success: true, user });
        } else {
            res.status(401).json({ error: 'Invalid credentials' });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET user bookings
app.get('/api/my-bookings', async (req, res) => {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: 'User ID required' });

    try {
        const bookings = await db.all(
            'SELECT slot_time FROM slots WHERE user_id = ?',
            [userId]
        );
        res.json(bookings);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET available slots for a date
app.get('/api/slots', async (req, res) => {
    const { date } = req.query; // Expecting YYYY-MM-DD
    if (!date) return res.status(400).json({ error: 'Date is required' });

    try {
        const defaultSlots = generateDefaultSlots(date);

        // Ensure slots exist in DB for this date
        for (const slotTime of defaultSlots) {
            await db.run(
                'INSERT OR IGNORE INTO slots (slot_time, is_booked) VALUES (?, 0)',
                [slotTime]
            );
        }

        const slots = await db.all(
            'SELECT slot_time, is_booked FROM slots WHERE slot_time LIKE ?',
            [`${date}%`]
        );

        res.json(slots.map(s => ({
            time: s.slot_time,
            isBooked: !!s.is_booked
        })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST book a slot
app.post('/api/book', async (req, res) => {
    const { slotTime, userId } = req.body;
    if (!slotTime || !userId) return res.status(400).json({ error: 'Slot time and User ID are required' });

    try {
        const slot = await db.get('SELECT is_booked FROM slots WHERE slot_time = ?', [slotTime]);

        if (!slot) {
            return res.status(404).json({ error: 'Slot not found' });
        }

        if (slot.is_booked) {
            return res.status(400).json({ error: 'Slot already booked' });
        }

        await db.run(
            'UPDATE slots SET is_booked = 1, user_id = ? WHERE slot_time = ?',
            [userId, slotTime]
        );
        res.json({ success: true, message: 'Slot booked successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
