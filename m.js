var Monitor = function(io) {
  // io.use(function(socket, next) {
  //   console.log(socket.id);
  //   next();
  // });
console.log(this);
};

Monitor.prototype.middleware = function(socket, next) {
  console.log('MIDDLEWARE: '+ socket.id);
  next();
};

module.exports = Monitor;