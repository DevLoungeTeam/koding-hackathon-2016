"use strict";

var express = require('express');
var randomstring = require('randomstring');
var app = express();
var server = require('http').createServer(app);
var io = require('socket.io')(server);
var Parse = require('parse/node').Parse;
var bodyParser = require('body-parser');

var sockets = [];
var points = [];

var Operation = Parse.Object.extend("Questions");
var Records = Parse.Object.extend("personalRecord");

Parse.initialize("", "");

server.listen(80);
sendTick();

app.use(bodyParser.urlencoded({
    extended: true
})); 

app.get('/login', function(req, res) {
    var username = req.query.username;
    var password = req.query.password;
    var randomKey = randomstring.generate();
    
    Parse.User.logIn(username, password, {
        success: function(user) {
            randomKey = user.id;
            res.send(JSON.stringify({ "status" : true, "securityToken": randomKey}));
        },
        error: function(user, error) {
            res.send(JSON.stringify({ "status" : false, "message" : "Error: " + error.message}));
        }
    });
});

app.post('/register', function(req, res) {
    var username = req.body.username;
    var password = req.body.password;
    var confirmPassword = req.body.confirmPassword;
    var email = req.body.email;
    
    if(password != confirmPassword)
        return res.send(JSON.stringify({ "status" : false, "message" : "Error: two passwords don't correspond"}));
    
    var user = new Parse.User();
    user.set("email", email);
    user.set("username", username);
    user.set("password", password);
    
    user.signUp(null, {
        success: function(user) {
            var randomKey = randomstring.generate();
            var _record = new Records();
            _record.set("UserID", user);
            _record.set("Record", 0);
            _record.save();
            res.send(JSON.stringify({ "status" : true, "securityToken": randomKey}));
        },
        error: function(user, error) {
            res.send(JSON.stringify({ "status" : false, "message" : "Error: " + error.message}));
        }
    });
});

app.use('/', express.static(__dirname + '/public'));

io.on("connection", function(socket) {
    sockets.push(socket);
    points.push(0);
    
    socket.on("request operation", function(data) {
        var query = new Parse.Query(Parse.User);
        query.get(data._securityToken, {
            success: function(results) {
                generateOp(results[0], socket);
            },
            error: function(error) {
                
            }
        });
    });
    
    socket.on("join room", function(data) {
        socket.join(data);
    });
    
    socket.on("operation result", function(data) {
        checkResult(data._securityToken, data.questionID, data.result, socket);
    });
    
    socket.on("check timer", function(data) {
        var query = new Parse.Query(Parse.User);
        query.get(data._securityToken, {
            success: function(u) {
                var _query = new Parse.Query(Operation);
                var key = sockets.indexOf(socket);
                var point = points[key];
                _query.get(data.questionID, {
                   success: function(operation) {
                        var date = operation.get("createdAt");
                        date.setSeconds(parseInt(date.getSeconds()) + 3);
                        if(new Date() > date) {
                            points[key] = 0;
                            var record = new Parse.Query(Records);
                            record.equalTo("UserID", u);
                            record.find({
                                success: function(record) {
                                    record = record[0];
                                    record.set("Record", (record.get("Record") > point) ? record.get("Record") : point);
                                    record.save();
                                    
                                    socket.emit("show lose page", {'points': point });
                                }, error: function(record, error) {
                                    var _record = new Records();
                                    _record.set("UserID", u);
                                    _record.set("Record", point);
                                    _record.save();
                                    
                                    socket.emit("show lose page", {'points': point });
                                }
                            });
                        }
                   }, error: function(operation, error) {
                        socket.emit("show lose page", {'points': point });
                   }
                });
            },
            error: function(error) {
                
            }
        });
    });
    
    socket.on("request first 10", function(data) {
        getData(0, socket);
    });
    
    socket.on("request position", function(data) {
        var query = new Parse.Query(Parse.User);
        query.get(data._securityToken, {
            success: function(u) {
                var pos = -1;
                var record = new Parse.Query(Records);
                record.equalTo("UserID", u);
                record.find({
                    success: function(record) {
                        record = record[0];
                        var _query = new Parse.Query(Records);
                        _query.greaterThanOrEqualTo("Record", record.get("Record"));
                        _query.lessThanOrEqualTo("updatedAt", record.get("updatedAt"));
                        
                        _query.count({
                            success: function(count) {
                                socket.emit("position", count);
                            }, error: function(error) {
                                pos = -1;
                                socket.emit("position", pos);
                            }
                        });
                    }, error: function(record, error) {
                        pos = -1;
                        socket.emit("position", pos);
                    }
                });
            }, error: function(u, error) {
                var pos = -1;
                socket.emit("position", pos);
            }
        });
    });
});

function sendTick() {
    io.emit('server tick');
    setTimeout(sendTick, 1000);
}

function randomIntInc(low, high) {
    return Math.floor(Math.random() * (high - low + 1) + low);
}

function generateOp(user, _socket) {
    var op1 = randomIntInc(0, 10);
    var op2 = randomIntInc(0, 10);
    var opr = randomIntInc(1, 3);
    var result = 0;
    
    var operation = new Operation();
    operation.set("UserID", user);
    operation.set("Operand1", op1);
    operation.set("Operator", opr);
    operation.set("Operand2", op2);
    
    switch(opr) {
        case 1:
            result = op1 + op2;
            opr = "+";
            break;
        case 2:
            if(op2 > op1) {
                var appoggio = op1;
                op1 = op2;
                op2 = appoggio;
            }
            result = op1 - op2;
            operation.set("Operand1", op1);
            operation.set("Operand2", op2);
            opr = "-";
            break;
        case 3:
            result = op1 * op2;
            opr = "&#215;";
            break;
        default:
            result = op1 + op2;
            opr = "+";
    }
    operation.set("Result", result);
    operation.save(null, {
        success: function(operation) {
            _socket.emit('operation', { 'operand1': op1, 'operand2': op2, 'operation': opr, 'questionID': operation.id });
        },
        error: function(operation, error) {
            generateOp(operation.UserID, _socket);
        }
    });
}

function checkResult(user, questionID, result, _socket) {
    var query = new Parse.Query(Operation);
    query.get(questionID, {
        success: function(operation) {
            var date = operation.get("createdAt");
            date.setSeconds(parseInt(date.getSeconds()) + 3);
            if(new Date() > date) {
                var key = sockets.indexOf(_socket);
                var point = points[key];
                _socket.emit("show lose page", {'points': point, 'personalRecord': user.get("personalRecord")});
                points[key] = 0;
            } else {
                if(operation.get("Result") == result) {
                    var key = sockets.indexOf(_socket);
                    var point = points[key];
                    points[key] = point + 1;
                    _socket.emit('operation result', { 'status': true, 'points': points[key] });
                    generateOp(operation.UserID, _socket);
                } else {
                    _socket.emit('operation result', { 'status': false });
                }
            }
        },
        error: function(object, error) {
            _socket.emit('operation result', { 'status': false });
        }
    });
}

function getData(k, _socket) {
    if(k > 10)
        return;
        
    var query = new Parse.Query(Records);
    var ranks = [];
    var i = 1;
    query.descending("Record");
    
    query.skip(k);
    query.first().then(function(object) {
        object.get("UserID").fetch({
            success: function(uInfo) {
                _socket.emit("first 10", { id: ++k, record: object.get("Record"), username: uInfo.get("username") });
                getData(k++, _socket);
            }
        });
    });
}