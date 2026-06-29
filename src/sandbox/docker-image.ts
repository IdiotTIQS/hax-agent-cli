/** Docker image management. Ported from OpenHarness sandbox/docker_image.py */
import { execSync } from "child_process";

const DEFAULT_IMAGE = "node:18-alpine";
const IMAGE_TAG = "hax-sandbox:latest";

function buildSandboxImage(opts = {}) {
  const image = opts.image || DEFAULT_IMAGE;
  try { execSync(`docker pull ${image}`, { encoding: "utf-8", timeout: 120000, stdio: "pipe" }); return { ok: true, image }; }
  catch (err) { return { ok: false, error: err.message, image }; }
}

function getImageName() { return process.env.HAX_SANDBOX_IMAGE || DEFAULT_IMAGE; }

export { DEFAULT_IMAGE, IMAGE_TAG, buildSandboxImage, getImageName };
