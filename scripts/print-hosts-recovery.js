import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const hostsPath = "/etc/hosts";
const defaultHosts = `##
# Host Database
#
# localhost is used to configure the loopback interface
# when the system is booting.  Do not change this entry.
##
127.0.0.1 localhost
255.255.255.255 broadcasthost
::1 localhost
`;

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function printRecovery({ currentHosts, output = console.log }) {
  const currentSize = Buffer.byteLength(currentHosts);
  const currentDigest = sha256(currentHosts);
  const defaultDigest = sha256(defaultHosts);

  output("Hosts Switch manual validation hosts recovery guide");
  output("");
  output(`Current ${hostsPath}: ${currentSize} bytes`);
  output(`Current ${hostsPath} SHA-256: ${currentDigest}`);
  output(`Recommended default ${hostsPath} SHA-256: ${defaultDigest}`);
  output("");
  output("Recommended default macOS hosts content:");
  output("----- BEGIN /etc/hosts -----");
  output(defaultHosts.trimEnd());
  output("----- END /etc/hosts -----");
  output("");
  output("Manual recovery commands:");
  output(`sudo cp ${hostsPath} ~/Desktop/hosts-empty-before-recovery.txt`);
  output("sudo tee /etc/hosts >/dev/null <<'EOF'");
  output(defaultHosts.trimEnd());
  output("EOF");
  output("sudo chmod 644 /etc/hosts");
  output("sudo dscacheutil -flushcache");
  output("sudo killall -HUP mDNSResponder");
  output("");
  output("This command prints recovery guidance only. It does not modify /etc/hosts.");
}

function runSelfTest() {
  const lines = [];
  printRecovery({
    currentHosts: "",
    output: (line) => lines.push(line),
  });
  const text = lines.join("\n");
  for (const required of [
    "0 bytes",
    "127.0.0.1 localhost",
    "255.255.255.255 broadcasthost",
    "sudo tee /etc/hosts",
    "does not modify /etc/hosts",
  ]) {
    if (!text.includes(required)) {
      console.error(`Hosts recovery self-test failed: missing ${JSON.stringify(required)}`);
      process.exit(1);
    }
  }

  console.log("Hosts recovery guidance self-test passed");
}

if (process.argv.includes("--self-test")) {
  runSelfTest();
  process.exit(0);
}

const currentHosts = readFileSync(hostsPath, "utf8");
printRecovery({ currentHosts });
