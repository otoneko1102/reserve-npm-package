#!/usr/bin/env node
/*
  CLI: npm run reserve -p/--package-name <package-name> -u/--username <username>
  If flags omitted, ask interactively (unless non-interactive environment).
  Uses process.env.NPM_TOKEN for publishing.
  Creates a temporary copy of the repo, replaces <username> and <package-name>
  in all text files inside that temporary copy, writes a temporary .npmrc with
  the token, runs `npm publish`, then removes the temporary directory.
*/

require("dotenv").config({ quiet: true });

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");

function parseArgs(argv) {
  const result = { packageName: null, username: null, raw: argv.slice(2) };
  const positionals = [];
  for (let i = 0; i < result.raw.length; i++) {
    const a = result.raw[i];
    if (a === "-p" || a === "--package-name") {
      result.packageName = result.raw[++i];
    } else if (a === "-u" || a === "--username") {
      result.username = result.raw[++i];
    } else if (a === "--help" || a === "-h") {
      result.help = true;
    } else {
      // collect unknown tokens as positionals so `npm run reserve nsc otoneko` works
      positionals.push(a);
    }
  }

  // if flags were not used, support positional args: <packageName> <username>
  if (!result.packageName && positionals.length > 0) result.packageName = positionals.shift();
  if (!result.username && positionals.length > 0) result.username = positionals.shift();

  return result;
}

function help() {
  console.log("Usage: npm run reserve -- -p <package-name> -u <username>");
  console.log("If flags are omitted you will be prompted interactively.");
  console.log("Notes: username is used for `author`/LICENSE placeholders only; the tool will never publish as a scoped package.");
}

async function prompt(question) {
  return new Promise((resolve) => {
    const rl = require("readline").createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function simpleValidatePackageName(name) {
  if (!name) return false;
  if (name.length > 214) return false;
  if (/[\s]/.test(name)) return false;
  if (/^[._]/.test(name)) return false;
  return true;
}



async function copyDir(src, dest) {
  await fs.promises.mkdir(dest, { recursive: true });
  const entries = await fs.promises.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    // skip node_modules and .git to keep temp copy small
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else if (entry.isFile()) {
      await fs.promises.copyFile(srcPath, destPath);
    }
  }
}

async function replacePlaceholdersInDir(dir, replacements) {
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const p = path.join(dir, entry.name);
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    if (entry.isDirectory()) {
      await replacePlaceholdersInDir(p, replacements);
      continue;
    }
    // attempt to read as utf8 text; if fails, skip the file
    try {
      let content = await fs.promises.readFile(p, "utf8");
      let changed = false;
      for (const [k, v] of Object.entries(replacements)) {
        if (content.indexOf(k) !== -1) {
          content = content.split(k).join(v);
          changed = true;
        }
      }
      if (changed) await fs.promises.writeFile(p, content, "utf8");
    } catch (err) {
      // binary or unreadable file — skip
    }
  }
}

async function runPublish(tmpDir) {
  return new Promise((resolve) => {
    const child = spawn("npm", ["publish", "--access", "public"], { cwd: tmpDir, shell: true });
    let out = "";
    let err = "";
    if (child.stdout) child.stdout.on("data", (d) => { process.stdout.write(d); out += d.toString(); });
    if (child.stderr) child.stderr.on("data", (d) => { process.stderr.write(d); err += d.toString(); });
    child.on("close", (code) => {
      resolve({ code, stdout: out, stderr: err });
    });
  });
}

(async function main() {
  try {
    const args = parseArgs(process.argv);
    if (args.help) return help();

    let { packageName, username } = args;

    const isTTY = process.stdin.isTTY && process.stdout.isTTY;

    if (!packageName && !isTTY) {
      console.error(
        "Error: package name missing and not in interactive terminal. Provide -p/--package-name.",
      );
      process.exit(1);
    }
    if (!username && !isTTY) {
      console.error(
        "Error: username missing and not in interactive terminal. Provide -u/--username.",
      );
      process.exit(1);
    }

    if (!packageName) {
      packageName = await prompt("Package name to reserve: ");
    }
    if (!username) {
      username = await prompt("Username to reserve under: ");
    }
    // basic trimming of user input
    if (username) username = username.trim();
    if (!simpleValidatePackageName(packageName)) {
      console.error("Invalid package name. Aborting.");
      process.exit(1);
    }
    if (!username) {
      console.error("Invalid username. Aborting.");
      process.exit(1);
    }

    const token = process.env.NPM_TOKEN;
    if (!token) {
      console.error(
        "NPM_TOKEN environment variable is required (process.env.NPM_TOKEN).",
      );
      process.exit(1);
    }

    const cwd = process.cwd();
    const tmpRoot = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "reserve-npm-"),
    );
    const tmpDir = path.join(tmpRoot, path.basename(cwd));

    console.log("\n🔧 Creating temporary workspace...");
    await copyDir(cwd, tmpDir);

    console.log("🔁 Replacing placeholders in temporary copy...");
    await replacePlaceholdersInDir(tmpDir, {
      "<username>": username,
      "<package-name>": packageName,
    });

    // ensure package.json name/author updated even if not matched above
    try {
      const pkgPath = path.join(tmpDir, "package.json");
      const pkg = JSON.parse(await fs.promises.readFile(pkgPath, "utf8"));
      pkg.name = packageName;
      pkg.author = username;
      // force reservation version per spec
      pkg.version = "0.0.0-reserved";
      await fs.promises.writeFile(
        pkgPath,
        JSON.stringify(pkg, null, 2),
        "utf8",
      );
    } catch (err) {
      // ignore if package.json missing — publish will fail later
    }

    // write temporary .npmrc with token (only in tmpDir)
    const npmrc = `//registry.npmjs.org/:_authToken=${token}\n`;
    await fs.promises.writeFile(path.join(tmpDir, ".npmrc"), npmrc, "utf8");

    // remove non-publishable files from the temporary copy so they are NOT published
    try {
      const defaultCandidates = [
        'README.md', 'README-ja.md', 'Readme.md', 'readme.md', 'README',
        'log.txt', 'LICENSE', 'LICENSE.md', '.env'
      ];

      // prefer entries from .npmignore if present; otherwise fall back to defaults
      let candidates = defaultCandidates;
      try {
        const npmignorePath = path.join(cwd, '.npmignore');
        const raw = await fs.promises.readFile(npmignorePath, 'utf8');
        const lines = raw
          .split(/\r?\n/) // split
          .map((l) => l.trim()) // trim
          .filter((l) => l && !l.startsWith('#') && !l.startsWith('!'));
        if (lines.length) {
          candidates = Array.from(new Set(lines.map((l) => l.replace(/\/+$/, ''))));
        }
      } catch (e) {
        // no .npmignore or could not read — use defaults
      }

      for (const r of candidates) {
        // ignore complex glob patterns (keep removal simple)
        if (/[\*\?\[\]]/.test(r)) continue;
        const p = path.join(tmpDir, r);
        try {
          const st = await fs.promises.stat(p);
          if (st.isDirectory()) {
            await fs.promises.rm(p, { recursive: true, force: true });
          } else {
            await fs.promises.rm(p, { force: true });
          }
        } catch (err) {
          /* not present — ignore */
        }
      }

      console.log("ℹ️  Removed files from temporary package according to .npmignore (or defaults).");
    } catch (err) {
      // ignore removal errors
    }

    console.log(`\n🚀 Publishing ${packageName}@0.0.0-reserved (temporary)...`);
    let publishResult = await runPublish(tmpDir);

    if (publishResult.code === 0) {
      console.log(`\n✅ Successfully published ${packageName}@0.0.0-reserved`);

      // log the reserved package name at the top of log.txt (newest first)
      try {
        const logPath = path.join(cwd, 'log.txt');
        let prev = '';
        try { prev = await fs.promises.readFile(logPath, 'utf8'); } catch (e) { /* missing file is fine */ }
        const updated = packageName + '\n' + (prev || '');
        await fs.promises.writeFile(logPath, updated, 'utf8');
        console.log(`ℹ️  Recorded reserved package in ${logPath}`);
      } catch (err) {
        console.error('Warning: failed to update log.txt -', err.message || err);
      }

    } else {
      // show npm output and fail — this tool will not attempt a scoped publish
      console.error('\n--- npm publish output ---');
      process.stdout.write(publishResult.stdout || '');
      process.stderr.write(publishResult.stderr || '');
      console.error('--- end output ---\n');

      const logText = (publishResult.stderr || publishResult.stdout || '').toString();
      const nameTaken = /Package name too similar|is already in use|403 Forbidden|E403|forbidden/i.test(logText);
      if (nameTaken) {
        console.error('Publish was rejected (name already used or too similar). This tool will not publish as a scoped package; choose a different package-name.');
      }

      throw new Error((publishResult.stderr || publishResult.stdout || '').toString() || 'npm publish failed with code ' + publishResult.code);
    }

    // cleanup
    try {
      await fs.promises.rm(tmpRoot, { recursive: true, force: true });
    } catch (err) {
      // ignore cleanup errors
    }
  } catch (err) {
    console.error("\n⚠️  Error:", err.message || err);
    process.exit(1);
  }
})();
