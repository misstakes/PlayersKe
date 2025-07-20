// server.js

const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const axios = require('axios');
const path = require('path');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: "*", // Adjust this in production
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'client')));

const PORT = process.env.PORT || 3000;

// 🔐 Live API keys from Pesapal dashboard
const consumerKey = 'UYVetzaJafhuzSOAppC/vJEa8zbxOhxZ';
const consumerSecret = 'd+Cbt6sIRT3RGKgGggyWRQkSJB0=';

// 🏦 Pesapal URLs
const tokenUrl = "https://pay.pesapal.com/v3/api/Auth/RequestToken";
const submitOrderUrl = "https://pay.pesapal.com/v3/api/Transactions/SubmitOrderRequest";

// Replace this with your actual notification ID from IPN registration
const ipn_id = 'YOUR_REGISTERED_IPN_ID'; // Register IPN in dashboard if not done yet

// 💳 Get access token from Pesapal (live)
async function getAccessToken() {
  const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');

  const response = await axios.get(tokenUrl, {
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json'
    }
  });

  return response.data.token;
}

// 💵 Route to initiate a payment
app.post('/api/pay', async (req, res) => {
  try {
    const { email, phone, amount, first_name, last_name } = req.body;
    const token = await getAccessToken();

    const merchant_reference = `order_${Date.now()}`;
    const callbackUrl = `https://${req.headers.host}/verify.html?ref=${merchant_reference}`;

    const data = {
      id: merchant_reference,
      currency: "KES",
      amount,
      description: "Checkers Match Entry",
      callback_url: callbackUrl,
      notification_id: ipn_id,
      branch: "PlayersKe",
      billing_address: {
        email_address: email,
        phone_number: phone,
        country_code: "KE",
        first_name,
        middle_name: "",
        last_name,
        line_1: "PlayersKe",
        line_2: "",
        city: "Nairobi",
        state: "",
        postal_code: ""
      }
    };

    const response = await axios.post(submitOrderUrl, data, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json'
      }
    });

    if (response.data.redirect_url) {
      res.json({ redirect_url: response.data.redirect_url });
    } else {
      res.status(400).json({ error: 'Payment initiation failed.', details: response.data });
    }
  } catch (error) {
    console.error('Error initiating payment:', error.message);
    res.status(500).json({ error: 'Server error', details: error.message });
  }
});

// ♟ Game matchmaking and Socket.IO logic
const games = {};
let waitingRandomPlayer = null;

io.on('connection', (socket) => {
  socket.on('joinGame', ({ room, isPrivateRoom }) => {
    if (isPrivateRoom && room) {
      socket.join(room);

      if (!games[room]) {
        games[room] = { players: {}, turn: 'white' };
        games[room].players[socket.id] = 'white';
        socket.emit('waitingForPlayer');
      } else {
        games[room].players[socket.id] = 'black';
        startGame(room);
      }

    } else {
      if (waitingRandomPlayer) {
        const newRoom = `room-${waitingRandomPlayer.id}-${socket.id}`;
        socket.join(newRoom);
        waitingRandomPlayer.join(newRoom);

        games[newRoom] = {
          players: {
            [waitingRandomPlayer.id]: 'white',
            [socket.id]: 'black'
          },
          turn: 'white'
        };

        startGame(newRoom);
        waitingRandomPlayer = null;
      } else {
        waitingRandomPlayer = socket;
        socket.emit('waitingForPlayer');
      }
    }
  });

  function startGame(room) {
    const players = games[room].players;
    for (const [id, color] of Object.entries(players)) {
      io.to(id).emit('startGame', { room, color });
    }
  }

  socket.on('move', (data) => {
    socket.to(data.room).emit('move', data);
  });

  socket.on('gameOver', ({ room, winner }) => {
    if (games[room]) {
      for (const id of Object.keys(games[room].players)) {
        io.to(id).emit('gameOver', { winner });
      }
      delete games[room];
    }
  });

  socket.on('timeout', ({ room, loser }) => {
    const winner = loser === 'white' ? 'black' : 'white';
    io.to(room).emit('gameOver', { winner });
    delete games[room];
  });

  socket.on('forfeit', ({ room, loser }) => {
    const winner = loser === 'white' ? 'black' : 'white';
    io.to(room).emit('gameOver', { winner });
    delete games[room];
  });

  socket.on('disconnect', () => {
    if (waitingRandomPlayer?.id === socket.id) {
      waitingRandomPlayer = null;
      return;
    }

    for (const [room, game] of Object.entries(games)) {
      if (socket.id in game.players) {
        const loserColor = game.players[socket.id];
        const winnerColor = loserColor === 'white' ? 'black' : 'white';
        io.to(room).emit('gameOver', { winner: winnerColor });
        delete games[room];
        break;
      }
    }
  });
});

// 🚀 Start the server
server.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
