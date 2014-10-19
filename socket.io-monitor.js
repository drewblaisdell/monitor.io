// Module dependencies.
var ansi = require('ansi');
var keypress = require('keypress');

keypress(process.stdin);

// Module exports.
module.exports = Monitor;

// Monitor constructor.
// Accepts an instance of Socket.IO
function Monitor(options) {
  if (!(this instanceof Monitor)) {
    return new Monitor(options);
  }

  options = options || {};
  this.testLatency = options.testLatency || false;
  this.timeBetweenEchoes = options.timeBetweenEchoes || 500;

  this.scrollX = 0;
  this.scrollY = 0;
  this.selected = 0;

  this.ansi = ansi;
  this.cursor = ansi(process.stdout);
  this.sockets = {};

  // Log new lines to make room for the application.
  this._addNewLines();

  // Hide the cursor.
  this.cursor.hide();

  // Show the cursor on exit.
  var self = this;
  var exitHandler = function(err) {
    if (err) {
      console.log(err.stack);
    }

    self.cursor.show();
    process.exit();
  };

  process.on('exit', exitHandler);
  process.on('SIGINT', exitHandler);
  process.on('uncaughtException', exitHandler);

  // Capture and handle keypresses.
  process.stdin.on('keypress', this._handleKeypress.bind(this));
  process.stdin.setRawMode(true);
  process.stdin.resume();

  // Run the application.
  setInterval(this._tick.bind(this), 1000);

  return this._middleware.bind(this);
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

// Disconnect the socket with the given ID.
Monitor.prototype._disconnectSocket = function(id) {
  this.sockets[id].disconnect();
};

Monitor.prototype._getVisibleSockets = function() {
  var socketIDs = Object.keys(this.sockets),
    windowHeight = process.stdout.getWindowSize()[1];
  
  return (socketIDs.length > windowHeight - 3) ? windowHeight - 3 : socketIDs.length;
};

// Emits a timestamp to the given socket in order to measure latency.
Monitor.prototype._echo = function(socket) {
  socket.emit('_echo', Date.now());
};

// Handle a stdin keypress.
Monitor.prototype._handleKeypress = function(ch, key) {
  switch (ch) {
    case 'h':
      this._scrollX(-1);
      this._render();
      break;
    case 'l':
      this._scrollX(1);
      this._render();
      break;
    case 'k':
      // this._scroll(-1);
      this._moveCursor(-1);
      this._render();
      break;
    case 'j':
      // this._scroll(1);
      this._moveCursor(1);
      this._render();
      break;
    case 'x':
      this._disconnectSocket(Object.keys(this.sockets)[this.selected]);
      break;
  }

  if (key && key.ctrl && key.name === 'c') {
    process.exit();
  }
};

// Middleware function for Socket.IO. It is passed each socket when
// it connects and saves a reference.
Monitor.prototype._middleware = function(socket, next) {
  socket.monitor = {};
  this.sockets[socket.id] = socket;

  next();
};

Monitor.prototype._moveCursor = function(y) {
  var socketIDs = Object.keys(this.sockets),
    socketCount = socketIDs.length;

  if (this.selected + y < socketCount && this.selected + y > -1) {
    this.selected += y;
    
    if (this.selected > this._getVisibleSockets() - 1 || this.selected < this.scrollY) {
      this._scrollY(y);
    }
  }
};

// Adds whitespace to the end of a string to give it the given width.
Monitor.prototype._pad = function(str, width) {
  while (str.length < width) {
    str += ' ';
  }

  return str;
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

// Removes sockets that are flagged as disconnected from internal list of sockets.
// If the selected socket number is higher than the list of sockets, it is reset to
// the last socket.
Monitor.prototype._removeDisconnectedSockets = function() {
  var socketIDs = Object.keys(this.sockets),
    current;

  for (var i = 0; i < socketIDs.length; i++) {
    current = this.sockets[socketIDs[i]];

    if (current.disconnected) {
      delete this.sockets[socketIDs[i]];
    }
  }

  if (this.selected > socketIDs.length - 1) {
    this.selected = socketIDs.length - 1;
  }
};

// Renders the current state of the application in the terminal.
Monitor.prototype._render = function() {
  var socketIDs = Object.keys(this.sockets),
    windowHeight = process.stdout.getWindowSize()[1],
    visibleSockets = (socketIDs.length > windowHeight - 3) ? windowHeight - 3 : socketIDs.length,
    startingSocket = 0;

  if (visibleSockets < socketIDs.length) {
    startingSocket = this.scrollY;

    if (this.scrollY + visibleSockets >= socketIDs.length) {
      this.scrollY = socketIDs.length - visibleSockets;
    }
  }

  this._clear(1);
  this._resetCursor();

  this._renderTitle();

  if (socketIDs.length === 0) {
    this.cursor.write('No sockets connected.');
  } else {
    for (var i = startingSocket; i < startingSocket + visibleSockets; i++) {
      if (socketIDs[i] === undefined) {
        break;
      }

      if (i === this.selected) {
        this._renderSocket(socketIDs[i], true);
      } else {
        this._renderSocket(socketIDs[i], false);
      }
    }
  }

  this.cursor.hide();
};

// Renders a single socket in the terminal.
Monitor.prototype._renderSocket = function(socketID, selected) {
  var socket = this.sockets[socketID],
    windowWidth = process.stdout.getWindowSize()[0];

  if (socket.disconnected) {
    this.cursor.bold().write(socket.conn.remoteAddress);
    this.cursor.reset().write(' disconnected...');
  } else {
    if (selected) {
      this.cursor.bold().write(this._pad('> '+ socket.conn.remoteAddress, 15)).reset();
    } else {
      this.cursor.bold().write(this._pad(socket.conn.remoteAddress, 15)).reset();
    }

    if (socket.latency) {
      this.cursor.write(' latency: ');
      if (socket.latency < 100) {
        this.cursor.green();
      } else if (socket.latency < 500) {
        this.cursor.hex('#FFAA00');
      } else {
        this.cursor.red();
      }

      this.cursor.write(this._pad(socket.latency + 'ms', 6));
      this.cursor.reset();
    }

    var attach = Object.keys(socket.monitor),
      buffer = '';

    for (var i = this.scrollX; i < attach.length; i++) {
      buffer += ' '+ attach[i] + ': ';
      if (typeof socket.monitor[attach[i]] === 'number') {
        buffer += socket.monitor[attach[i]].toString();
      } else {
        buffer += '"'+ socket.monitor[attach[i]].toString() +'"';
      }

      if (i < attach.length - 1) {
        buffer += ',';
      }
    }

    if (buffer.length > windowWidth - 15) {
      buffer = buffer.substring(0, windowWidth - 18) + '...';
    }

    this.cursor.write(buffer);
  }
  this.cursor.write('\n');
};

// Renders the title of the application.
Monitor.prototype._renderTitle = function() {
  var title = 'Monitor.IO',
    exitText = '(Ctrl + C to exit)',
    windowWidth = process.stdout.getWindowSize()[0],
    whiteSpace = Array(windowWidth - title.length - exitText.length).join(' ');

  this.cursor.bold().hex('#6349B6').write(title);

  this.cursor.reset().write(whiteSpace);
  this.cursor.hex('#6349B6').write(exitText);
  this.cursor.reset().write('\n\n');
};

// Moves the cursor to the top left of the window.
Monitor.prototype._resetCursor = function() {
  this.cursor.horizontalAbsolute(0).goto(1, 1).eraseLine().write('');
};

Monitor.prototype._scrollX = function(x) {
  var socketIDs = Object.keys(this.sockets),
    socket,
    monitors,
    maxX = 0;

  for (var i = 0; i < socketIDs.length; i++) {
    socket = this.sockets[socketIDs[i]];

    monitors = Object.keys(socket.monitor).length;

    maxX = (monitors > maxX) ? monitors : maxX;
  }

  if (this.scrollX + x < maxX && this.scrollX + x >= 0) {
    this.scrollX += x;
  }
};

// Change the scroll position by the given number. Prevent scrolling past the
// end of the list of sockets.
Monitor.prototype._scrollY = function(y) {
  var visibleSockets = this._getVisibleSockets();

  if (this.scrollY + y > -1 && this.scrollY + y < visibleSockets) {
    this.scrollY += y;
  }

  if (this.scrollY < 0) {
    process.exit();
  }
};

// Updates internal data, renders the application.
Monitor.prototype._tick = function() {
  this._removeDisconnectedSockets();
  this._render();
};
