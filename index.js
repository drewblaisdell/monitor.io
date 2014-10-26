var express = require('express');
var app = express();
var http = require('http').Server(app);
var io = require('socket.io')(http);
var monitor = require('./socket.io-monitor');

app.use(express.static(__dirname));

var names = ['Alice', 'Bob', 'Eve', 'Dave', 'Craig', 'Peggy', 'Sybil', 'Walter', 'Wendy', 'Erin'];
var messages = [
  'I read the news today, oh boy.',
  'About a lucky man who made the grade',
  'And though the news was rather sad, well, I just had to laugh. I saw the photograph.',
  'A crowd of people stood and stared... they\'d seen his face before.',
  'Woke up, fell out of bed, dragged a comb across my head, found my way downstairs and drank a cup.',
  'Four thousand holes in Blackburn, Lancashire',
  'Now they know how many holes it takes to fill the Albert Hall.',
  'I am he as you are he as you are me and we are all together.',
  'Currently sitting on a cornflake, waiting for the van to come.',
  'Sitting in an English garden, waiting for the sun.'
];


io.on('connection', function(socket) {
  socket.conn.remoteAddress = randomIP();

  socket.monitor('name', shuffle(names)[0]);
  socket.monitor('lastMessage', shuffle(messages)[0]);
});

io.use(monitor({ port: 8000 }));

http.listen(3000, function() {
  console.log("APP STARTED");
});

function randomIP() {
  var a = Math.floor(Math.random() * 255);
  var b = Math.floor(Math.random() * 255);
  var c = Math.floor(Math.random() * 255);
  var d = Math.floor(Math.random() * 255);

  return a +'.'+ b +'.'+ c +'.'+ d;
}

function shuffle(array) {
  var currentIndex = array.length, temporaryValue, randomIndex ;

  // While there remain elements to shuffle...
  while (0 !== currentIndex) {

    // Pick a remaining element...
    randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex -= 1;

    // And swap it with the current element.
    temporaryValue = array[currentIndex];
    array[currentIndex] = array[randomIndex];
    array[randomIndex] = temporaryValue;
  }

  return array;
}