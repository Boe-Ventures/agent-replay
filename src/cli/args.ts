const VALUE_FLAGS = new Set([
  "port", "host", "token", "dir", "max-disk-mb", "origins", "max-sessions", "max-age",
  "session", "budget", "around", "window", "type", "url", "output", "format", "preset",
  "from", "to", "title", "outro", "source", "keep",
]);

export interface ParsedCliArgs {
  command: string;
  positionals: string[];
  flags: Map<string, string>;
  booleans: Set<string>;
}

export function parseCliArgs(argv: string[]): ParsedCliArgs {
  const command = argv[0] ?? "help";
  const positionals: string[] = [];
  const flags = new Map<string, string>();
  const booleans = new Set<string>();
  for (let index = 1; index < argv.length; index++) {
    const value = argv[index]!;
    if (!value.startsWith("--")) {
      positionals.push(value);
      continue;
    }
    const [rawName, inline] = value.slice(2).split("=", 2);
    if (inline != null) {
      flags.set(rawName!, inline);
    } else if (VALUE_FLAGS.has(rawName!) && argv[index + 1] && !argv[index + 1]!.startsWith("--")) {
      flags.set(rawName!, argv[++index]!);
    } else {
      booleans.add(rawName!);
    }
  }
  return { command, positionals, flags, booleans };
}
