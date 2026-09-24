// @effect-diagnostics nodeBuiltinImport:off -- The restart boundary uses a real shell and pipe.
import * as NodeAssert from "node:assert/strict";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { it } from "@effect/vitest";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";

import { spawnAppImageAfterExit } from "./AppImageRestart.ts";

it.skipIf(HostProcessPlatform.defaultValue() !== "linux")(
  "waits for the parent pipe to close and launches without the old AppImage environment",
  async () => {
    const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-appimage-restart-"));
    const script = NodePath.join(directory, "replacement");
    const result = NodePath.join(directory, "result");
    const original = {
      APPIMAGE: process.env.APPIMAGE,
      APPDIR: process.env.APPDIR,
      ARGV0: process.env.ARGV0,
      LD_LIBRARY_PATH: process.env.LD_LIBRARY_PATH,
    };
    try {
      await NodeFSP.writeFile(
        script,
        '#!/bin/sh\nprintf "%s\\n" "${APPIMAGE-unset}" "${APPDIR-unset}" "${ARGV0-unset}" "${LD_LIBRARY_PATH-unset}" "$2" > "$1"\n',
        { mode: 0o755 },
      );
      process.env.APPIMAGE = "/tmp/old.AppImage";
      process.env.APPDIR = "/tmp/.mount_old";
      process.env.ARGV0 = "/tmp/old.AppImage";
      process.env.LD_LIBRARY_PATH = "/tmp/.mount_old/usr/lib";

      const child = await spawnAppImageAfterExit(script, [result, "argument with spaces"]);
      try {
        await NodeAssert.rejects(NodeFSP.stat(result), { code: "ENOENT" });
        const exited = new Promise<number | null>((resolve) => child.once("exit", resolve));
        child.stdin?.end();
        NodeAssert.equal(await exited, 0);
        NodeAssert.deepEqual((await NodeFSP.readFile(result, "utf8")).trim().split("\n"), [
          "unset",
          "unset",
          "unset",
          "unset",
          "argument with spaces",
        ]);
      } finally {
        child.stdin?.end();
      }
    } finally {
      for (const [name, value] of Object.entries(original)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
      await NodeFSP.rm(directory, { recursive: true, force: true });
    }
  },
);
