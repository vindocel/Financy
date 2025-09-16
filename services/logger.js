import { config } from "./config.js";

function fmtLevel(level) {
  return level.toUpperCase();
}

function timeIso() {
  return new Date().toISOString();
}

export const logger = {
  info(obj, msg) {
    if (config.logFormat === "json") {
      console.log(JSON.stringify({ level: "info", time: timeIso(), msg, ...obj }));
    } else {
      const ctx = obj ? ` ${JSON.stringify(obj)}` : "";
      console.log(`[${fmtLevel("info")}] ${msg || ""}${ctx}`);
    }
  },
  error(obj, msg) {
    if (config.logFormat === "json") {
      const payload = { level: "error", time: timeIso(), msg, ...obj };
      console.error(JSON.stringify(payload));
    } else {
      const ctx = obj ? ` ${JSON.stringify(obj)}` : "";
      console.error(`[${fmtLevel("error")}] ${msg || ""}${ctx}`);
    }
  },
};

export default logger;

