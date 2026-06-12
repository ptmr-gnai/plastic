console.log("[plastic:entry-cjs] electron package main entered");

import("./dist-electron/main/main.js").catch((error) => {
  console.error("[plastic:entry-cjs] failed to import compiled main", error);
  process.exitCode = 1;
});
