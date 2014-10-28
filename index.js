var ansi = require('ansi');
var keypress = require('keypress');
var telnet = require('telnet');

var commands = {
  'b': 'roadcast to all',
  'e': 'mit to socket',
  'x': ' disconnect socket',
  'hjkl': ' to scroll'
};

var defaultOpts = {
  width: 100,
  height: 40,
  port: 1337,
  localOnly: false
};

module.exports = Monitor;

function Monitor(opts) {
  if (!(this instanceof Monitor)) {
    return new Monitor(opts);
  }
  
  var self = this;

  this.opts = opts || {};
  this.opts.remote = (typeof this.opts.port === undefined) ? false : true;
  this.opts.width = this.opts.width || defaultOpts.width;
  this.opts.height = this.opts.height || defaultOpts.height;
  this.opts.port = this.opts.port || defaultOpts.port;
  this.opts.localOnly = this.opts.localOnly || defaultOpts.localOnly;

  this.scrollX = 0;
  this.scrollY = 0;
  this.selected = 0;

  this.sockets = {};

  this.connectedSock = false;

  this.loop = false;
  this.running = false;

  // set the initial dirty bit to true
  this.dirty = true;

  // emit mode: 0 is off, 1 is name, 2 is value
  this.emitBuffer = [ null, '', '' ];
  this.emitMode = 0;
  this.emitSocket = false;
  this.broadcastMode = false;

  this.ansi = ansi;

  if (this.opts.remote) {
    // start a server
    telnet.createServer(function(client) {
      var ip = client.input.remoteAddress;

      if (self.opts.localOnly && ip !== '127.0.0.1') {
        // disconnect the foreign client
        client.input.end();
        client.output.end();
        return;
      }

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
          self.opts.width = e.width;
          self.opts.height = e.height;
          self._renderTitle();
          self._renderBody();          
        }
      });

      keypress(client);

      client.on('keypress', self._handleKeypress.bind(self));

      self._addNewLines();
      self._run();
      self._renderTitle();
      self._attemptBodyRender();
    }).listen(this.opts.port);
    
    console.log('monitor.io: server listening on '+ this.opts.port);
    if (this.opts.localOnly) {
      console.log('monitor.io: will only accept connections from 127.0.0.1');
    }
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
    this._renderTitle();
    this._renderBody();
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

// Renders the list of sockets if not in emit mode and if socket data has changed.
Monitor.prototype._attemptBodyRender = function() {
  if (this.emitMode < 1 && this.dirty) {
    this._renderBody();
    this.dirty = false;
  }
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
  this.dirty = true;

  setTimeout(function() {
    this.dirty = true;
  }, 1000);
};

Monitor.prototype._getWindowSize = function() {
  var windowSize;
  if (this.opts.remote || process.stdout.getWindowSize === undefined) {
    return {
      width: this.opts.width,
      height: this.opts.height
    };
  } else if (typeof process.stdout.getWindowSize === 'function') {
    windowSize = process.stdout.getWindowSize();
    return {
      width: windowSize[0],
      height: windowSize[1]
    };
  }
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

  // handle keypresses initiating and during emit mode
  if (this.emitMode > 0) {
    if (key && key.name === 'return') {
      this._switchEmitMode(this.emitMode + 1);
    } else if (key && key.name === 'backspace') {
      this.emitBuffer[this.emitMode] = this.emitBuffer[this.emitMode].substring(0, this.emitBuffer[this.emitMode].length - 1);
      this._renderEmit();
    } else if (key && key.name === 'escape') {
      this._resetEmitMode();
      this._renderBody();
    } else {
      this.cursor.write(ch);
      this.emitBuffer[this.emitMode] += ch;
    }
    return;
  }

  // handle keypresses all other times
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
      this._renderBody();
      break;
    case 'l':
      this._scrollX(1);
      this._renderBody();
      break;
    case 'k':
      this._moveCursor(-1);
      this._renderBody();
      break;
    case 'j':
      this._moveCursor(1);
      this._renderBody();
      break;
    case 'x':
      this._disconnectSocket(Object.keys(this.sockets)[this.selected]);
      this._renderBody();
      break;
  }
};

// Middleware function for Socket.IO. It is passed each socket when
// it connects and saves a reference.
Monitor.prototype._middleware = function(socket, next) {
  socket._monitor = {};
  socket.monitor = this._monitorFn.bind(this, socket);
  this.sockets[socket.id] = socket;
  this.dirty = true;
  next();
};

// Monitor setter/getter function that is added to every socket.
Monitor.prototype._monitorFn = function(socket, name, value) {
  if (typeof arguments[1] === 'object') {
    socket._monitor = arguments[1];
    if (this.running) {
      this.dirty = true;
    }
  } else if (typeof arguments[1] === 'string') {
    if (value === undefined) {
      return socket._monitor[name];    
    } else {
      socket._monitor[name] = value;
      if (this.running) {
        this.dirty = true;
      }
    }
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
      this.dirty = true;
    }
  }

  if (this.selected > socketIDs.length - 1) {
    this.selected = Math.max(socketIDs.length - 1, 0);
  }
};

// Renders the body.
Monitor.prototype._renderBody = function() {
  var socketIDs = Object.keys(this.sockets),
    windowHeight = this._getWindowSize().height,
    visibleSockets = (socketIDs.length > windowHeight - 5) ? windowHeight - 5 : socketIDs.length,
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

      this._renderSocket(this.sockets[socketIDs[i]], (i === this.selected));
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

  if (this.emitMode > 2) {
    this.cursor.hide().write('\n\nEvent "').bold().write(this.emitBuffer[1]);
    this.cursor.reset().write('" emitted to ');

    if (this.broadcastMode) {
      this.cursor.bold().write('all sockets.').reset();
    } else {
      this.cursor.bold().write(this.emitSocket.conn.remoteAddress).reset();
    }
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
      this.cursor.bold().write(this._pad('> '+ socket.conn.remoteAddress, 17)).reset();
    } else {
      this.cursor.bold().write(this._pad(socket.conn.remoteAddress, 17)).reset();
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

    if (buffer.length > windowWidth - 18) {
      buffer = buffer.substring(0, windowWidth - 21) + '...';
    }

    this.cursor.write(buffer);
  }
  this.cursor.write('\n');
};

// Renders the title of the application.
Monitor.prototype._renderTitle = function() {
  var title = 'monitor.io',
    commaFlag = true,
    exitText = '(ctrl + c to exit)',
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
        this.sockets[socketIDs[i]].emit(this.emitBuffer[1], evtData);
      }
    } else {
      this.emitSocket.emit(this.emitBuffer[1], evtData);
    }
  }
  
  if (mode === 3){
    // render the final stage, then switch out of emit mode
    this._renderEmit();

    setTimeout(function() {
      self._resetEmitMode();
      self._renderBody();
    }, 2000);
  } else {
    this._renderEmit();
  }
};

// Stops ticking
Monitor.prototype._stop = function() {
  clearInterval(this.loop);
  this.running = false;
};

// Updates internal data.
Monitor.prototype._tick = function() {
  this._removeDisconnectedSockets();
  this._attemptBodyRender();
};
