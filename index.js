var express = require('express');
var app = express();
var http = require('http').Server(app);
var io = require('socket.io')(http);
var monitor = require('./socket.io-monitor');

monitor(io, {
  testLatency: true
});

// app.get('/', function(req, res) {
//   res.sendFile(__dirname + '/index.html');
// });

app.use(express.static(__dirname));

io.on('connection', function(socket) {
  // console.log(socket);
});

http.listen(3000, function() {
  console.log("APP STARTED");
});