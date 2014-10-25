var express = require('express');
var app = express();
var http = require('http').Server(app);
var io = require('socket.io')(http);
var monitor = require('./socket.io-monitor');

app.use(express.static(__dirname));

io.on('connection', function(socket) {
  socket.monitor.name = 'Henry';
  setInterval(function() {
    socket.monitor('rando', Math.floor(Math.random() * 1000));
  }, 1000);

  setTimeout(function() {
    socket.monitor('hairpin', 'a');
  }, 3000);
});

io.use(monitor({ port: 8000 }));

http.listen(3000, function() {
  console.log("APP STARTED");
});