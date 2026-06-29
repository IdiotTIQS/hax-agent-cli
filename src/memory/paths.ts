import path from "path"; import os from "os";
function getProjectMemoryDir(cwd: string) { return path.join(cwd||process.cwd(),".hax-agent","memory"); }
function getUserMemoryDir() { return path.join(os.homedir(),".haxagent","memory"); }
export { getProjectMemoryDir, getUserMemoryDir };
