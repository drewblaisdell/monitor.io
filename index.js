var express = require('express');
var app = express();
var http = require('http').Server(app);
var io = require('socket.io')(http);
var monitor = require('./socket.io-monitor');

// monitor(io, {
//   testLatency: true
// });

// app.get('/', function(req, res) {
//   res.sendFile(__dirname + '/index.html');
// });

app.use(express.static(__dirname));

io.on('connection', function(socket) {
  socket.monitor.name = 'Henry';
  setInterval(function() {
    socket.monitor('rando', Math.floor(Math.random() * 1000));
  }, 1000);

  setTimeout(function() {
    socket.monitor('hairpin', 'a');
    // socket.monitor.hairpin = { a: "B" };
    // socket.monitor.algebra = 'an apple a day keeps the doctor away';
  }, 3000);
});

io.use(monitor({ remote: true, port: 8000 }));

http.listen(3000, function() {
  console.log("APP STARTED");
});