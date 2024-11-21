const express = require('express');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');
const mysql = require('mysql2');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const port = 6969;
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Encryption settings
const encryptionKey = Buffer.from(process.env.ENCRYPTION_KEY || crypto.randomBytes(32)); // Ensure Buffer format
const ivLength = 16; // AES block size

// MySQL connection pooling with .env configuration
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_DATABASE || 'chatapp',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Serve the client files
app.use(express.static(path.join(__dirname, '../client')));
app.use(express.json());

// AES encryption and decryption functions
function encrypt(text) {
  const iv = crypto.randomBytes(ivLength);
  const cipher = crypto.createCipheriv('aes-256-cbc', encryptionKey, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return `${iv.toString('hex')}:${encrypted}`;
}

function decrypt(text) {
  const [ivHex, encryptedText] = text.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', encryptionKey, iv);
  let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// Sign-up route
app.post('/signup', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).send('Username and password are required');
  }

  try {
    console.log('Checking if username exists...');
    const [rows] = await pool.promise().query('SELECT * FROM users WHERE username = ?', [username]);
    
    if (rows.length > 0) {
      console.log('Username already exists');
      return res.status(409).send('Username already exists');
    }

    console.log('Hashing password...');
    const hashedPassword = await bcrypt.hash(password, 10);

    console.log('Inserting new user into database...');
    const result = await pool.promise().query('INSERT INTO users (username, password) VALUES (?, ?)', [username, hashedPassword]);

    console.log('User created successfully:', result);
    res.status(201).send('User created successfully');
  } catch (err) {
    console.error('Error during sign-up:', err);
    res.status(500).send('Internal server error');
  }
});


// Login route
app.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).send('Username and password are required');
  }

  try {
    const [rows] = await pool.promise().query('SELECT * FROM users WHERE username = ?', [username]);

    if (rows.length === 0) {
      return res.status(401).send('Invalid username or password');
    }

    const user = rows[0];
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).send('Invalid username or password');
    }

    res.status(200).send('Login successful');
  } catch (err) {
    console.error('Error during login:', err);
    res.status(500).send('Internal server error');
  }
});

// WebSocket logic
wss.on('connection', (ws) => {
  console.log('New client connected');

  // Fetch and send previous messages
  pool.promise().query('SELECT * FROM chat_messages WHERE deleted = 0 ORDER BY created_at ASC')
    .then(([results]) => {
      results.forEach((message) => {
        const decryptedContent = decrypt(message.content);
        ws.send(JSON.stringify({ 
          id: message.id, 
          username: message.username, 
          content: decryptedContent, 
          deleted: message.deleted 
        }));
      });
    })
    .catch((err) => {
      console.error('Error fetching messages:', err);
    });

  // Handle incoming messages
  ws.on('message', (msg) => {
    const parsedMessage = JSON.parse(msg);
    const { username, content } = parsedMessage;

    if (!username || !content) {
      return console.error('Invalid message format');
    }

    const encryptedContent = encrypt(content);

    pool.promise().query('INSERT INTO chat_messages (username, content) VALUES (?, ?)', [username, encryptedContent])
      .then(([result]) => {
        const messageId = result.insertId;

        // Broadcast to all clients
        wss.clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ id: messageId, username, content }));
          }
        });
      })
      .catch((err) => {
        console.error('Error storing message:', err);
      });
  });

  // Handle message deletion
  ws.on('delete-message', (msg) => {
    const { messageId } = JSON.parse(msg);

    if (!messageId) {
      return console.error('Invalid delete request');
    }

    pool.promise().query('UPDATE chat_messages SET deleted = 1 WHERE id = ?', [messageId])
      .then(() => {
        wss.clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ deleted: true, messageId }));
          }
        });
      })
      .catch((err) => {
        console.error('Error deleting message:', err);
      });
  });

  ws.on('close', () => {
    console.log('Client disconnected');
  });
});

// Start server
server.listen(port, () => {
  console.log(`Server is listening on port ${port}`);
});
