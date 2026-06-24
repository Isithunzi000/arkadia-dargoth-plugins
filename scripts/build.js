#!/usr/bin/env node
const fs   = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const esbuild = require("esbuild");

const RELEASES = path.join(__dirname, "..", "releases");
const DIST     = path.join(__dirname, "..", "dist");
const TMP      = path.join(__dirname, "..", ".build_tmp");

fs.mkdirSync(DIST, { recursive: true });
fs.mkdirSync(TMP,  { recursive: true });

const zips = fs.readdirSync(RELEASES).filter(f => f.endsWith(".zip"));
if (!zips.length) { console.log("Brak zipow w releases/"); process.exit(0); }

(async () => {
    let ok = 0;
    const index = [];

    for (const zip of zips) {
        const zipPath = path.join(RELEASES, zip);
        const pluginName = zip.replace(/_[\d._]+\.zip$/, "").replace(/\.zip$/, "");
        const tmpDir = path.join(TMP, pluginName);

        console.log(`\n[${pluginName}] Rozpakowuje ${zip}...`);
        fs.rmSync(tmpDir, { recursive: true, force: true });
        fs.mkdirSync(tmpDir, { recursive: true });
        execSync(`unzip -q "${zipPath}" -d "${tmpDir}"`);

        const tsFiles = execSync(`find "${tmpDir}" -name "index.ts"`, { encoding: "utf8" })
            .trim().split("\n").filter(Boolean);

        if (!tsFiles.length) {
            console.error(`  POMINIETY: brak index.ts`);
            continue;
        }

        const tsFile = tsFiles[0];
        const outFile = path.join(DIST, `${pluginName}.js`);
        console.log(`  Kompiluje: ${path.relative(tmpDir, tsFile)}`);

        try {
            const src = fs.readFileSync(tsFile, "utf8");
            const result = await esbuild.transform(src, {
                loader:  "ts",
                format:  "esm",
                target:  "es2020",
            });

            fs.writeFileSync(outFile, result.code, "utf8");
            const kb = (result.code.length / 1024).toFixed(1);
            console.log(`  OK -> dist/${pluginName}.js (${kb} kB)`);
            index.push({ name: pluginName, zip, file: `${pluginName}.js`, kb });
            ok++;
        } catch (e) {
            console.error(`  BLAD: ${e.message}`);
            process.exitCode = 1;
        }
    }

    fs.rmSync(TMP, { recursive: true, force: true });

    fs.writeFileSync(
        path.join(DIST, "index.json"),
        JSON.stringify({ built: new Date().toISOString(), plugins: index }, null, 2)
    );

    console.log(`\nGotowe: ${ok}/${zips.length} pluginow`);
    fs.readdirSync(DIST).forEach(f => console.log("  " + f));
})();
