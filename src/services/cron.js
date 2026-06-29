import fs from "fs";
import path from "path";
import os from "os";

const CRON_FILE = path.join(os.homedir(), ".haxagent", "data", "cron_jobs.json");
function loadCronJobs() { try { if (fs.existsSync(CRON_FILE)) return JSON.parse(fs.readFileSync(CRON_FILE, "utf-8")); } catch (_) {} return []; }
function saveCronJob(job) { const jobs = loadCronJobs().filter(j => j.id !== job.id); jobs.push(job); const d = path.dirname(CRON_FILE); if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(CRON_FILE, JSON.stringify(jobs, null, 2)); return job; }
function deleteCronJob(id) { const jobs = loadCronJobs().filter(j => j.id !== id); fs.writeFileSync(CRON_FILE, JSON.stringify(jobs, null, 2)); }
export { loadCronJobs, saveCronJob, deleteCronJob };
