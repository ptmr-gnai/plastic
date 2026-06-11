import { networkInterfaces } from "node:os";
import { join } from "node:path";
import { createRuntimeHostControlPlaneDescriptor } from "./runtime-host-control-plane-descriptor.js";
import { resolvePlasticRuntimePaths } from "./runtime-paths.js";

const unique = <A>(items: A[]): A[] => [...new Set(items)];

const hostRpcUrls = (runtimePort: number): string[] => {
  const urls = [`http://127.0.0.1:${runtimePort}/rpc`];
  for (const interfaces of Object.values(networkInterfaces())) {
    for (const candidate of interfaces ?? []) {
      if (candidate.family === "IPv4" && !candidate.internal) {
        urls.push(`http://${candidate.address}:${runtimePort}/rpc`);
      }
    }
  }
  urls.push(`http://host.docker.internal:${runtimePort}/rpc`);
  return unique(urls);
};

export const createRuntimeHostConfig = () => {
  const workspaceDir = process.env.PLASTIC_WORKSPACE_DIR ?? process.cwd();
  const plasticDir = join(workspaceDir, ".plastic");
  const runtimePaths = resolvePlasticRuntimePaths(workspaceDir);
  const runtimeHost = process.env.PLASTIC_RUNTIME_HOST ?? "0.0.0.0";
  const runtimePort = Number(process.env.PLASTIC_RUNTIME_PORT ?? 7331);
  const buildHost = process.env.PLASTIC_BUILD_HOST ?? "127.0.0.1";
  const buildPort = Number(process.env.PLASTIC_BUILD_PORT ?? 7332);
  const runtimeRpcUrls = hostRpcUrls(runtimePort);
  const preferredRuntimeRpcUrl = process.env.PLASTIC_RPC_URL
    ?? runtimeRpcUrls[1]
    ?? runtimeRpcUrls[0]
    ?? `http://127.0.0.1:${runtimePort}/rpc`;
  const controlPlane = createRuntimeHostControlPlaneDescriptor({
    runtimeHost,
    runtimePort,
    buildHost,
    buildPort
  });

  return {
    workspaceDir,
    plasticDir,
    runtimePaths,
    eventPath: runtimePaths.eventPath,
    bundledExtensionsDir: join(workspaceDir, "apps", "desktop", "extensions", "bundled"),
    runtimeHost,
    runtimePort,
    buildHost,
    buildPort,
    controlPlane,
    runtimeRpcUrl: process.env.PLASTIC_RPC_URL ?? `http://127.0.0.1:${runtimePort}/rpc`,
    runtimeRpcUrls,
    preferredRuntimeRpcUrl
  };
};
