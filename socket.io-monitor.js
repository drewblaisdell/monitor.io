// Module dependencies.
var ansi = require('ansi');
var keypress = require('keypress');

keypress(process.stdin);

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

  this.scrollY = 0;

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
  if (ch === 'k') {
    this._scroll(-1);
    this._render();
  } else if (ch === 'j') {
    this._scroll(1);
    this._render();
  }

  if (key && key.ctrl && key.name === 'c') {
    process.exit();
  }
};

// Middleware function for Socket.IO. It is passed each socket when
// it connects and saves a reference.
Monitor.prototype._middleware = function(socket, next) {
  var self = this;

  this.sockets[socket.id] = {
    socket: socket,
    latency: undefined,
    attachments: {}
  };

// TO REMOVE: dummy sockets
  for (var i = 0; i < 10; i++) {
    this.sockets[Math.random().toString()] = {
      socket: socket,
      latency: Math.floor(Math.random() * 600),
      attachments: { name: 'Alice' }
    };
  }

  if (this.testLatency) {
    socket.on('_echo', this._receiveEcho.bind(this, socket));
    this._echo(socket);
  }

  socket.on('_attachment', this._receiveAttachment.bind(this, socket));

  next();
};

// Adds whitespace to the end of a string to give it the given width.
Monitor.prototype._pad = function(str, width) {
  while (str.length < width) {
    str += ' ';
  }

  return str;
};

// Attaches data from a client socket to the socket.
Monitor.prototype._receiveAttachment = function(socket, message) {
  var name = message.name,
    value = message.value;

  this.sockets[socket.id].attachments[name] = value;
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

      this._renderSocket(socketIDs[i]);
    }
  }

  this.cursor.hide();
};

// Renders a single socket in the terminal.
Monitor.prototype._renderSocket = function(socketID) {
  current = this.sockets[socketID];

  if (current.socket.disconnected) {
    this.cursor.bold().write(current.socket.conn.remoteAddress);
    this.cursor.reset().write(' disconnected...');
  } else {
    this.cursor.bold().write(this._pad(current.socket.conn.remoteAddress, 15)).reset();

    if (current.latency) {
      this.cursor.write(' latency: ');
      if (current.latency < 100) {
        this.cursor.green();
      } else if (current.latency < 500) {
        this.cursor.hex('#FFAA00');
      } else {
        this.cursor.red();
      }

      this.cursor.write(this._pad(current.latency + 'ms', 6));
      this.cursor.reset();
    }

    var attachmentNames = Object.keys(current.attachments);

    for (var i = 0; i < attachmentNames.length; i++) {
      this.cursor.write(' '+ attachmentNames[i] + ': "'+ current.attachments[attachmentNames[i]].toString() +'"');
    }
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

// Change the scroll position by the given number. Prevent scrolling past the
// end of the list of sockets.
Monitor.prototype._scroll = function(y) {
  var visibleSockets = this._getVisibleSockets();

  if (this.scrollY + y > 0 && this.scrollY + y < visibleSockets) {
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
