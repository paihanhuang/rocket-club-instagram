import { describe, expect, it } from "vitest";
import { qwenArgs } from "./qwen.js";

describe("qwen code invocation", () => {
  it("runs headless in safe mode with tools disabled, a schema, and a wall-time budget", () => {
    const args = qwenArgs({ user: "USER", system: "SYSTEM", schemaPath: "/tmp/s.json", seconds: 600 });
    expect(args[0]).toBe("USER");
    expect(args).toContain("--safe-mode");
    const tools = args.indexOf("--max-tool-calls");
    expect(args.slice(tools, tools + 2)).toEqual(["--max-tool-calls", "0"]);
    const schema = args.indexOf("--json-schema");
    expect(args.slice(schema, schema + 2)).toEqual(["--json-schema", "@/tmp/s.json"]);
    const wall = args.indexOf("--max-wall-time");
    expect(args.slice(wall, wall + 2)).toEqual(["--max-wall-time", "600"]);
    const sys = args.indexOf("--system-prompt");
    expect(args.slice(sys, sys + 2)).toEqual(["--system-prompt", "SYSTEM"]);
  });
});
