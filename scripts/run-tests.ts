import {spawn} from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

async function listTestFiles(rootDir: string): Promise<string[]> {
   const out: string[] = [];

   async function walk(dir: string): Promise<void> {
      const entries = await fs.readdir(dir, {withFileTypes: true});
      for (const ent of entries) {
         const fullPath = path.join(dir, ent.name);
         if (ent.isDirectory()) {
            await walk(fullPath);
         } else if (ent.isFile()) {
            // Keep this conservative: only TS tests under ./tests.
            if (/\.test\.(ts|tsx)$/i.test(ent.name)) {
               out.push(fullPath);
            }
         }
      }
   }

   await walk(rootDir);
   out.sort((a, b) => a.localeCompare(b));
   return out;
}

async function main(): Promise<number> {
   const repoRoot = process.cwd();
   const testsDir = path.join(repoRoot, "tests");

   let testFiles: string[] = [];
   try {
      testFiles = await listTestFiles(testsDir);
   } catch (err: any) {
      // If ./tests doesn't exist, behave like "no tests".
      if (err?.code === "ENOENT") {
         testFiles = [];
      } else {
         throw err;
      }
   }

   const args = ["--import", "tsx", "--test", ...testFiles];

   return await new Promise<number>((resolve) => {
      const child = spawn(process.execPath, args, {
         stdio: "inherit",
         shell: false,
      });

      child.on("exit", (code, signal) => {
         if (typeof code === "number") {
            resolve(code);
            return;
         }
         resolve(signal ? 1 : 0);
      });
   });
}

main().then((code) => process.exit(code)).catch((err) => {
   // eslint-disable-next-line no-console
   console.error(err);
   process.exit(1);
});
