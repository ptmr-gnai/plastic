import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const rootDir = new URL("..", import.meta.url).pathname;
const desktopDir = resolve(rootDir, "apps/desktop");
const desktopRequire = createRequire(`${desktopDir}/package.json`);
const desktopPackage = JSON.parse(readFileSync(resolve(desktopDir, "package.json"), "utf8"));
const electronExecutable = desktopRequire("electron");
const compiledMain = resolve(desktopDir, "dist-electron/main/main.js");
const packageMain = resolve(desktopDir, desktopPackage.main ?? "");
const relevantEnv = Object.fromEntries(
  Object.entries(process.env)
    .filter(([key]) => key.startsWith("ELECTRON_") || key.startsWith("PLASTIC_ELECTRON_") || key === "VITE_DEV_SERVER_URL")
    .sort(([left], [right]) => left.localeCompare(right))
);

console.log(JSON.stringify({
  ok: true,
  electronExecutable,
  desktopDir,
  launchModes: {
    compiledMain: {
      target: compiledMain,
      exists: existsSync(compiledMain)
    },
    package: {
      target: desktopDir,
      packageMain: desktopPackage.main ?? null,
      packageMainPath: packageMain,
      packageMainExists: existsSync(packageMain)
    }
  },
  relevantEnv
}, null, 2));
