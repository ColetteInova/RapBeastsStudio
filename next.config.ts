import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // SDKs com binários/certs nativos não devem ser bundlados (rotas de API).
  serverExternalPackages: ["firebase-admin", "stripe"],
  // Há um package-lock.json fora do repo (em ~); fixa a raiz para o Turbopack
  // não inferi-la a partir dele.
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
