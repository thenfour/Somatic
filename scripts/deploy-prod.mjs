
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import dotenv from "dotenv";
import SftpClient from "ssh2-sftp-client";

const ROOT = process.cwd();
const BUILD_DIR = path.join(ROOT, "dist");

const envPath = path.join(ROOT, ".env");
const envLocalPath = path.join(ROOT, ".env.local");

if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}
if (fs.existsSync(envLocalPath)) {
  dotenv.config({ path: envLocalPath });
}

const {
  DEPLOY_HOST,
  DEPLOY_USER,
  DEPLOY_DIR,
  DEPLOY_PORT = "22",
  DEPLOY_PASSWORD,
  DEPLOY_KEY,
} = process.env;

if (!fs.existsSync(BUILD_DIR)) {
  console.error(`Build directory does not exist: ${BUILD_DIR}`);
  console.error('Be sure to build first');
  process.exit(1);
}

function toPosix(p) {
  // Convert Windows backslashes to POSIX slashes for remote paths
  return p.replace(/\\/g, "/");
}

async function uploadDirectory(sftp, localDir, remoteDir) {
  const entries = fs.readdirSync(localDir, { withFileTypes: true });

  // Ensure remote dir exists (recursive)
  await sftp.mkdir(remoteDir, true).catch(() => {});

  for (const entry of entries) {
    const localPath = path.join(localDir, entry.name);
    const remotePath = toPosix(path.posix.join(remoteDir, entry.name));

    if (entry.isDirectory()) {
      await uploadDirectory(sftp, localPath, remotePath);
    } else if (entry.isFile()) {
      console.log(`Uploading ${localPath} -> ${remotePath}`);
      await sftp.fastPut(localPath, remotePath);
    }
  }
}

async function main() {
  const sftp = new SftpClient();

  const config = {
    host: DEPLOY_HOST,
    port: Number(DEPLOY_PORT),
    username: DEPLOY_USER,
  };

  if (DEPLOY_KEY) {
    config.privateKey = fs.readFileSync(DEPLOY_KEY, "utf8");
  } else if (DEPLOY_PASSWORD) {
    config.password = DEPLOY_PASSWORD;
  }

  console.log(
    `Connecting to ${DEPLOY_USER}@${DEPLOY_HOST}:${DEPLOY_PORT}, uploading dist/ -> ${DEPLOY_DIR}`
  );

  //console.log(JSON.stringify(config, null, 2));

  try {
    await sftp.connect(config);
    await uploadDirectory(sftp, BUILD_DIR, DEPLOY_DIR);
  } finally {
    await sftp.end();
  }

  console.log("Deploy complete.");
}

main().catch((err) => {
  console.error("Deploy failed:");
  console.error(err);
  process.exit(1);
});
