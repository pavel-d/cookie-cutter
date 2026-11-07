import { bindings, defineConfig } from "cf/config";

export default defineConfig({
  accountId: "754896199c6b581fe4006c34022c4351",
  worker: {
    name: "cookie-cutter-reports",
    entrypoint: "./worker.ts",
    compatibilityDate: "2026-11-07",
    workersDev: false,
    previewUrls: false,
    env: {
      LINEAR_API_KEY: bindings.secret(),
      REPORT_LIMITER: bindings.rateLimit({
        namespace: "1001",
        simple: { limit: 5, period: 60 },
      }),
      LINEAR_TEAM_ID: bindings.text("3ef02aa2-45ac-4aec-b426-f5a43bc5a677"),
      LINEAR_PROJECT_ID: bindings.text("fd3c6688-5add-4c62-b1ae-b656cefa7fd4"),
      LINEAR_LABEL_ID: bindings.text("d51db1d1-ed11-48d8-bf1e-3106d86fdf13"),
      LINEAR_STATE_ID: bindings.text("5cdd95d1-9150-499d-b73b-32eb340e4ebb"),
    },
    observability: {
      enabled: true,
      redactQueryString: true,
      logs: { enabled: true, invocationLogs: true },
      traces: { enabled: true, headSamplingRate: 0.1 },
    },
  },
});
