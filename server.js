const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// CORSを許可してSocket.ioサーバーを起動
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// public フォルダ内の static ファイル（index.html）を配信
app.use(express.static('public'));

// 合言葉（ルーム名）ごとの参加者リスト管理
const rooms = {};
// ルームごとの再戦希望プレイヤーIDの管理
const rematchRequests = {};

io.on('connection', (socket) => {
  let currentRoom = null;

  // 1. 合言葉でルームに入室
  socket.on('joinRoom', (roomPass) => {
    if (!rooms[roomPass]) {
      rooms[roomPass] = [];
    }

    const room = rooms[roomPass];

    // 満員（2人）の場合は拒否
    if (room.length >= 2) {
      socket.emit('roomFull');
      return;
    }

    // プレイヤーをルームに追加
    room.push(socket.id);
    socket.join(roomPass);
    currentRoom = roomPass;

    socket.emit('joined', roomPass);

    if (room.length === 1) {
      // 1人目：対戦相手待ち
      socket.emit('waiting');
    } else if (room.length === 2) {
      // 2人揃ったら対戦スタート通知
      io.to(roomPass).emit('gameStart');
    }
  });

  // 2. 盤面状態の同期（相手だけに送信）
  socket.on('boardUpdate', (board) => {
    if (currentRoom) {
      socket.to(currentRoom).emit('opponentBoard', board);
    }
  });

  // 3. お邪魔ブロック（火力）の送信
  socket.on('sendGarbage', (lines) => {
    if (currentRoom) {
      socket.to(currentRoom).emit('receiveGarbage', lines);
    }
  });

  // 4. ゲームオーバー通知
  socket.on('gameOver', () => {
    if (currentRoom) {
      socket.to(currentRoom).emit('opponentGameOver');
    }
  });

  // 【新規追加】5. 再戦（リマッチ）リクエスト処理
  socket.on('requestRematch', () => {
    if (!currentRoom) return;

    if (!rematchRequests[currentRoom]) {
      rematchRequests[currentRoom] = new Set();
    }

    // 再戦を押したプレイヤーを記録
    rematchRequests[currentRoom].add(socket.id);

    // 相手に「再戦希望が届いた」ことを通知
    socket.to(currentRoom).emit('opponentRematch');

    // 2人とも再戦を押したらゲーム再スタート
    if (rematchRequests[currentRoom].size >= 2) {
      rematchRequests[currentRoom].clear(); // リセット
      io.to(currentRoom).emit('gameStart');
    }
  });

  // 6. 切断時の処理
  socket.on('disconnect', () => {
    if (currentRoom && rooms[currentRoom]) {
      // ルームから離脱者を除外
      rooms[currentRoom] = rooms[currentRoom].filter(id => id !== socket.id);
      
      // 再戦リストからも除外
      if (rematchRequests[currentRoom]) {
        rematchRequests[currentRoom].delete(socket.id);
      }

      // 残された相手に通知
      socket.to(currentRoom).emit('opponentLeft');

      // ルームが空なら削除
      if (rooms[currentRoom].length === 0) {
        delete rooms[currentRoom];
        delete rematchRequests[currentRoom];
      }
    }
  });
});

// Renderの環境変数PORTまたは3000でサーバー起動
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
