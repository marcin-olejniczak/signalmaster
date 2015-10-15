var socketIO = require('socket.io'),
    uuid = require('node-uuid'),
    crypto = require('crypto');

var clients_types = {};

module.exports = function (server, config) {
    var io = socketIO.listen(server);

    if (config.logLevel) {
        // https://github.com/Automattic/socket.io/wiki/Configuring-Socket.IO
        io.set('log level', config.logLevel);
    }

    io.sockets.on('connection', function (client) {
        client.resources = {
            screen: false,
            video: true,
            audio: false
        };

        // pass a message to another id
        client.on('message', function (details) {
            if (!details) return;

            var otherClient = io.sockets.sockets[details.to];
            if (!otherClient) return;

            details.from = client.id;
            otherClient.emit('message', details);
        });

        client.on('shareScreen', function () {
            client.resources.screen = true;
        });

        client.on('unshareScreen', function (type) {
            client.resources.screen = false;
            removeFeed('screen');
        });

        client.on('join', join);

        function removeFeed(type) {
            if (client.room) {
                io.sockets.in(client.room).emit('remove', {
                    id: client.id,
                    type: type
                });
                if (!type) {
                    client.leave(client.room);
                    client.room = undefined;
                }
            }
        }

        function join(name, type, cb) {
            // sanity check
            if (typeof name !== 'string') return;
            // check if maximum number of clients reached
            var clients_in_room = io.sockets.clients(name);
            if (config.rooms && config.rooms.maxClients > 0 &&
                clients_in_room.length >= config.rooms.maxClients) {
                safeCb(cb)('full');
                return;
            }
            // leave any existing rooms
            removeFeed();
            safeCb(cb)(null, describeRoom(name));
            
            // ask user-provider in room if other user-patient can join
            if (type === 'patient'){
                console.log('Room ' + name);
                console.log(client.id + ' of type  ' + type + ' tries to enter');
                // get providers in room
                console.log('clients in room ');
                for (key in clients_in_room){
                    var obj = clients_in_room[key];
                    if(clients_types[obj.id] === 'provider'){
                        // ask for confirmation
                    }
                }
            }else{
                type = 'provider';
            }
            clients_types[client.id]=type;
            
            client.join(name);
            client.room = name;
        }

        // we don't want to pass "leave" directly because the
        // event type string of "socket end" gets passed too.
        client.on('disconnect', function () {
            //remove client from clients_types list
            if(clients_types[client.id]){
                delete clients_types[client.id]
            }
            removeFeed();
        });
        client.on('leave', function () {
            //remove client from clients_types list
            if(clients_types[client.id]){
                delete clients_types[client.id]
            }
            removeFeed();
        });

        client.on('create', function (name, cb) {
            if (arguments.length == 2) {
                cb = (typeof cb == 'function') ? cb : function () {};
                name = name || uuid();
            } else {
                cb = name;
                name = uuid();
            }
            // check if exists
            if (io.sockets.clients(name).length) {
                safeCb(cb)('taken');
            } else {
                join(name);
                safeCb(cb)(null, name);
            }
        });

        // support for logging full webrtc traces to stdout
        // useful for large-scale error monitoring
        client.on('trace', function (data) {
            console.log('trace', JSON.stringify(
            [data.type, data.session, data.prefix, data.peer, data.time, data.value]
            ));
        });


        // tell client about stun and turn servers and generate nonces
        client.emit('stunservers', config.stunservers || []);

        // create shared secret nonces for TURN authentication
        // the process is described in draft-uberti-behave-turn-rest
        var credentials = [];
        config.turnservers.forEach(function (server) {
            var hmac = crypto.createHmac('sha1', server.secret);
            // default to 86400 seconds timeout unless specified
            var username = Math.floor(new Date().getTime() / 1000) + (server.expiry || 86400) + "";
            hmac.update(username);
            credentials.push({
                username: username,
                credential: hmac.digest('base64'),
                url: server.url
            });
        });
        client.emit('turnservers', credentials);
    });


    function describeRoom(name) {
        var clients = io.sockets.clients(name);
        var result = {
            clients: {}
        };
        clients.forEach(function (client) {
            result.clients[client.id] = client.resources;
        });
        return result;
    }

    function clientsInRoom(name) {
        return io.sockets.clients(name).length;
    }

};

function safeCb(cb) {
    if (typeof cb === 'function') {
        return cb;
    } else {
        return function () {};
    }
}
