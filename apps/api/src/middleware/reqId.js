"use strict";

const crypto = require("crypto");

function attachReqId(req, _res, next) {
  req.id = crypto.randomUUID();
  next();
}

module.exports = attachReqId;
