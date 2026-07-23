import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { generateZshCompletion, generateBashCompletion } from "./completion.js";

export default function completionExtension(_pi: ExtensionAPI) {
  // Check process.argv directly - runs during extension loading, before TUI
  const idx = process.argv.indexOf("--completion");
  if (idx !== -1) {
    const shell = process.argv[idx + 1];
    if (shell === "zsh") {
      console.log(generateZshCompletion());
      process.exit(0);
    } else if (shell === "bash") {
      console.log(generateBashCompletion());
      process.exit(0);
    } else {
      console.error(`Unknown shell: ${shell || "(none)"}. Supported: bash, zsh`);
      process.exit(1);
    }
  }
}
