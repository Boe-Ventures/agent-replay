import { expect, test } from "bun:test";
import { parseCliArgs } from "../../src/cli/args.js";

test("CLI parser keeps session IDs positional and separates valued and boolean flags", () => {
  const parsed = parseCliArgs(["receipt", "before-id", "after-id", "--video", "--format", "mp4", "--output=receipts"]);
  expect(parsed.command).toBe("receipt");
  expect(parsed.positionals).toEqual(["before-id", "after-id"]);
  expect(parsed.booleans.has("video")).toBe(true);
  expect(parsed.flags.get("format")).toBe("mp4");
  expect(parsed.flags.get("output")).toBe("receipts");
});
