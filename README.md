monitor.io
==========
### Simple remote monitoring and debugging middleware for socket.io.

![monitor.io](https://github.com/drewblaisdell/monitor.io/raw/master/monitor.io.gif "monitor.io")

`monitor.io` is a module for Node.js that runs as a telnet server, giving a remote client control of and information about sockets connected to an instance of `socket.io`.

This makes it possible to disconnect, emit, or broadcast data to sockets in a remote terminal without interrupting the Node.js process running `socket.io`. `monitor.io`s also provides a real-time display of any data attached to a socket with the `socket#monitor` method.

Installation
------------

``` bash
$ npm install monitor.io
```

Usage
-----

``` js
var socketio = require('socket.io')(server),
  monitorio = require('monitor.io');

socketio.use(monitorio({ port: 8000 })); // monitor.io started on port 8000
```

Now use telnet to connect and control a real-time list of sockets connected to `socket.io`.

``` bash
$ telnet myapp.com 8000
```

Use `hjkl` to scroll verticall/horizontally through the list of sockets, `e` to emit data to a specific socket, and `b` to broadcast data to all sockets.

### Monitoring

`monitor.io` attaches a method named `monitor` to every socket object. This method attaches data to a socket and tells `monitor.io` to render this data in the `monitor.io` terminal window.

Here is an example of how to attach the time that a socket connected to `socket.io`:

``` js
io.on('connection', function(socket) {
  socket.monitor('timeConnected', Date.now());  
});
```

`socket#monitor` must be called whenever monitored information changes, such as the score of a player in a real-time game, to force a rerender in the `monitor.io` window.

``` js
socket.on('newHighScore', function(msg) {
  var score = msg.score;
  socket.monitor('highScore', msg.score);
});
```

The `monitor` method also accepts an object, and will display every key-value pair in an object.

``` js
socket.on('newPlayer', function(msg) {
  var newPlayer = game.createPlayer();
  socket.monitor(newPlayer); // every key-value pair in newPlayer will be shown in the monitor.io terminal window.
});
```

License
-------
MIT