var assert = require('better-assert');
var http = require('http');
var socketio = require('socket.io');
var monitorio = require('../index.js');

describe('monitor.io', function() {
  describe('constructor', function() {
    it('should return socket.io middleware', function() {
      var server = http.Server();
      var io = socketio(server);
      var middleware = monitorio();

      assert(typeof middleware === 'function');

      io.use(middleware);
    });
  });

  describe('padding method', function() {
    it('should pad a string with whitespace up to the given length', function() {
      var str = 'hello world';

      str = monitorio.prototype._pad(str, 22);
      assert(str.length === 22);
      str = str.trim();
      assert(str.length === 11);
    });
  });
});