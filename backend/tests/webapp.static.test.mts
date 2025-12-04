import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import request from "supertest";
import { StorageContext } from "@src/storagecontext.mjs";
import { VEWebApp } from "@src/webapp.mjs";

describe("WebApp serves index.html", () => {
  const prevEnv = process.env.LXC_MANAGER_FRONTEND_DIR;
  let tempDir = "";

  beforeAll(() => {
    // Create a temporary static directory with an index.html
    tempDir = mkdtempSync(path.join(tmpdir(), "webapp-static-"));
    writeFileSync(path.join(tempDir, "index.html"), "<html><body>OK</body></html>");
    // Point frontend dir to tempDir
    process.env.LXC_MANAGER_FRONTEND_DIR = tempDir;
    // Minimal StorageContext init; paths won't be used for this test route
    StorageContext.setInstance("local");
  });

  afterAll(() => {
    // Restore env and cleanup temp
    if (prevEnv === undefined) delete process.env.LXC_MANAGER_FRONTEND_DIR;
    else process.env.LXC_MANAGER_FRONTEND_DIR = prevEnv;
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("GET / returns 200 and HTML", async () => {
    const app = new VEWebApp(StorageContext.getInstance()).app;
    await request(app)
      .get("/")
      .expect(200)
      .expect("Content-Type", /html/);
  });
});
