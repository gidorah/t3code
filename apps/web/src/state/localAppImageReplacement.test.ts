import { describe, expect, it, vi } from "vite-plus/test";
import { restartWithLocalAppImage } from "./localAppImageReplacement";

describe("restart with a replacement AppImage", () => {
  it("leaves the app running when restart is cancelled", async () => {
    const restart = vi.fn();
    const confirm = vi.fn().mockResolvedValue(false);
    const result = await restartWithLocalAppImage({ confirm, restart });

    expect(result).toBe("cancelled");
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("running tasks"));
    expect(restart).not.toHaveBeenCalled();
  });

  it("reports a replacement that disappeared before restart", async () => {
    const result = await restartWithLocalAppImage({
      confirm: vi.fn().mockResolvedValue(true),
      restart: vi.fn().mockResolvedValue(false),
    });

    expect(result).toBe("unavailable");
  });

  it("hands off to the installed replacement after confirmation", async () => {
    const restart = vi.fn().mockResolvedValue(true);
    const result = await restartWithLocalAppImage({
      confirm: vi.fn().mockResolvedValue(true),
      restart,
    });

    expect(result).toBe("restarting");
    expect(restart).toHaveBeenCalledOnce();
  });
});
