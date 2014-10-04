// Module dependencies.
 
var ansi = require('ansi');

// Module exports.

module.exports = Monitor;

// Monitor constructor.
// Accepts an instance of Socket.IO
function Monitor(io, options) {
  if (!(this instanceof Monitor)) {
    return new Monitor(io, options);
  }

  options = options || {};
  this.testLatency = options.testLatency || false;
  this.timeBetweenEchoes = options.timeBetweenEchoes || 500;

  this.ansi = ansi;
  this.cursor = ansi(process.stdout);
  this.sockets = {};

  // Tell Socket.IO to use Monitor.IO.
  io.use(this._middleware.bind(this));

  // Log new lines to make room for the application.
  this._addNewLines();

  // Hide the cursor.
  this.cursor.hide();

  // Show the cursor on exit.
  var self = this;
  var exitHandler = function() {
    self.cursor.show();
    process.exit();
  };

  process.on('exit', exitHandler);
  process.on('SIGINT', exitHandler);

  // Run the application.
  setInterval(this._tick.bind(this), 1000);
};

// Log as many new lines as the height of the window.
Monitor.prototype._addNewLines = function() {
  this.cursor
    .write(Array.apply(null, Array(process.stdout.getWindowSize()[1])).map(function() {
      return '\n';
    }).join(''))
    .eraseData()
    .goto(1, 1);
};

// Clear the console, starting with the given line.
Monitor.prototype._clear = function(line) {
  var windowHeight = process.stdout.getWindowSize()[1];

  for (var i = line; i <= windowHeight; i++) {
    this.cursor.goto(1, i).eraseLine().write('');
  }
};

// Emits a timestamp to the given socket in order to measure latency.
Monitor.prototype._echo = function(socket) {
  socket.emit('_echo', Date.now());
};

// Middleware function for Socket.IO. It is passed each socket when
// it connects and saves a reference.
Monitor.prototype._middleware = function(socket, next) {
  var self = this;

  this.sockets[socket.id] = {
    socket: socket,
    latency: undefined
  };

  if (this.testLatency) {
    socket.on('_echo', this._receiveEcho.bind(this, socket));
    this._echo(socket);
  }

  next();
};

// Handles a return echo from a socket and issues a new echo.
Monitor.prototype._receiveEcho = function(socket, message) {
  var latency = Date.now() - message;
  this.sockets[socket.id].latency = latency;

  var self = this;
  setTimeout(function() {
    self._echo(socket);
  }, this.timeBetweenEchoes);
};

// Removes sockets that are flagged as disconnected from internal
// list of sockets. 
Monitor.prototype._removeDisconnectedSockets = function() {
  var socketIDs = Object.keys(this.sockets),
    current;

  for (var i = 0; i < socketIDs.length; i++) {
    current = this.sockets[socketIDs[i]];

    if (current.socket.disconnected) {
      delete this.sockets[socketIDs[i]];
    }
  }
};

// Renders the current state of the application in the terminal.
Monitor.prototype._render = function() {
  var socketIDs = Object.keys(this.sockets);

  this._clear(1);
  this._resetCursor();

  if (socketIDs.length === 0) {
    this.cursor.write('No sockets connected.');
  } else {
    for (var i = 0; i < socketIDs.length; i++) {
      this._renderSocket(socketIDs[i]);
    }
  }

  this.cursor.hide();
};

// Renders a single socket in the terminal.
Monitor.prototype._renderSocket = function(socketID) {
  current = this.sockets[socketID];

  if (current.socket.disconnected) {
    this.cursor.write(current.socket.conn.remoteAddress);
  } else {
    this.cursor.write(current.socket.conn.remoteAddress);

    if (current.latency) {
      this.cursor.write(' latency: ');
      if (current.latency < 100) {
        this.cursor.green();
      } else if (current.latency < 500) {
        this.cursor.hex('#FFAA00');
      } else {
        this.cursor.red();
      }

      this.cursor.write(current.latency + 'ms');
      this.cursor.reset();
    }
  }
  this.cursor.write('\n');
};

// Moves the cursor to the top left of the window.
Monitor.prototype._resetCursor = function() {
  this.cursor.horizontalAbsolute(0).goto(1, 1).eraseLine().write('');
};

// Updates internal data, renders the application.
Monitor.prototype._tick = function() {
  this._removeDisconnectedSockets();
  this._render();
};

