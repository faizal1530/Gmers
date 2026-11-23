import { loadConfig } from "./config";
import { startServer } from "./server";

const config = loadConfig();
const server = await startServer(config);
process.stdout.write(`Gmers server mendengarkan di port ${server.port}\n`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void server.close().then(() => process.exit(0));
  });
}
