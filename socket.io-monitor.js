var ansi = require('ansi');
var keypress = require('keypress');
var telnet = require('telnet');

var commands = {
  'b': 'roadcast to all',
  'e': 'mit to socket',
  'x': ' disconnect socket',
  'hjkl': ' to scroll'
};

var defaultOptions = {
  width: 100,
  height: 50,
  port: 1337
};

module.exports = Monitor;

function Monitor(options) {
  if (!(this instanceof Monitor)) {
    return new Monitor(options);
  }
  
  var self = this;

  this.options = options || {};
  this.options.width = this.options.width || defaultOptions.width;
  this.options.height = this.options.height || defaultOptions.height;
  this.options.port = this.options.port || defaultOptions.port;

  this.scrollX = 0;
  this.scrollY = 0;
  this.selected = 0;

  this.sockets = {};

  this.connectedSock = false;

  this.loop = false;
  this.running = false;

  // set the initial dirty bit to true
  this.dirty = {
    body: true,
    title: true,
    emit: [ null, true, true ]
  };

  // emit mode: 0 is off, 1 is name, 2 is value
  this.emitBuffer = [ null, '', '' ];
  this.emitMode = 0;
  this.emitSocket = false;
  this.broadcastMode = false;

  this.ansi = ansi;

  if (options.remote) {
    // start a server
    telnet.createServer(function(client) {
      self.connectedSock = client;

      // make unicode characters work properly
      client.do.transmit_binary()

      // make the client emit the window size
      client.do.window_size()

      // force the client into character mode
      client.do.suppress_go_ahead()
      client.will.suppress_go_ahead()
      client.will.echo()

      self.cursor = ansi(client, { enabled: true });   

      client.on('window size', function(e) {
        if (e.width && e.height) {
          self.options.width = e.width;
          self.options.height = e.height;
          self.dirty.title = true;
          self._render();
        }
      });

      keypress(client);

      client.on('keypress', self._handleKeypress.bind(self));

      self._addNewLines();
      self._run();
      self._render();
    }).listen(this.options.port);
    
    console.log('Monitor.IO server started on '+ this.options.port);
  } else {
    // output to the current stdout
    this.cursor = ansi(process.stdout);

    keypress(process.stdin);

    // Capture and handle keypresses.
    process.stdin.on('keypress', this._handleKeypress.bind(this));
    process.stdin.setRawMode(true);
    process.stdin.resume();

    // Log new lines to make room for the application.
    this._addNewLines();

    // Hide the cursor.
    this.cursor.hide();

    // Show the cursor on exit.
    var exitHandler = function(err) {
      if (err) {
        console.log(err.stack);
      }

      self._stop();
      self.cursor.show();
      self.cursor.write('\n');
      process.exit();
    };

    process.on('exit', exitHandler);
    process.on('SIGINT', exitHandler);
    process.on('uncaughtException', exitHandler);

    this._run();
    this._render();
  }

  return this._middleware.bind(this);
};

// Log as many new lines as the height of the window.
Monitor.prototype._addNewLines = function() {
  this.cursor
    .write(Array.apply(null, Array(this._getWindowSize().height)).map(function() {
      return '\n';
    }).join(''))
    .eraseData()
    .goto(1, 1);
};

// Clear the console, starting with the given line.
Monitor.prototype._clear = function(line) {
  var windowHeight = this._getWindowSize().height;

  for (var i = line; i <= windowHeight; i++) {
    this.cursor.goto(1, i).eraseLine().write('');
  }
};

// Disconnect the socket with the given ID.
Monitor.prototype._disconnectSocket = function(id) {
  var self = this;
  this.sockets[id].disconnect();
  this.dirty.body = true;

  setTimeout(function() {
    self.dirty.body = true;
    self._render();
  }, 1000);
};

Monitor.prototype._getWindowSize = function() {
  var windowSize, width, height;
  if (this.options.remote || process.stdout.getWindowSize === undefined) {
    width = this.options.width;
    height = this.options.height;
  } else if (typeof process.stdout.getWindowSize === 'function') {
    windowSize = process.stdout.getWindowSize();
    width = windowSize[0];
    height = windowSize[1];
  }

  return {
    width: width,
    height: height
  };
};

Monitor.prototype._getVisibleSockets = function() {
  var socketIDs = Object.keys(this.sockets),
    windowHeight = this._getWindowSize().height;
  
  return (socketIDs.length > windowHeight - 5) ? windowHeight - 5 : socketIDs.length;
};

// Handle a stdin keypress.
Monitor.prototype._handleKeypress = function(ch, key) {
  // Exit on ctrl + c
  if (key && key.ctrl && key.name === 'c') {
    this._resetEmitMode();

    if (this.connectedSock) {
      this._stop();
      this.cursor.show();
      this.connectedSock.destroy();
    } else {
      process.exit();
    }
  }

  if (this.emitMode > 0) {
    if (key && key.name === 'return') {
      this._switchEmitMode(this.emitMode + 1);
    } else if (key && key.name === 'backspace') {
      this.emitBuffer[this.emitMode] = this.emitBuffer[this.emitMode].substring(0, this.emitBuffer[this.emitMode].length - 1);
      this._renderEmit();
    } else if (key && key.name === 'escape') {
      this._resetEmitMode();
      this.dirty.body = true;
      this._render();
    } else {
      this.cursor.write(ch);
      this.emitBuffer[this.emitMode] += ch;
    }
    return;
  }

  switch (ch) {
    case 'e':
      this._switchEmitMode(1);
      break;
    case 'b':
      this.broadcastMode = true;
      this._switchEmitMode(1);
      break;
    case 'h':
      this._scrollX(-1);
      this.dirty.body = true;
      this._render();
      break;
    case 'l':
      this._scrollX(1);
      this.dirty.body = true;
      this._render();
      break;
    case 'k':
      this._moveCursor(-1);
      this.dirty.body = true;
      this._render();
      break;
    case 'j':
      this._moveCursor(1);
      this.dirty.body = true;
      this._render();
      break;
    case 'x':
      this._disconnectSocket(Object.keys(this.sockets)[this.selected]);
      this.dirty.body = true;
      this._render();
      break;
  }
};

// Middleware function for Socket.IO. It is passed each socket when
// it connects and saves a reference.
Monitor.prototype._middleware = function(socket, next) {
  socket._monitor = {};
  socket.monitor = this._monitorSetter.bind(this, socket);
  this.sockets[socket.id] = socket;
  this.dirty.body = true;
  next();
};

Monitor.prototype._monitorSetter = function(socket, name, value) {
  socket._monitor[name] = value;
  if (this.running) {
    this.dirty.body = true;
    this._render();
  }
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
      this.dirty.body = true;
    }
  }

  if (this.selected > socketIDs.length - 1) {
    this.selected = Math.max(socketIDs.length - 1, 0);
  }
};

// Renders the current state of the application in the terminal.
Monitor.prototype._render = function() {
  if (this.dirty.title) {
    this._renderTitle();
    this.dirty.title = false;
  }

  if (this.emitMode < 1 && this.dirty.body) {
    this._renderBody();
    this.dirty.body = false;
  } else {
    if (this.dirty.emit[this.emitMode]) {
      this._renderEmit();
      this.dirty.emit[this.emitMode] = false;
    }
  }
};

// Renders the body.
Monitor.prototype._renderBody = function() {
  var socketIDs = Object.keys(this.sockets),
    windowHeight = this._getWindowSize().height,
    visibleSockets = (socketIDs.length > windowHeight - 3) ? windowHeight - 3 : socketIDs.length,
    startingSocket = 0;

  if (visibleSockets < socketIDs.length) {
    startingSocket = this.scrollY;
    if (this.scrollY + visibleSockets >= socketIDs.length) {
      this.scrollY = socketIDs.length - visibleSockets;
    }
  }

  this._clear(5);
  this._resetCursor(5);

  if (socketIDs.length === 0) {
    this.cursor.write('No sockets connected.');
  } else {
    for (var i = startingSocket; i < startingSocket + visibleSockets; i++) {
      if (socketIDs[i] === undefined) {
        break;
      }

      if (i === this.selected) {
        this._renderSocket(this.sockets[socketIDs[i]], true);
      } else {
        this._renderSocket(this.sockets[socketIDs[i]], false);
      }
    }
  }

  this.cursor.hide();
};

// Renders the current stage of emit mode.
Monitor.prototype._renderEmit = function() {
  if (this.emitMode > 0){
    this._clear(5);
    this._resetCursor(5);

    if (this.broadcastMode) {
      this.cursor.bold().write('Broadcasting to all sockets.\n');
      this.cursor.reset();
    } else {
      this._renderSocket(this.emitSocket, false);
    }

    this.cursor.write('\nEvent name: ' + this.emitBuffer[1]);
    this.cursor.show();
  }

  if (this.emitMode > 1) {
    this.cursor.write('\nEvent data (JSON): ' + this.emitBuffer[2]);
  }
};

// Renders a single socket in the terminal.
Monitor.prototype._renderSocket = function(socket, selected) {
  var windowWidth = this._getWindowSize().width;

  if (socket.disconnected) {
    this.cursor.bold().write(socket.conn.remoteAddress);
    this.cursor.reset().write(' disconnected...');
  } else {
    if (selected) {
      this.cursor.bold().write(this._pad('> '+ socket.conn.remoteAddress, 15)).reset();
    } else {
      this.cursor.bold().write(this._pad(socket.conn.remoteAddress, 15)).reset();
    }

    var attach = Object.keys(socket._monitor),
      buffer = '';

    for (var i = this.scrollX; i < attach.length; i++) {
      buffer += ' '+ attach[i] + ': ';
      if (typeof socket._monitor[attach[i]] === 'number') {
        buffer += socket._monitor[attach[i]].toString();
      } else {
        buffer += '"'+ socket._monitor[attach[i]].toString() +'"';
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
    commaFlag = true,
    exitText = '(Ctrl + C to exit)',
    windowWidth = this._getWindowSize().width,
    whiteSpace = Array(windowWidth - title.length - exitText.length).join(' ');

  this._clear(1);
  this._resetCursor(1);

  this.cursor.bold().hex('#6349B6').write(title);

  this.cursor.reset().write(whiteSpace);
  this.cursor.hex('#6349B6').write(exitText);
  this.cursor.reset().write('\n\n');

  for (var command in commands) {
    if (commaFlag) {
      commaFlag = false;
    } else {
      this.cursor.write(', ');
    }

    this.cursor.bold().write('[' + command + ']');
    this.cursor.reset().write(commands[command]);
  }

  this.cursor.reset().write('\n\n');
};

// Moves the cursor to character 1 on line y.
Monitor.prototype._resetCursor = function(y) {
  this.cursor.horizontalAbsolute(0).goto(1, y).eraseLine().write('');
};

// Reset's emit mode's stage, buffer, and dirty bits.
Monitor.prototype._resetEmitMode = function() {
  this.broadcastMode = false;
  this.emitMode = 0;
  this.emitBuffer = [null, '', ''];
  this.emitSocket = false;
  this.dirty.emit = [ null, true, true ];
};

// Run.
Monitor.prototype._run = function() {
  this.loop = setInterval(this._tick.bind(this), 1000);
  this.running = true;
};

Monitor.prototype._scrollX = function(x) {
  var socketIDs = Object.keys(this.sockets),
    socket,
    monitors,
    maxX = 0;

  for (var i = 0; i < socketIDs.length; i++) {
    socket = this.sockets[socketIDs[i]];

    monitors = Object.keys(socket._monitor).length;

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

// Start emit mode with the given socket
Monitor.prototype._switchEmitMode = function(mode) {
  var evtData,
    socketIDs = Object.keys(this.sockets),
    self = this;
  
  this.emitMode = mode;

  if (mode === 1) {
    if (!this.broadcastMode) {
      this.emitSocket = this.sockets[Object.keys(this.sockets)[this.selected]];
    }
  } else if (mode === 3) {
    evtData = this.emitBuffer[2];

    try {
      evtData = JSON.parse(evtData);
    } catch(e) {
      this.cursor.write("\nInvalid JSON data.");
      this.emitMode -= 1;
      this.emitBuffer[2] = '';
      
      setInterval(function() {
        self._renderEmit();
      }, 1000);

      return;
    }

    if (this.broadcastMode) {
      for (var i = 0; i < socketIDs.length; i++) {
        var socket = this.sockets[socketIDs[i]];

        socket.emit(this.emitBuffer[1], evtData);
      }
    } else {
      this.emitSocket.emit(this.emitBuffer[1], evtData);
    }

    this._resetEmitMode();
  }
  
  this._render();
};

// Stops ticking
Monitor.prototype._stop = function() {
  clearInterval(this.loop);
  this.running = false;
};

// Updates internal data.
Monitor.prototype._tick = function() {
  this._removeDisconnectedSockets();
  this._render();
};
