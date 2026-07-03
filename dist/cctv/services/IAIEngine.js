"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EngineState = void 0;
var EngineState;
(function (EngineState) {
    EngineState["STARTING"] = "STARTING";
    EngineState["READY"] = "READY";
    EngineState["DEGRADED"] = "DEGRADED";
    EngineState["STOPPING"] = "STOPPING";
    EngineState["STOPPED"] = "STOPPED";
    EngineState["FAILED"] = "FAILED";
})(EngineState || (exports.EngineState = EngineState = {}));
