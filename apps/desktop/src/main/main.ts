console.log("[plastic:entry] electron main module entered");

if (process.env.PLASTIC_ELECTRON_ENTRY_PREFLIGHT === "1") {
  console.log("[plastic:entry-preflight] electron main bootstrap is runnable");
  process.exit(0);
}

await import("./main-entry.js");
