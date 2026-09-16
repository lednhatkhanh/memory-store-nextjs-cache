import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "@rspack/cli";
import type { RspackOptions } from "@rspack/core";

const packageDirectory = path.dirname(fileURLToPath(import.meta.url));

const config: RspackOptions = {
  context: packageDirectory,
  entry: {
    index: "./src/index.ts",
    "next-handler": "./src/next-handler.ts",
  },
  externals: ["ioredis"],
  externalsType: "modern-module",
  resolve: {
    extensionAlias: {
      ".js": [".ts", ".js"],
    },
  },
  target: "node24",
  module: {
    rules: [
      {
        test: /\.ts$/u,
        include: [path.resolve(packageDirectory, "src")],
        type: "javascript/auto",
        use: [
          {
            loader: "builtin:swc-loader",
            options: {
              jsc: {
                parser: {
                  syntax: "typescript",
                },
                target: "es2024",
              },
            },
          },
        ],
      },
    ],
  },
  output: {
    clean: true,
    filename: "[name].js",
    library: {
      type: "modern-module",
    },
    path: path.resolve(packageDirectory, "dist"),
  },
  devtool: false,
  optimization: {
    avoidEntryIife: true,
    minimize: true,
    sideEffects: true,
    usedExports: true,
  },
};

export default defineConfig(config);
