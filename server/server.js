const express = require('express');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');
const mysql = require('mysql2'); // Use mysql2 for promise-based queries
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
require('dotenv').config(); // Load environment variables from .env file

const port = 6969;
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Encryption settings (ensure the key is 32 bytes for AES-256)
const encryptionKey = process.env.ENCRYPTION_KEY || crypto.randomBytes(32); // Use environment variable or a random key
const ivLength = 16; // AES block size (16 bytes)

// MySQL connection pooling for better performance
const pool = mysql.createPool({
  host: 'localhost',
  user: 'root',
  password: '',
  database: 'chatapp',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Serve the HTML and JavaScript files
app.use(express.static(path.join(__dirname, '../client')));  // Path to client folder
app.use(express.json());

// Sign-up route
app.post('/signup', async (req, res) => {
  const { username, password } = req.body;

  try {
    // Check if the username already exists
    const [rows] = await pool.promise().query('SELECT * FROM users WHERE username = ?', [username]);
    if (rows.length > 0) {
      return res.status(409).send('Username already exists');
    }

    // Hash the password before storing
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert the new user into the database
    await pool.promise().query('INSERT INTO users (username, password) VALUES (?, ?)', [username, hashedPassword]);

    res.status(201).send('User created successfully');
  } catch (err) {
    console.error('Error during sign up:', err);
    res.status(500).send('Internal server error');
  }
});

// Login route
app.post('/login', async (req, res) => {
  const { username, password } = req.body;

  try {
    const [rows] = await pool.promise().query('SELECT * FROM users WHERE username = ?', [username]);

    if (rows.length === 0) {
      return res.status(401).send('Invalid username or password');
    }

    const user = rows[0];

    // Compare hashed password with bcrypt
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

// AES encryption and decryption functions
function encrypt(text) {
  const iv = crypto.randomBytes(ivLength);
  const cipher = crypto.createCipheriv('aes-256-cbc', encryptionKey, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted; // Combine IV and encrypted text
}

function decrypt(text) {
  const parts = text.split(':');
  const iv = Buffer.from(parts[0], 'hex');
  const encryptedText = parts[1];
  const decipher = crypto.createDecipheriv('aes-256-cbc', encryptionKey, iv);
  let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

wss.on('connection', (ws) => {
  console.log('New client connected');

  // Fetch and send previous messages to the new client
  pool.promise().query('SELECT * FROM chat_messages ORDER BY created_at ASC')
    .then(([results]) => {
      // Send the messages after decrypting
      results.forEach((message) => {
        const decryptedContent = decrypt(message.content); // Decrypt the message content
        ws.send(JSON.stringify({ username: message.username, content: decryptedContent }));
      });
    })
    .catch((err) => {
      console.error('Error fetching messages:', err);
    });

  // Handle incoming messages
  ws.on('message', (message) => {
    console.log(`Received message: ${message}`);

    // Parse the message to extract username and content
    const parsedMessage = JSON.parse(message);

    // Encrypt the message content before storing it in the database
    const encryptedContent = encrypt(parsedMessage.content);

    // Store the encrypted message in the database
    pool.promise().query('INSERT INTO chat_messages (username, content) VALUES (?, ?)', [parsedMessage.username, encryptedContent])
      .then(() => {
        // Broadcast the message to all connected clients after decrypting it
        wss.clients.forEach((client) => {
          if (client !== ws && client.readyState === WebSocket.OPEN) {
            const decryptedMessage = decrypt(encryptedContent); // Decrypt before sending
            client.send(JSON.stringify({ username: parsedMessage.username, content: decryptedMessage }));
          }
        });
      })
      .catch((err) => {
        console.error('Error storing message:', err);
      });
  });

  ws.on('close', () => {
    console.log('Client has disconnected');
  });
});

server.listen(port, () => {
  console.log(`Server is listening on ${port}`);
});
