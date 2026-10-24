import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // SDKs com binários/certs nativos não devem ser bundlados (rotas de API).
  serverExternalPackages: ["firebase-admin", "stripe"],
};

export default nextConfig;
