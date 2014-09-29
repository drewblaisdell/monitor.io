var ansi = require('ansi');

var Monitor = function(io) {
  if (!(this instanceof Monitor)) {
    return new Monitor(io);
  }

  this.ansi = ansi;
  this.cursor = ansi(process.stdout);
  this.sockets = {};

  io.use(this.middleware.bind(this));

  this.clearPush();

  setInterval(this.tickAndRender.bind(this), 1000);
};

Monitor.prototype.clear = function() {
  var windowHeight = process.stdout.getWindowSize()[1];

  for (var i = 1; i <= windowHeight; i++) {
    this.cursor
      .goto(1, i)
      .eraseLine()
      .write('');
  }
};

Monitor.prototype.clearPush = function() {
  this.cursor
    .write(Array.apply(null, Array(process.stdout.getWindowSize()[1])).map(function() {
      return '\n';
    }).join(''))
    .eraseData()
    .goto(1, 1);
};

Monitor.prototype.middleware = function(socket, next) {
  var self = this;

  this.sockets[socket.id] = {
    socket: socket,
    latency: undefined
  };
  socket.on('_echo', this.receiveEcho.bind(this, socket));

  setInterval(function() {
    self.echo(socket);
  }, 2000);

  next();
};

Monitor.prototype.echo = function(socket) {
  socket.emit('_echo', Date.now());
};

Monitor.prototype.receiveEcho = function(socket, message) {
  var latency = Date.now() - message;
  this.sockets[socket.id].latency = latency;
};

Monitor.prototype.removeDisconnectedSockets = function() {
  var socketIDs = Object.keys(this.sockets),
    current;

  for (var i = 0; i < socketIDs.length; i++) {
    current = this.sockets[socketIDs[i]];

    if (current.socket.disconnected) {
      delete this.sockets[socketIDs[i]];
    }
  }
};

Monitor.prototype.render = function() {
  var socketIDs = Object.keys(this.sockets);

  this.clear();
  this.resetCursor();

  if (socketIDs.length === 0) {
    console.log('No sockets connected.');
  } else {
    for (var i = 0; i < socketIDs.length; i++) {
      this.renderSocket(socketIDs[i]);
    }
  }
};

Monitor.prototype.renderSocket = function(socketID) {
  current = this.sockets[socketID];

  if (current.socket.disconnected) {
    console.log(current.socket.conn.remoteAddress);
  } else {
    if (current.latency) {
      console.log(current.socket.conn.remoteAddress + ' latency: ' + current.latency + 'ms');
    } else {
      console.log(current.socket.conn.remoteAddress);
    }
  }
};

Monitor.prototype.resetCursor = function() {
  this.cursor
    .horizontalAbsolute(0)
    // .eraseLine()
    .goto(1, 1)
    .eraseLine()
    .write('');
};

Monitor.prototype.tick = function() {
  this.removeDisconnectedSockets();
};

Monitor.prototype.tickAndRender = function() {
  this.tick();
  this.render();
};

module.exports = Monitor;